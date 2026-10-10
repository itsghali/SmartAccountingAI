import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";
import { createCompanySchema } from "@/server/validators/company";

const DEFAULT_JOURNALS = [
  { code: "AC", label: "Achats", type: "PURCHASES" as const, defaultCounterpartAccountCode: null },
  { code: "VT", label: "Ventes", type: "SALES" as const, defaultCounterpartAccountCode: null },
  { code: "BQ1", label: "Banque", type: "BANK" as const, defaultCounterpartAccountCode: "5141" },
  { code: "CS", label: "Caisse", type: "CASH" as const, defaultCounterpartAccountCode: "5161" },
  { code: "OD", label: "Opérations Diverses", type: "MISCELLANEOUS" as const, defaultCounterpartAccountCode: null },
  { code: "AN", label: "À Nouveaux", type: "OPENING" as const, defaultCounterpartAccountCode: null },
] as const;

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const activeOnly = searchParams.get("active") !== "false";

    const companies = await prisma.company.findMany({
      where: {
        organizationId: session.user.organizationId,
        ...(activeOnly ? { isActive: true } : {}),
      },
      include: {
        _count: {
          select: { fiscalYears: true, journals: true },
        },
      },
      orderBy: { name: "asc" },
    });

    return NextResponse.json(companies);
  } catch (error) {
    console.error("Error fetching companies:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const parsed = createCompanySchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const company = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Create the company
      const newCompany = await tx.company.create({
        data: {
          ...parsed.data,
          organizationId: session.user.organizationId,
        },
      });

      // Create default journals
      await tx.journal.createMany({
        data: DEFAULT_JOURNALS.map((j) => ({
          companyId: newCompany.id,
          code: j.code,
          label: j.label,
          type: j.type,
          defaultCounterpartAccountCode: j.defaultCounterpartAccountCode,
          isSystem: true,
        })),
      });

      // Grant creator full access to the new company
      await tx.userCompanyAccess.create({
        data: {
          userId: session.user.id,
          companyId: newCompany.id,
          canAccessEntries: true,
          canAccessSetup: true,
          canAccessTaxPackage: true,
          canAccessReports: true,
          canAccessAnalytical: true,
        },
      });

      // Return the company with its journals
      return tx.company.findUnique({
        where: { id: newCompany.id },
        include: {
          journals: true,
          _count: {
            select: { fiscalYears: true },
          },
        },
      });
    });

    return NextResponse.json(company, { status: 201 });
  } catch (error) {
    console.error("Error creating company:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
