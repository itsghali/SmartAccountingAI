import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";
import {
  runAccountingTransaction,
  lockFiscalYear,
  lockJournalsInOrder,
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

const schema = z.object({
  companyId: z.string().min(1),
  fiscalYearId: z.string().min(1),
});

/**
 * POST /api/entries/duplicate-prior-year
 *
 * Copie toutes les écritures VALIDÉES de l'exercice N-1 vers l'exercice courant,
 * avec origin=AUTO et sourceModule="PRIOR_YEAR_COPY".
 * Ces écritures servent de référence N-1 lors de la clôture.
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const user = session.user as { id: string; organizationId: string };

  try {
    const body = await request.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Paramètres invalides" }, { status: 400 });
    }

    const { companyId, fiscalYearId } = parsed.data;

    // Vérifier l'accès à la société
    const company = await prisma.company.findFirst({
      where: { id: companyId, organizationId: user.organizationId },
      select: { id: true },
    });
    if (!company) {
      return NextResponse.json({ error: "Société introuvable" }, { status: 404 });
    }

    // Vérifier les droits de l'utilisateur
    const access = await prisma.userCompanyAccess.findUnique({
      where: { userId_companyId: { userId: user.id, companyId } },
      select: { canCloseExercise: true },
    });
    if (!access?.canCloseExercise) {
      return NextResponse.json({ error: "Droits insuffisants" }, { status: 403 });
    }

    // Idempotency pre-transaction check
    const idempotencyKey = getIdempotencyKey(request);
    let requestHash = "";
    if (idempotencyKey) {
      requestHash = computeRequestFingerprint("POST", "/api/entries/duplicate-prior-year", body);
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

    // Charger l'exercice courant
    const currentFiscalYear = await prisma.fiscalYear.findUnique({
      where: { id: fiscalYearId },
      select: { id: true, startDate: true, endDate: true, status: true, companyId: true },
    });
    if (!currentFiscalYear || currentFiscalYear.companyId !== companyId) {
      return NextResponse.json({ error: "Exercice introuvable" }, { status: 404 });
    }
    assertFiscalPeriodAllowsMutation(currentFiscalYear, "DUPLICATE");

    // Trouver l'exercice N-1
    const priorFiscalYear = await prisma.fiscalYear.findFirst({
      where: {
        companyId,
        endDate: { lt: currentFiscalYear.startDate },
      },
      orderBy: { endDate: "desc" },
      select: { id: true, label: true },
    });
    if (!priorFiscalYear) {
      return NextResponse.json(
        { error: "Aucun exercice précédent (N-1) trouvé pour cette société" },
        { status: 404 }
      );
    }

    const result = await runAccountingTransaction(async (tx) => {
      // Lock Order Step 1: Lock both source and target FiscalYears in sorted order FOR SHARE
      let lockedTargetFY = null;
      const sortedFyIds = [priorFiscalYear.id, fiscalYearId].sort();
      for (const fyId of sortedFyIds) {
        const locked = await lockFiscalYear(tx, fyId, companyId, "SHARE");
        if (fyId === fiscalYearId) {
          lockedTargetFY = locked;
          assertFiscalPeriodAllowsMutation(locked, "DUPLICATE");
        }
      }

      // Load validated N-1 entries inside transaction under lock
      // Exclude reversed and reversal entries to prevent copying cancelled transactions
      const priorEntries = await tx.journalEntry.findMany({
        where: {
          fiscalYearId: priorFiscalYear.id,
          status: "VALIDATED",
          isReversed: false,
          isReversal: false,
          NOT: { sourceModule: "PRIOR_YEAR_COPY" },
        },
        include: {
          lines: { orderBy: { lineNumber: "asc" } },
          journal: { select: { id: true, companyId: true } },
        },
        orderBy: [{ entryDate: "asc" }, { entryNumber: "asc" }],
      });

      if (priorEntries.length === 0) {
        throw new AccountingError("Aucune écriture validée dans l'exercice N-1", 404);
      }

      // Lock Order Step 2: Lock distinct journals in ascending sorted order
      const distinctJournalIds = Array.from(new Set(priorEntries.map((e) => e.journalId))).sort();
      await lockJournalsInOrder(tx, distinctJournalIds, companyId);

      // Verify duplication has not already occurred under lock
      const alreadyDuplicated = await tx.journalEntry.count({
        where: {
          fiscalYearId,
          sourceModule: "PRIOR_YEAR_COPY",
        },
      });
      if (alreadyDuplicated > 0) {
        throw new AccountingError(
          `La duplication N-1 a déjà été effectuée (${alreadyDuplicated} écriture(s) existantes). Supprimez-les d'abord si vous souhaitez recommencer.`,
          409
        );
      }

      let duplicatedCount = 0;

      for (const entry of priorEntries) {
        const nextEntryNumber = await allocateNextEntryNumber(tx, entry.journalId, fiscalYearId);

        const originalDate = new Date(entry.entryDate);
        const shiftedDate = new Date(originalDate);
        shiftedDate.setFullYear(shiftedDate.getFullYear() + 1);

        const targetEndDate = lockedTargetFY?.endDate ?? currentFiscalYear.endDate;
        const targetDate =
          shiftedDate <= targetEndDate ? shiftedDate : targetEndDate;

        await tx.journalEntry.create({
          data: {
            fiscalYearId,
            journalId: entry.journalId,
            entryNumber: nextEntryNumber,
            entryDate: targetDate,
            reference: entry.reference,
            description: `[N-1] ${entry.description}`,
            piece: entry.piece,
            status: "VALIDATED",
            totalDebit: entry.totalDebit,
            totalCredit: entry.totalCredit,
            origin: "AUTO",
            sourceModule: "PRIOR_YEAR_COPY",
            sourceId: entry.id,
            createdById: user.id,
            lines: {
              create: entry.lines.map((line) => ({
                lineNumber: line.lineNumber,
                accountCode: line.accountCode,
                companyId,
                label: line.label,
                debit: line.debit,
                credit: line.credit,
                tiersName: line.tiersName,
                tiersReference: line.tiersReference,
                dueDate: line.dueDate,
              })),
            },
          },
        });

        duplicatedCount++;
      }

      const resData = {
        success: true,
        priorFiscalYearLabel: priorFiscalYear.label,
        duplicatedCount,
        message: `${duplicatedCount} écriture(s) N-1 copiées depuis l'exercice "${priorFiscalYear.label}"`,
      };

      // Record audit log
      await recordAuditLog(tx, {
        userId: user.id,
        companyId,
        action: "PRIOR_YEAR_ENTRIES_DUPLICATED",
        entityType: "FiscalYear",
        entityId: fiscalYearId,
        details: {
          duplicatedCount,
          priorFiscalYearId: priorFiscalYear.id,
          priorFiscalYearLabel: priorFiscalYear.label,
        },
      });

      // Record Idempotency atomically
      if (idempotencyKey) {
        await recordIdempotency({
          tx,
          companyId,
          key: idempotencyKey,
          userId: user.id,
          endpoint: "/api/entries/duplicate-prior-year",
          requestHash,
          statusCode: 200,
          responseBody: resData,
        });
      }

      return resData;
    });

    const responseHeaders: Record<string, string> = {};
    if (idempotencyKey) {
      responseHeaders["X-Idempotency-Key"] = idempotencyKey;
    }

    return NextResponse.json(result, { status: 200, headers: responseHeaders });
  } catch (error) {
    if (error instanceof AccountingError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error("Erreur duplication N-1:", error);
    return NextResponse.json({ error: "Erreur interne du serveur" }, { status: 500 });
  }
}

