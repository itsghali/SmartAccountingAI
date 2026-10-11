import { NextRequest, NextResponse } from "next/server";
import { AssetCategory, AssetStatus, type Prisma } from "@prisma/client";
import { auth } from "@/server/auth";
import { checkPermission } from "@/server/permissions";
import { prisma } from "@/server/prisma";
import Decimal from "decimal.js";
import { z } from "zod";

const createAssetSchema = z.object({
  companyId: z.string(),
  code: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
  category: z.enum([
    "INTANGIBLE", "LAND", "BUILDINGS", "EQUIPMENT", "TRANSPORT",
    "IT_EQUIPMENT", "FURNITURE", "OTHER_TANGIBLE", "FINANCIAL", "STARTUP_COSTS",
  ]),
  assetAccountCode: z.string().min(1),
  amortizationAccountCode: z.string().min(1),
  dotationAccountCode: z.string().min(1),
  acquisitionDate: z.string(),
  commissioningDate: z.string(),
  acquisitionValue: z.number().positive(),
  residualValue: z.number().min(0).default(0),
  usefulLifeYears: z.number().int().positive(),
  amortizationMethod: z.enum(["LINEAR", "DEGRESSIVE"]),
  degressiveCoefficient: z.number().optional(),
  location: z.string().optional(),
  serialNumber: z.string().optional(),
  supplier: z.string().optional(),
  invoiceReference: z.string().optional(),
  notes: z.string().optional(),
});

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const companyId = request.nextUrl.searchParams.get("companyId");
  if (!companyId) return NextResponse.json({ error: "companyId requis" }, { status: 400 });
  if (!(await checkPermission(companyId, "canAccessFixedAssets"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });


  const fiscalYearId = request.nextUrl.searchParams.get("fiscalYearId");
  const status = request.nextUrl.searchParams.get("status");
  const category = request.nextUrl.searchParams.get("category");

  const where: Prisma.FixedAssetWhereInput = { companyId };
  if (status && Object.values(AssetStatus).includes(status as AssetStatus)) {
    where.status = status as AssetStatus;
  }
  if (category && Object.values(AssetCategory).includes(category as AssetCategory)) {
    where.category = category as AssetCategory;
  }

  if (fiscalYearId) {
    const fiscalYear = await prisma.fiscalYear.findFirst({
      where: { id: fiscalYearId, companyId },
      select: { startDate: true, endDate: true },
    });

    if (!fiscalYear) {
      return NextResponse.json({ error: "Exercice introuvable" }, { status: 404 });
    }

    where.commissioningDate = { lte: fiscalYear.endDate };
    where.OR = [
      { disposalDate: null },
      { disposalDate: { gte: fiscalYear.startDate } },
    ];
  }

  const assets = await prisma.fixedAsset.findMany({
    where,
    include: {
      assetAccount: { select: { code: true, label: true } },
      amortizationSchedule: {
        ...(fiscalYearId ? { where: { fiscalYearId } } : {}),
        orderBy: { year: "asc" },
      },
    },
    orderBy: { code: "asc" },
  });

  return NextResponse.json(assets);
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const body = await request.json();
  const parsed = createAssetSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const data = parsed.data;
  if (!(await checkPermission(data.companyId, "canAccessFixedAssets"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const acquisitionValue = new Decimal(data.acquisitionValue);
  const residualValue = new Decimal(data.residualValue);
  const amortizableBase = acquisitionValue.minus(residualValue);
  const annualRate = new Decimal(1).div(data.usefulLifeYears);

  const asset = await prisma.fixedAsset.create({
    data: {
      companyId: data.companyId,
      code: data.code,
      label: data.label,
      description: data.description,
      category: data.category,
      assetAccountCode: data.assetAccountCode,
      amortizationAccountCode: data.amortizationAccountCode,
      dotationAccountCode: data.dotationAccountCode,
      acquisitionDate: new Date(data.acquisitionDate),
      commissioningDate: new Date(data.commissioningDate),
      acquisitionValue: data.acquisitionValue,
      residualValue: data.residualValue,
      amortizableBase: amortizableBase.toNumber(),
      usefulLifeYears: data.usefulLifeYears,
      amortizationMethod: data.amortizationMethod,
      degressiveCoefficient: data.degressiveCoefficient,
      annualRate: annualRate.toDecimalPlaces(4).toNumber(),
      netBookValue: acquisitionValue.toNumber(),
      location: data.location,
      serialNumber: data.serialNumber,
      supplier: data.supplier,
      invoiceReference: data.invoiceReference,
      notes: data.notes,
    },
    include: {
      assetAccount: { select: { code: true, label: true } },
    },
  });

  return NextResponse.json(asset, { status: 201 });
}
