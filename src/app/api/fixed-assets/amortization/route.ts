import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { checkPermission } from "@/server/permissions";
import { prisma } from "@/server/prisma";
import Decimal from "decimal.js";
import {
  calculateLinearAmortization,
  calculateDegressiveAmortization,
} from "@/server/calculations/amortization";

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

  const fiscalYear = await prisma.fiscalYear.findUnique({ where: { id: fiscalYearId } });
  if (!fiscalYear || fiscalYear.companyId !== companyId) {
    return NextResponse.json({ error: "Exercice introuvable" }, { status: 404 });
  }
  if (fiscalYear.status !== "OPEN") {
    return NextResponse.json({ error: "L'exercice est clôturé" }, { status: 400 });
  }

  // Get all active assets for this company
  const assets = await prisma.fixedAsset.findMany({
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

    // Find the amortization line for this fiscal year
    const fyStart = fiscalYear.startDate;
    const fyEnd = fiscalYear.endDate;

    const matchingLine = schedule.find(
      (line) => line.periodStart <= fyEnd && line.periodEnd >= fyStart
    );

    if (matchingLine) {
      // Check if already posted for this asset and fiscal year
      const existing = await prisma.fixedAssetAmortization.findFirst({
        where: { fixedAssetId: asset.id, fiscalYearId, isPosted: true },
      });

      if (!existing) {
        const cumulativeAmort = matchingLine.cumulative.toDecimalPlaces(2).toNumber();
        const netBookVal = matchingLine.closingNetValue.toDecimalPlaces(2).toNumber();

        await prisma.fixedAssetAmortization.create({
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
            isPosted: true, // We are generating the journal entry right after
          },
        });

        await prisma.fixedAsset.update({
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

  // Generate journal entry for all amortizations
  if (results.length > 0) {
    const journal = await prisma.journal.findFirst({
      where: { companyId, type: "MISCELLANEOUS" },
    });

    if (journal) {
      const lastEntry = await prisma.journalEntry.findFirst({
        where: { journalId: journal.id, fiscalYearId },
        orderBy: { entryNumber: "desc" },
      });

      const lines = [];
      let lineNum = 1;

      for (const result of results) {
        // Debit dotation account
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
        // Credit amortization account
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

      await prisma.journalEntry.create({
        data: {
          fiscalYearId,
          journalId: journal.id,
          entryNumber: (lastEntry?.entryNumber || 0) + 1,
          entryDate: fiscalYear.endDate,
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
    }
  }

  return NextResponse.json({
    message: `${results.length} amortissement(s) généré(s)`,
    details: results,
  });
}
