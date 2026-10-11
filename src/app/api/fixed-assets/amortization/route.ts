import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { checkPermission } from "@/server/permissions";
import { prisma } from "@/server/prisma";
import Decimal from "decimal.js";
import {
  calculateLinearAmortization,
  calculateDegressiveAmortization,
} from "@/server/calculations/amortization";
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

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const body = await request.json();
  const { companyId, fiscalYearId } = body;

  if (!companyId || !fiscalYearId) {
    return NextResponse.json({ error: "companyId et fiscalYearId requis" }, { status: 400 });
  }

  if (!(await checkPermission(companyId, "canAccessFixedAssets"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Pre-transaction idempotency check
  const idempotencyKey = getIdempotencyKey(request);
  let requestHash = "";
  if (idempotencyKey) {
    requestHash = computeRequestFingerprint("POST", "/api/fixed-assets/amortization", body);
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

  const fiscalYear = await prisma.fiscalYear.findUnique({ where: { id: fiscalYearId } });
  if (!fiscalYear || fiscalYear.companyId !== companyId) {
    return NextResponse.json({ error: "Exercice introuvable" }, { status: 404 });
  }
  assertFiscalPeriodAllowsMutation(fiscalYear, "AMORTIZATION");

  try {
    const responsePayload = await runAccountingTransaction(async (tx) => {
      // Lock Order Step 1: FiscalYear FOR SHARE
      const lockedFY = await lockFiscalYear(tx, fiscalYearId, companyId, "SHARE");
      assertFiscalPeriodAllowsMutation(lockedFY, "AMORTIZATION");

      // Load active assets inside transaction under lock
      const assets = await tx.fixedAsset.findMany({
        where: { companyId, status: "ACTIVE" },
      });

      const results = [];

      for (const asset of assets) {
        const input = {
          acquisitionValue: new Decimal(asset.acquisitionValue.toString()),
          residualValue: new Decimal(asset.residualValue.toString()),
          commissioningDate: asset.commissioningDate,
          usefulLifeYears: asset.usefulLifeYears,
          method: asset.amortizationMethod,
          degressiveCoefficient: asset.degressiveCoefficient
            ? new Decimal(asset.degressiveCoefficient.toString())
            : undefined,
        };

        const schedule =
          asset.amortizationMethod === "LINEAR"
            ? calculateLinearAmortization(input)
            : calculateDegressiveAmortization(input);

        const fyStart = lockedFY.startDate;
        const fyEnd = lockedFY.endDate;

        const matchingLine = schedule.find(
          (line) => line.periodStart <= fyEnd && line.periodEnd >= fyStart
        );

        if (matchingLine) {
          const existing = await tx.fixedAssetAmortization.findFirst({
            where: { fixedAssetId: asset.id, fiscalYearId, isPosted: true },
          });

          if (!existing) {
            const cumulativeAmort = matchingLine.cumulative.toDecimalPlaces(2).toNumber();
            const netBookVal = matchingLine.closingNetValue.toDecimalPlaces(2).toNumber();

            await tx.fixedAssetAmortization.create({
              data: {
                fixedAssetId: asset.id,
                fiscalYearId,
                year: matchingLine.year,
                periodStart: matchingLine.periodStart,
                periodEnd: matchingLine.periodEnd,
                openingValue: matchingLine.openingValue.toDecimalPlaces(2).toNumber(),
                annualDotation: matchingLine.dotation.toDecimalPlaces(2).toNumber(),
                cumulativeAmortization: cumulativeAmort,
                closingNetValue: netBookVal,
                isProrata: matchingLine.isProrata,
                isPosted: true,
              },
            });

            await tx.fixedAsset.update({
              where: { id: asset.id },
              data: {
                cumulativeAmortization: cumulativeAmort,
                netBookValue: netBookVal,
                status: netBookVal <= 0 ? "FULLY_AMORTIZED" : "ACTIVE",
              },
            });

            results.push({
              asset: asset.code,
              label: asset.label,
              dotation: matchingLine.dotation.toDecimalPlaces(2).toNumber(),
              dotationAccount: asset.dotationAccountCode,
              amortizationAccount: asset.amortizationAccountCode,
            });
          }
        }
      }

      // Generate journal entry atomically for all amortizations
      let createdEntryId: string | null = null;
      if (results.length > 0) {
        const journal = await tx.journal.findFirst({
          where: { companyId, type: "MISCELLANEOUS" },
        });

        if (!journal) {
          throw new AccountingError(
            "Aucun journal d'opérations diverses (MISCELLANEOUS) configuré pour cette société. Impossible de comptabiliser les écritures d'amortissement.",
            400
          );
        }

        // Lock Order Step 2: Journal FOR UPDATE
        await lockJournal(tx, journal.id, companyId);
        const entryNumber = await allocateNextEntryNumber(tx, journal.id, fiscalYearId);

          const lines = [];
          let lineNum = 1;

          for (const result of results) {
            lines.push({
              lineNumber: lineNum++,
              accountCode: result.dotationAccount,
              companyId,
              label: `Dotation amort. ${result.asset} - ${result.label}`,
              debit: result.dotation,
              credit: 0,
            });
          }

          for (const result of results) {
            lines.push({
              lineNumber: lineNum++,
              accountCode: result.amortizationAccount,
              companyId,
              label: `Dotation amort. ${result.asset} - ${result.label}`,
              debit: 0,
              credit: result.dotation,
            });
          }

          const totalDotation = results.reduce((s, r) => s + r.dotation, 0);

          const createdEntry = await tx.journalEntry.create({
            data: {
              fiscalYearId,
              journalId: journal.id,
              entryNumber,
              entryDate: lockedFY.endDate,
              description: "Dotations aux amortissements",
              totalDebit: totalDotation,
              totalCredit: totalDotation,
              origin: "AUTO",
              sourceModule: "AMORTIZATION",
              createdById: session.user.id,
              status: "VALIDATED",
              validatedAt: new Date(),
              lines: { create: lines },
            },
          });
          createdEntryId = createdEntry.id;
        }

      const resData = {
        message: `${results.length} amortissement(s) généré(s)`,
        details: results,
      };

      // Record audit log
      await recordAuditLog(tx, {
        userId: session.user.id,
        companyId,
        action: "AMORTIZATION_ENTRIES_POSTED",
        entityType: "JournalEntry",
        entityId: createdEntryId,
        details: { assetCount: results.length },
      });

      // Record Idempotency atomically
      if (idempotencyKey) {
        await recordIdempotency({
          tx,
          companyId,
          key: idempotencyKey,
          userId: session.user.id,
          endpoint: "/api/fixed-assets/amortization",
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

    return NextResponse.json(responsePayload, { status: 200, headers: responseHeaders });
  } catch (err: unknown) {
    if (err instanceof AccountingError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    console.error("Erreur génération amortissements:", err);
    return NextResponse.json({ error: "Erreur interne du serveur" }, { status: 500 });
  }
}

