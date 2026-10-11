import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { checkPermission } from "@/server/permissions";
import { prisma } from "@/server/prisma";
import { syncVATDeclarationForDate } from "@/server/calculations/vatSync";
import {
  runAccountingTransaction,
  lockFiscalYear,
  lockJournal,
  lockJournalEntry,
  allocateNextEntryNumber,
  assertFiscalPeriodAllowsMutation,
  recordAuditLog,
  AccountingError,
  type LockedFiscalYear,
} from "@/server/accounting-transaction";
import {
  getIdempotencyKey,
  computeRequestFingerprint,
  checkIdempotency,
  recordIdempotency,
  createIdempotentReplayResponse,
} from "@/server/idempotency";

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

  const companyId = entry.journal.companyId;
  if (!(await checkPermission(companyId, "canAccessEntries"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json(entry);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id } = await params;
  const entry = await prisma.journalEntry.findUnique({
    where: { id },
    include: {
      journal: { select: { id: true, companyId: true } },
      fiscalYear: { select: { id: true, status: true, companyId: true } },
    },
  });
  if (!entry) return NextResponse.json({ error: "Écriture introuvable" }, { status: 404 });

  const companyId = entry.journal.companyId;
  const body = await request.json();

  // If validating
  if (body.action === "validate") {
    if (!(await checkPermission(companyId, "canValidateEntries"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    try {
      const updated = await runAccountingTransaction(async (tx) => {
        // Lock Order Step 1: FiscalYear FOR SHARE
        const lockedFY = await lockFiscalYear(tx, entry.fiscalYearId, companyId, "SHARE");
        assertFiscalPeriodAllowsMutation(lockedFY, "VALIDATE");

        const lockedEntry = await lockJournalEntry(tx, id);
        if (!lockedEntry || lockedEntry.status !== "DRAFT") {
          throw new AccountingError("Seules les écritures brouillon peuvent être validées", 400);
        }

        const res = await tx.journalEntry.update({
          where: { id },
          data: { status: "VALIDATED", validatedAt: new Date() },
          include: { lines: true, journal: true },
        });

        await recordAuditLog(tx, {
          userId: session.user.id,
          companyId,
          action: "JOURNAL_ENTRY_VALIDATED",
          entityType: "JournalEntry",
          entityId: id,
          details: { entryNumber: res.entryNumber, fiscalYearId: res.fiscalYearId },
        });

        return res;
      });

      // Background sync for VAT strictly post-commit
      syncVATDeclarationForDate(updated.journal.companyId, updated.fiscalYearId, updated.entryDate).catch(
        (err) => console.error("[VATSync] Post-commit warning:", err)
      );

      return NextResponse.json(updated);
    } catch (err: unknown) {
      if (err instanceof AccountingError) {
        return NextResponse.json({ error: err.message }, { status: err.statusCode });
      }
      console.error("Erreur validation écriture:", err);
      return NextResponse.json({ error: "Erreur interne du serveur" }, { status: 500 });
    }
  }

  // If reversing (contrepassation)
  if (body.action === "reverse") {
    if (!(await checkPermission(companyId, "canAccessEntries"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const rawTargetFY = body.targetFiscalYearId || body.fiscalYearId;
    const targetFiscalYearId =
      typeof rawTargetFY === "string" && rawTargetFY.trim()
        ? rawTargetFY.trim()
        : entry.fiscalYearId;

    const rawReversalDate = body.reversalDate || body.entryDate;
    const reversalDate = rawReversalDate ? new Date(rawReversalDate) : new Date();

    if (isNaN(reversalDate.getTime())) {
      return NextResponse.json({ error: "Date de contrepassation invalide" }, { status: 400 });
    }

    // Idempotency check for reversal
    const idempotencyKey = getIdempotencyKey(request);
    let requestHash = "";
    if (idempotencyKey) {
      requestHash = computeRequestFingerprint("PUT", `/api/entries/${id}`, body);
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
      const reversalEntry = await runAccountingTransaction(async (tx) => {
        // Lock Order Step 1: FiscalYears FOR SHARE in deterministic sorted order
        const fyIds = Array.from(new Set([entry.fiscalYearId, targetFiscalYearId])).sort();
        const lockedFYMap = new Map<string, LockedFiscalYear>();
        for (const fyId of fyIds) {
          const locked = await lockFiscalYear(tx, fyId, companyId, "SHARE");
          lockedFYMap.set(fyId, locked);
        }

        const lockedSourceFY = lockedFYMap.get(entry.fiscalYearId)!;
        const lockedTargetFY = lockedFYMap.get(targetFiscalYearId);
        if (!lockedTargetFY) {
          throw new AccountingError("Exercice comptable cible introuvable", 404);
        }

        // Period mutation checks: source must allow REVERSE, target must allow CREATE
        assertFiscalPeriodAllowsMutation(lockedSourceFY, "REVERSE");
        assertFiscalPeriodAllowsMutation(lockedTargetFY, "CREATE");

        // Validate date boundaries against target fiscal year
        const targetStart = new Date(lockedTargetFY.startDate);
        const targetEnd = new Date(lockedTargetFY.endDate);
        const startOfDay = new Date(targetStart);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(targetEnd);
        endOfDay.setHours(23, 59, 59, 999);

        if (reversalDate < startOfDay || reversalDate > endOfDay) {
          throw new AccountingError(
            "La date de contrepassation est en dehors des limites de l'exercice comptable cible",
            400
          );
        }

        if (targetFiscalYearId !== entry.fiscalYearId) {
          if (new Date(lockedTargetFY.startDate) < new Date(lockedSourceFY.startDate)) {
            throw new AccountingError(
              "L'exercice cible de contrepassation ne peut pas être antérieur à l'exercice d'origine",
              400
            );
          }
        }

        // Lock Order Step 2: Journal FOR UPDATE
        await lockJournal(tx, entry.journalId, companyId);

        // Lock Order Step 3: JournalEntry FOR UPDATE
        const original = await lockJournalEntry(tx, id);

        if (!original || original.status !== "VALIDATED" || original.isReversed) {
          throw new AccountingError(
            "Seules les écritures validées et non contrepassées peuvent être contrepassées",
            400
          );
        }

        const origDate = original.entryDate ? new Date(original.entryDate) : new Date(entry.entryDate);
        const origDay = new Date(origDate);
        origDay.setHours(0, 0, 0, 0);
        if (reversalDate < origDay) {
          throw new AccountingError(
            "La date de contrepassation ne peut pas être antérieure à la date de l'écriture d'origine",
            400
          );
        }

        const originalLines = await tx.journalEntryLine.findMany({
          where: { journalEntryId: id },
          orderBy: { lineNumber: "asc" },
        });

        const entryNumber = await allocateNextEntryNumber(tx, original.journalId, targetFiscalYearId);

        const createdReversal = await tx.journalEntry.create({
          data: {
            fiscalYearId: targetFiscalYearId,
            journalId: original.journalId,
            entryNumber,
            entryDate: reversalDate,
            reference: `Contrepassation de ${original.entryNumber}`,
            description: `Contrepassation: ${original.description}`,
            totalDebit: original.totalCredit,
            totalCredit: original.totalDebit,
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

        // Mark original as reversed atomically under lock
        if (typeof tx.journalEntry.updateMany === "function") {
          const revUpdate = await tx.journalEntry.updateMany({
            where: { id, status: "VALIDATED", isReversed: false },
            data: { isReversed: true, reversedById: createdReversal.id, status: "REVERSED" },
          });

          if (revUpdate.count === 0) {
            throw new AccountingError(
              "L'écriture a déjà été contrepassée ou modifiée par une transaction concurrente",
              409
            );
          }
        } else {
          await tx.journalEntry.update({
            where: { id },
            data: { isReversed: true, reversedById: createdReversal.id, status: "REVERSED" },
          });
        }

        // Record audit log
        await recordAuditLog(tx, {
          userId: session.user.id,
          companyId,
          action: "JOURNAL_ENTRY_REVERSED",
          entityType: "JournalEntry",
          entityId: id,
          details: {
            reversalEntryId: createdReversal.id,
            reversalEntryNumber: createdReversal.entryNumber,
            originalEntryNumber: original.entryNumber,
            sourceFiscalYearId: original.fiscalYearId,
            targetFiscalYearId,
            reversalDate: reversalDate.toISOString(),
          },
        });

        // Record Idempotency atomically
        if (idempotencyKey) {
          await recordIdempotency({
            tx,
            companyId,
            key: idempotencyKey,
            userId: session.user.id,
            endpoint: `/api/entries/${id}`,
            requestHash,
            statusCode: 200,
            responseBody: createdReversal,
          });
        }

        return createdReversal;
      });

      // Background sync for VAT strictly post-commit
      syncVATDeclarationForDate(companyId, entry.fiscalYearId, entry.entryDate).catch(
        (err) => console.error("[VATSync] Post-commit warning:", err)
      );
      syncVATDeclarationForDate(companyId, reversalEntry.fiscalYearId, reversalEntry.entryDate).catch(
        (err) => console.error("[VATSync] Post-commit warning:", err)
      );

      const responseHeaders: Record<string, string> = {};
      if (idempotencyKey) {
        responseHeaders["X-Idempotency-Key"] = idempotencyKey;
      }

      return NextResponse.json(reversalEntry, { status: 200, headers: responseHeaders });
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
      console.error("Erreur contrepassation écriture:", err);
      return NextResponse.json({ error: "Erreur interne du serveur" }, { status: 500 });
    }
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
  const entry = await prisma.journalEntry.findUnique({
    where: { id },
    include: {
      journal: { select: { companyId: true } },
      fiscalYear: { select: { id: true, status: true, companyId: true } },
    },
  });
  if (!entry) return NextResponse.json({ error: "Écriture introuvable" }, { status: 404 });

  const companyId = entry.journal.companyId;
  if (!(await checkPermission(companyId, "canDeleteDraftEntries"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    await runAccountingTransaction(async (tx) => {
      // Lock Order Step 1: FiscalYear FOR SHARE
      const lockedFY = await lockFiscalYear(tx, entry.fiscalYearId, companyId, "SHARE");
      assertFiscalPeriodAllowsMutation(lockedFY, "DELETE");

      const current = await lockJournalEntry(tx, id);

      if (!current || current.status !== "DRAFT") {
        throw new AccountingError("Seules les écritures brouillon peuvent être supprimées", 400);
      }

      await tx.journalEntry.delete({ where: { id } });

      await recordAuditLog(tx, {
        userId: session.user.id,
        companyId,
        action: "JOURNAL_ENTRY_DELETED",
        entityType: "JournalEntry",
        entityId: id,
        details: { entryNumber: current.entryNumber, description: current.description },
      });
    });

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    if (err instanceof AccountingError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    console.error("Erreur suppression écriture:", err);
    return NextResponse.json({ error: "Erreur interne du serveur" }, { status: 500 });
  }
}


