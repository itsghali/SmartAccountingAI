import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { checkPermission } from "@/server/permissions";
import { VATRegime, VATperiodType } from "@prisma/client";
import { prisma } from "@/server/prisma";
import Decimal from "decimal.js";
import { computeVATDeclaration } from "@/server/calculations/vat";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const companyId = request.nextUrl.searchParams.get("companyId");
  const fiscalYearId = request.nextUrl.searchParams.get("fiscalYearId");

  if (!companyId || !fiscalYearId) {
    return NextResponse.json({ error: "companyId et fiscalYearId requis" }, { status: 400 });
  }

  if (!(await checkPermission(companyId, "canAccessVAT"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const declarations = await prisma.vATDeclaration.findMany({
    where: { companyId, fiscalYearId },
    include: { deductionLines: true },
    orderBy: { periodIndex: "asc" },
  });

  return NextResponse.json(declarations);
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const body = await request.json();
  const { companyId, fiscalYearId, periodType, periodIndex, regime } = body;

  if (!companyId || !fiscalYearId || !periodType || !periodIndex) {
    return NextResponse.json({ error: "Champs requis manquants" }, { status: 400 });
  }

  if (!(await checkPermission(companyId, "canAccessVAT"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Get fiscal year to compute period dates
  const fiscalYear = await prisma.fiscalYear.findUnique({ where: { id: fiscalYearId } });
  if (!fiscalYear) return NextResponse.json({ error: "Exercice introuvable" }, { status: 404 });

  const year = fiscalYear.startDate.getFullYear();
  let startDate: Date, endDate: Date;

  if (periodType === VATperiodType.MONTHLY) {
    const month = fiscalYear.startDate.getMonth() + periodIndex - 1;
    startDate = new Date(year, month, 1);
    endDate = new Date(year, month + 1, 0);
  } else {
    const startMonth = fiscalYear.startDate.getMonth() + (periodIndex - 1) * 3;
    startDate = new Date(year, startMonth, 1);
    endDate = new Date(year, startMonth + 3, 0);
  }

  // Get previous period credit
  const previousDeclaration = await prisma.vATDeclaration.findFirst({
    where: {
      companyId,
      fiscalYearId,
      periodType,
      periodIndex: periodIndex - 1,
      isCredit: true,
    },
  });
  const previousCredit = previousDeclaration
    ? new Decimal(previousDeclaration.netVAT.toString())
    : new Decimal(0);
  const result = await computeVATDeclaration(
    companyId,
    fiscalYearId,
    startDate,
    endDate,
    previousCredit
  );

  const declaration = await prisma.vATDeclaration.upsert({
    where: {
      companyId_fiscalYearId_periodType_periodIndex: {
        companyId,
        fiscalYearId,
        periodType: periodType as VATperiodType,
        periodIndex,
      },
    },
    update: {
      taxableRevenue20: result.taxableRevenue20.toDecimalPlaces(2).toNumber(),
      taxableRevenue14: result.taxableRevenue14.toDecimalPlaces(2).toNumber(),
      taxableRevenue10: result.taxableRevenue10.toDecimalPlaces(2).toNumber(),
      taxableRevenue7: result.taxableRevenue7.toDecimalPlaces(2).toNumber(),
      outputVAT20: result.outputVAT20.toDecimalPlaces(2).toNumber(),
      outputVAT14: result.outputVAT14.toDecimalPlaces(2).toNumber(),
      outputVAT10: result.outputVAT10.toDecimalPlaces(2).toNumber(),
      outputVAT7: result.outputVAT7.toDecimalPlaces(2).toNumber(),
      totalOutputVAT: result.totalOutputVAT.toDecimalPlaces(2).toNumber(),
      inputVATAssets: result.inputVATAssets.toDecimalPlaces(2).toNumber(),
      inputVATExpenses: result.inputVATExpenses.toDecimalPlaces(2).toNumber(),
      totalInputVAT: result.totalInputVAT.toDecimalPlaces(2).toNumber(),
      previousCredit: result.previousCredit.toDecimalPlaces(2).toNumber(),
      netVAT: result.netVAT.toDecimalPlaces(2).toNumber(),
      isCredit: result.isCredit,
      status: "COMPUTED",
    },
    create: {
      companyId,
      fiscalYearId,
      regime: (regime as VATRegime) || VATRegime.DEBIT,
      periodType: periodType as VATperiodType,
      periodIndex,
      startDate,
      endDate,
      taxableRevenue20: result.taxableRevenue20.toDecimalPlaces(2).toNumber(),
      taxableRevenue14: result.taxableRevenue14.toDecimalPlaces(2).toNumber(),
      taxableRevenue10: result.taxableRevenue10.toDecimalPlaces(2).toNumber(),
      taxableRevenue7: result.taxableRevenue7.toDecimalPlaces(2).toNumber(),
      outputVAT20: result.outputVAT20.toDecimalPlaces(2).toNumber(),
      outputVAT14: result.outputVAT14.toDecimalPlaces(2).toNumber(),
      outputVAT10: result.outputVAT10.toDecimalPlaces(2).toNumber(),
      outputVAT7: result.outputVAT7.toDecimalPlaces(2).toNumber(),
      totalOutputVAT: result.totalOutputVAT.toDecimalPlaces(2).toNumber(),
      inputVATAssets: result.inputVATAssets.toDecimalPlaces(2).toNumber(),
      inputVATExpenses: result.inputVATExpenses.toDecimalPlaces(2).toNumber(),
      totalInputVAT: result.totalInputVAT.toDecimalPlaces(2).toNumber(),
      previousCredit: result.previousCredit.toDecimalPlaces(2).toNumber(),
      netVAT: result.netVAT.toDecimalPlaces(2).toNumber(),
      isCredit: result.isCredit,
      status: "COMPUTED",
    },
  });

  return NextResponse.json(declaration, { status: 201 });
}
