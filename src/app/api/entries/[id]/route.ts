import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";
import { syncVATDeclarationForDate } from "@/server/calculations/vatSync";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id } = await params;
  const entry = await prisma.journalEntry.findUnique({
    where: { id },
    include: {
      journal: true,
      fiscalYear: true,
      lines: {
        include: { account: true, analyticalLines: { include: { analyticalPost: true } } },
        orderBy: { lineNumber: "asc" },
      },
      createdBy: { select: { firstName: true, lastName: true } },
    },
  });

  if (!entry) return NextResponse.json({ error: "Écriture introuvable" }, { status: 404 });

  return NextResponse.json(entry);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id } = await params;
  const entry = await prisma.journalEntry.findUnique({ where: { id } });
  if (!entry) return NextResponse.json({ error: "Écriture introuvable" }, { status: 404 });

  const body = await request.json();

  // If validating
  if (body.action === "validate") {
    if (entry.status !== "DRAFT") {
      return NextResponse.json({ error: "Seules les écritures brouillon peuvent être validées" }, { status: 400 });
    }
    const updated = await prisma.journalEntry.update({
      where: { id },
      data: { status: "VALIDATED", validatedAt: new Date() },
      include: { lines: true, journal: true },
    });
    
    // Background sync for VAT
    syncVATDeclarationForDate(updated.journal.companyId, updated.fiscalYearId, updated.entryDate).catch(console.error);
    
    return NextResponse.json(updated);
  }

  // If reversing (contrepassation)
  if (body.action === "reverse") {
    if (entry.status !== "VALIDATED") {
      return NextResponse.json({ error: "Seules les écritures validées peuvent être contrepassées" }, { status: 400 });
    }

    const originalLines = await prisma.journalEntryLine.findMany({
      where: { journalEntryId: id },
      orderBy: { lineNumber: "asc" },
    });

    const lastEntry = await prisma.journalEntry.findFirst({
      where: { journalId: entry.journalId, fiscalYearId: entry.fiscalYearId },
      orderBy: { entryNumber: "desc" },
    });

    const reversalEntry = await prisma.journalEntry.create({
      data: {
        fiscalYearId: entry.fiscalYearId,
        journalId: entry.journalId,
        entryNumber: (lastEntry?.entryNumber || 0) + 1,
        entryDate: new Date(),
        reference: `Contrepassation de ${entry.entryNumber}`,
        description: `Contrepassation: ${entry.description}`,
        totalDebit: entry.totalCredit,
        totalCredit: entry.totalDebit,
        createdById: session.user.id,
        isReversal: true,
        originalEntryId: id,
        status: "VALIDATED",
        validatedAt: new Date(),
        lines: {
          create: originalLines.map((line) => ({
            lineNumber: line.lineNumber,
            accountCode: line.accountCode,
            companyId: line.companyId,
            label: `Contrepassation: ${line.label}`,
            debit: line.credit,
            credit: line.debit,
          })),
        },
      },
      include: { lines: true },
    });

    // Mark original as reversed
    await prisma.journalEntry.update({
      where: { id },
      data: { isReversed: true, reversedById: reversalEntry.id, status: "REVERSED" },
    });
    
    // Background sync for VAT (update for both the reversal date and original date if they differ, though usually same period)
    const companyId = (await prisma.journal.findUnique({ where: { id: entry.journalId } }))?.companyId;
    if (companyId) {
      syncVATDeclarationForDate(companyId, entry.fiscalYearId, entry.entryDate).catch(console.error);
      syncVATDeclarationForDate(companyId, reversalEntry.fiscalYearId, reversalEntry.entryDate).catch(console.error);
    }

    return NextResponse.json(reversalEntry);
  }

  return NextResponse.json({ error: "Action non reconnue" }, { status: 400 });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id } = await params;
  const entry = await prisma.journalEntry.findUnique({ where: { id } });
  if (!entry) return NextResponse.json({ error: "Écriture introuvable" }, { status: 404 });

  if (entry.status !== "DRAFT") {
    return NextResponse.json(
      { error: "Seules les écritures brouillon peuvent être supprimées" },
      { status: 400 }
    );
  }

  await prisma.journalEntry.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
