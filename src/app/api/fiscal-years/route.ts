import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";
import { createFiscalYearSchema } from "@/server/validators/fiscal-year";

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const companyId = searchParams.get("companyId");

    if (!companyId) {
      return NextResponse.json(
        { error: "companyId query parameter is required" },
        { status: 400 }
      );
    }

    // Verify the company belongs to the user's organization
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { organizationId: true },
    });

    if (!company) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }

    if (company.organizationId !== session.user.organizationId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const fiscalYears = await prisma.fiscalYear.findMany({
      where: { companyId },
      include: {
        _count: {
          select: { journalEntries: true },
        },
      },
      orderBy: { startDate: "desc" },
    });

    return NextResponse.json(fiscalYears);
  } catch (error) {
    console.error("Error fetching fiscal years:", error);
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
    const parsed = createFiscalYearSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { companyId, label, startDate, endDate, isDefault } = parsed.data;

    // Verify the company belongs to the user's organization
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { organizationId: true },
    });

    if (!company) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }

    if (company.organizationId !== session.user.organizationId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Check for overlapping fiscal years
    const overlapping = await prisma.fiscalYear.findFirst({
      where: {
        companyId,
        OR: [
          {
            startDate: { lte: endDate },
            endDate: { gte: startDate },
          },
        ],
      },
    });

    if (overlapping) {
      return NextResponse.json(
        {
          error: `Fiscal year overlaps with existing fiscal year "${overlapping.label}" (${overlapping.startDate.toISOString().slice(0, 10)} - ${overlapping.endDate.toISOString().slice(0, 10)})`,
        },
        { status: 409 }
      );
    }

    const fiscalYear = await prisma.$transaction(async (tx) => {
      // If this fiscal year should be the default, unset all others
      if (isDefault) {
        await tx.fiscalYear.updateMany({
          where: { companyId, isDefault: true },
          data: { isDefault: false },
        });
      }

      return tx.fiscalYear.create({
        data: {
          companyId,
          label,
          startDate,
          endDate,
          isDefault,
        },
        include: {
          _count: {
            select: { journalEntries: true },
          },
        },
      });
    });

    return NextResponse.json(fiscalYear, { status: 201 });
  } catch (error: unknown) {
    // Handle unique constraint violation on [companyId, label]
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "A fiscal year with this label already exists for this company" },
        { status: 409 }
      );
    }
    console.error("Error creating fiscal year:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
