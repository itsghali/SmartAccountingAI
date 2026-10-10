import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/server/auth";
import { checkPermission } from "@/server/permissions";
import { prisma } from "@/server/prisma";
import { z } from "zod";

const createAccountSchema = z.object({
  companyId: z.string(),
  code: z.string().min(1).max(11),
  label: z.string().min(1),
  labelAr: z.string().optional(),
  classNumber: z.number().int().min(1).max(9),
  accountType: z.enum(["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE", "RESULT", "OFF_BALANCE_SHEET"]),
  parentCode: z.string().optional(),
  isAuxiliary: z.boolean().default(false),
  isTiers: z.boolean().default(false),
  requiresAnalytical: z.boolean().default(false),
  vatRate: z.number().optional(),
  vatType: z.enum(["VAT_COLLECTED", "VAT_DEDUCTIBLE_ASSETS", "VAT_DEDUCTIBLE_EXPENSES", "VAT_DUE", "VAT_CREDIT"]).optional(),
});

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const companyId = request.nextUrl.searchParams.get("companyId");
  if (!companyId) return NextResponse.json({ error: "companyId requis" }, { status: 400 });
  if (!(await checkPermission(companyId, "canAccessSetup"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });


  const search = request.nextUrl.searchParams.get("search");
  const classNumber = request.nextUrl.searchParams.get("classNumber");
  const page = parseInt(request.nextUrl.searchParams.get("page") || "1");
  const limit = parseInt(request.nextUrl.searchParams.get("limit") || "50");

  const where: Prisma.AccountWhereInput = { companyId, isActive: true };
  if (classNumber) where.classNumber = Number.parseInt(classNumber, 10);
  if (search) {
    where.OR = [
      { code: { startsWith: search } },
      { label: { contains: search, mode: "insensitive" } },
    ];
  }

  const [accounts, total] = await Promise.all([
    prisma.account.findMany({
      where,
      orderBy: { code: "asc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.account.count({ where }),
  ]);

  return NextResponse.json({ accounts, total, page, limit });
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const body = await request.json();
  const parsed = createAccountSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const data = parsed.data;
  if (!(await checkPermission(data.companyId, "canAccessSetup"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });


  // Check for duplicate
  const existing = await prisma.account.findUnique({
    where: { companyId_code: { companyId: data.companyId, code: data.code } },
  });
  if (existing) {
    return NextResponse.json({ error: "Ce code de compte existe déjà" }, { status: 409 });
  }

  const account = await prisma.account.create({
    data: {
      companyId: data.companyId,
      code: data.code,
      label: data.label,
      labelAr: data.labelAr,
      classNumber: data.classNumber,
      accountType: data.accountType,
      parentCode: data.parentCode,
      isAuxiliary: data.isAuxiliary,
      isTiers: data.isTiers,
      requiresAnalytical: data.requiresAnalytical,
      vatRate: data.vatRate,
      vatType: data.vatType,
    },
  });

  return NextResponse.json(account, { status: 201 });
}
