import { NextRequest, NextResponse } from "next/server";
import { EntryStatus, Prisma } from "@prisma/client";
import { auth } from "@/server/auth";
import { checkPermission } from "@/server/permissions";
import { prisma } from "@/server/prisma";
import { createEntrySchema } from "@/server/validators/entry";
import Decimal from "decimal.js";
import { syncVATDeclarationForDate } from "@/server/calculations/vatSync";
import { checkRateLimit, createRateLimitResponse } from "@/server/rate-limit";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const params = request.nextUrl.searchParams;
  const companyId = params.get("companyId");
  const fiscalYearId = params.get("fiscalYearId");
  const journalId = params.get("journalId");
  const status = params.get("status");
  const page = parseInt(params.get("page") || "1");
  const limit = parseInt(params.get("limit") || "50");

  if (!companyId || !fiscalYearId) {
    return NextResponse.json({ error: "companyId et fiscalYearId requis" }, { status: 400 });
  }

  if (!(await checkPermission(companyId, "canAccessEntries"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const where: Prisma.JournalEntryWhereInput = {
    fiscalYearId,
    journal: { companyId },
  };
  if (journalId) where.journalId = journalId;
  if (
    status === EntryStatus.DRAFT ||
    status === EntryStatus.VALIDATED ||
    status === EntryStatus.REVERSED
  ) {
    where.status = status;
  }

  const [entries, total] = await Promise.all([
    prisma.journalEntry.findMany({
      where,
      include: {
        journal: { select: { code: true, label: true } },
        lines: {
          include: { account: { select: { code: true, label: true } } },
          orderBy: { lineNumber: "asc" },
        },
        createdBy: { select: { firstName: true, lastName: true } },
      },
      orderBy: [{ entryDate: "desc" }, { entryNumber: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.journalEntry.count({ where }),
  ]);

  return NextResponse.json({ entries, total, page, limit });
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const rateLimitResult = await checkRateLimit("FINANCIAL_MUTATION", `entries_${session.user.id}`);
  if (!rateLimitResult.success) {
    return createRateLimitResponse(rateLimitResult);
  }

  const body = await request.json();
  const parsed = createEntrySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const data = parsed.data;

  // Validate entry balance
  const totalDebit = data.lines.reduce((sum, l) => new Decimal(sum).plus(l.debit), new Decimal(0));
  const totalCredit = data.lines.reduce((sum, l) => new Decimal(sum).plus(l.credit), new Decimal(0));

  if (!totalDebit.eq(totalCredit)) {
    return NextResponse.json(
      { error: `L'écriture n'est pas équilibrée. Débit: ${totalDebit}, Crédit: ${totalCredit}` },
      { status: 400 }
    );
  }

  // Validate each line has debit XOR credit
  for (const line of data.lines) {
    if (line.debit > 0 && line.credit > 0) {
      return NextResponse.json(
        { error: `Ligne ${line.lineNumber}: une ligne ne peut pas avoir un débit ET un crédit.` },
        { status: 400 }
      );
    }
    if (line.debit === 0 && line.credit === 0) {
      return NextResponse.json(
        { error: `Ligne ${line.lineNumber}: le montant ne peut pas être zéro.` },
        { status: 400 }
      );
    }
  }

  // Get fiscal year and validate date
  const fiscalYear = await prisma.fiscalYear.findUnique({
    where: { id: data.fiscalYearId },
  });
  if (!fiscalYear) {
    return NextResponse.json({ error: "Exercice comptable introuvable" }, { status: 404 });
  }
  if (fiscalYear.status !== "OPEN") {
    return NextResponse.json({ error: "L'exercice comptable est clôturé" }, { status: 400 });
  }

  const entryDate = new Date(data.entryDate);
  if (entryDate < fiscalYear.startDate || entryDate > fiscalYear.endDate) {
    return NextResponse.json(
      { error: "La date de l'écriture est hors de l'exercice comptable" },
      { status: 400 }
    );
  }

  // Get the journal and next entry number
  const journal = await prisma.journal.findUnique({
    where: { id: data.journalId },
  });
  if (!journal) {
    return NextResponse.json({ error: "Journal introuvable" }, { status: 404 });
  }

  if (fiscalYear.companyId !== journal.companyId) {
    return NextResponse.json(
      { error: "L'exercice comptable et le journal doivent appartenir à la même société" },
      { status: 400 }
    );
  }

  const companyId = journal.companyId;
  if (!(await checkPermission(companyId, "canAccessEntries"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });


  // Get next entry number
  const lastEntry = await prisma.journalEntry.findFirst({
    where: { journalId: data.journalId, fiscalYearId: data.fiscalYearId },
    orderBy: { entryNumber: "desc" },
  });
  const entryNumber = (lastEntry?.entryNumber || 0) + 1;

  // Create entry with lines
  const entry = await prisma.journalEntry.create({
    data: {
      fiscalYearId: data.fiscalYearId,
      journalId: data.journalId,
      entryNumber,
      entryDate,
      reference: data.reference,
      description: data.description,
      piece: data.piece,
      origin: data.origin,
      sourceModule: data.sourceModule,
      sourceId: data.sourceId,
      totalDebit: totalDebit.toNumber(),
      totalCredit: totalCredit.toNumber(),
      createdById: session.user.id,
      lines: {
        create: data.lines.map((line) => ({
          lineNumber: line.lineNumber,
          accountCode: line.accountCode,
          companyId,
          label: line.label,
          debit: line.debit,
          credit: line.credit,
          tiersName: line.tiersName,
          tiersReference: line.tiersReference,
          dueDate: line.dueDate ? new Date(line.dueDate) : undefined,
        })),
      },
    },
    include: {
      lines: { include: { account: true }, orderBy: { lineNumber: "asc" } },
      journal: true,
    },
  });

  // Background sync for VAT
  syncVATDeclarationForDate(companyId, entry.fiscalYearId, entry.entryDate).catch(console.error);

  return NextResponse.json(entry, { status: 201 });
}
