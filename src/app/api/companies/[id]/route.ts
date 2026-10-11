import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { checkPermission } from "@/server/permissions";
import { prisma } from "@/server/prisma";
import { updateCompanySchema } from "@/server/validators/company";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;

    const company = await prisma.company.findUnique({
      where: { id },
      include: {
        journals: { orderBy: { code: "asc" } },
        fiscalYears: { orderBy: { startDate: "desc" } },
        _count: {
          select: {
            accounts: true,
            fixedAssets: true,
          },
        },
      },
    });

    if (!company) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }

    if (company.organizationId !== session.user.organizationId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (!(await checkPermission(id))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    return NextResponse.json(company);
  } catch (error) {
    console.error("Error fetching company:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;

    // Verify the company exists and belongs to the user's organization
    const existing = await prisma.company.findUnique({
      where: { id },
      select: { organizationId: true },
    });

    if (!existing) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }

    if (existing.organizationId !== session.user.organizationId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (!(await checkPermission(id, "canAccessSetup"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const parsed = updateCompanySchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const company = await prisma.company.update({
      where: { id },
      data: parsed.data,
      include: {
        journals: { orderBy: { code: "asc" } },
        fiscalYears: { orderBy: { startDate: "desc" } },
      },
    });

    return NextResponse.json(company);
  } catch (error) {
    console.error("Error updating company:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (session.user.role !== "SUPER_ADMIN" && session.user.role !== "ADMIN") {
      return NextResponse.json(
        { error: "Forbidden: Only admins can delete companies" },
        { status: 403 }
      );
    }

    const { id } = await context.params;

    const existing = await prisma.company.findUnique({
      where: { id },
      select: {
        organizationId: true,
        _count: {
          select: { fiscalYears: true },
        },
      },
    });

    if (!existing) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }

    if (existing.organizationId !== session.user.organizationId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Prevent deletion if there are fiscal years (and thus potential entries)
    if (existing._count.fiscalYears > 0) {
      return NextResponse.json(
        {
          error:
            "Cannot delete a company with existing fiscal years. Deactivate it instead.",
        },
        { status: 409 }
      );
    }

    // Delete related journals first, then the company
    await prisma.$transaction(async (tx) => {
      await tx.journal.deleteMany({ where: { companyId: id } });
      await tx.userCompanyAccess.deleteMany({ where: { companyId: id } });
      await tx.account.deleteMany({ where: { companyId: id } });
      await tx.company.delete({ where: { id } });
    });

    return NextResponse.json({ message: "Company deleted" }, { status: 200 });
  } catch (error) {
    console.error("Error deleting company:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
