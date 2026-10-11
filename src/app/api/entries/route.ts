import { NextRequest, NextResponse } from "next/server";
import { EntryStatus, Prisma } from "@prisma/client";
import { auth } from "@/server/auth";
import { checkPermission } from "@/server/permissions";
import { prisma } from "@/server/prisma";
import { createEntrySchema } from "@/server/validators/entry";
import Decimal from "decimal.js";
import { syncVATDeclarationForDate } from "@/server/calculations/vatSync";
import { checkRateLimit, createRateLimitResponse } from "@/server/rate-limit";
import {
  runAccountingTransaction,
  lockFiscalYear,
  lockJournal,
  allocateNextEntryNumber,
  assertFiscalPeriodAllowsMutation,
  recordAuditLog,
  AccountingError,
} from "@/server/accounting-transaction";
import {
  getIdempotencyKey,
  computeRequestFingerprint,
  checkIdempotency,
  recordIdempotency,
  createIdempotentReplayResponse,
} from "@/server/idempotency";

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

  // Authoritative existence & company boundary checks
  const fiscalYear = await prisma.fiscalYear.findUnique({
    where: { id: data.fiscalYearId },
  });
  if (!fiscalYear) {
    return NextResponse.json({ error: "Exercice comptable introuvable" }, { status: 404 });
  }

  assertFiscalPeriodAllowsMutation(fiscalYear, "CREATE");

  const entryDate = new Date(data.entryDate);
  if (entryDate < fiscalYear.startDate || entryDate > fiscalYear.endDate) {
    return NextResponse.json(
      { error: "La date de l'écriture est hors de l'exercice comptable" },
      { status: 400 }
    );
  }

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
  if (!(await checkPermission(companyId, "canAccessEntries"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Idempotency pre-transaction check
  const idempotencyKey = getIdempotencyKey(request);
  let requestHash = "";
  if (idempotencyKey) {
    requestHash = computeRequestFingerprint("POST", "/api/entries", body);
    const idempotencyCheck = await checkIdempotency({
      companyId,
      key: idempotencyKey,
      requestHash,
    });
    if (idempotencyCheck.unavailableError) {
      return NextResponse.json({ error: idempotencyCheck.unavailableError }, { status: 503 });
    }
    if (idempotencyCheck.isReplay && idempotencyCheck.cachedResponse) {
      return createIdempotentReplayResponse(idempotencyCheck.cachedResponse, idempotencyKey);
    }
    if (idempotencyCheck.conflictError) {
      return NextResponse.json({ error: idempotencyCheck.conflictError }, { status: 409 });
    }
  }

  try {
    const entry = await runAccountingTransaction(async (tx) => {
      // Lock Order Step 1: FiscalYear FOR SHARE
      const lockedFY = await lockFiscalYear(tx, data.fiscalYearId, companyId, "SHARE");
      assertFiscalPeriodAllowsMutation(lockedFY, "CREATE");

      // Lock Order Step 2: Journal FOR UPDATE
      await lockJournal(tx, data.journalId, companyId);

      // Lock Order Step 3: Concurrency-Safe Entry Number Allocation
      const entryNumber = await allocateNextEntryNumber(tx, data.journalId, data.fiscalYearId);

      // Create entry with lines
      const created = await tx.journalEntry.create({
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

      // Audit Log
      await recordAuditLog(tx, {
        userId: session.user.id,
        companyId,
        action: "JOURNAL_ENTRY_CREATED",
        entityType: "JournalEntry",
        entityId: created.id,
        details: {
          entryNumber: created.entryNumber,
          journalId: created.journalId,
          fiscalYearId: created.fiscalYearId,
          totalDebit: created.totalDebit,
          totalCredit: created.totalCredit,
          reference: created.reference,
        },
      });

      // Record Idempotency atomically
      if (idempotencyKey) {
        await recordIdempotency({
          tx,
          companyId,
          key: idempotencyKey,
          userId: session.user.id,
          endpoint: "/api/entries",
          requestHash,
          statusCode: 201,
          responseBody: created,
        });
      }

      return created;
    });

    // Fire-and-forget VAT sync strictly after transaction commits
    syncVATDeclarationForDate(companyId, entry.fiscalYearId, entry.entryDate).catch((err) => {
      console.error("[VATSync] Post-commit synchronization warning:", err);
    });

    const responseHeaders: Record<string, string> = {};
    if (idempotencyKey) {
      responseHeaders["X-Idempotency-Key"] = idempotencyKey;
    }

    return NextResponse.json(entry, { status: 201, headers: responseHeaders });
  } catch (err: unknown) {
    if (err instanceof AccountingError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: string }).code === "P2002"
    ) {
      return NextResponse.json(
        { error: "Conflit d'écriture comptable ou d'idempotence. Veuillez réessayer." },
        { status: 409 }
      );
    }
    console.error("Erreur création écriture:", err);
    return NextResponse.json({ error: "Erreur interne du serveur" }, { status: 500 });
  }
}

