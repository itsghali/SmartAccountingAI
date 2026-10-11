import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { checkPermission } from "@/server/permissions";
import { prisma } from "@/server/prisma";
import { updateFiscalYearSchema } from "@/server/validators/fiscal-year";
import {
  runAccountingTransaction,
  lockFiscalYear,
  recordAuditLog,
} from "@/server/accounting-transaction";

type RouteContext = { params: Promise<{ id: string }> };

async function getFiscalYearWithOrgCheck(id: string, organizationId: string) {
  const fiscalYear = await prisma.fiscalYear.findUnique({
    where: { id },
    include: {
      company: {
        select: { organizationId: true },
      },
      _count: {
        select: { journalEntries: true },
      },
    },
  });

  if (!fiscalYear) {
    return { error: "Fiscal year not found", status: 404 as const };
  }

  if (fiscalYear.company.organizationId !== organizationId) {
    return { error: "Forbidden", status: 403 as const };
  }

  return { fiscalYear };
}

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
    const result = await getFiscalYearWithOrgCheck(id, session.user.organizationId);

    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    if (!(await checkPermission(result.fiscalYear.companyId, "canAccessEntries"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    return NextResponse.json(result.fiscalYear);
  } catch (error) {
    console.error("Error fetching fiscal year:", error);
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
    const result = await getFiscalYearWithOrgCheck(id, session.user.organizationId);

    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    if (!(await checkPermission(result.fiscalYear.companyId, "canAccessSetup"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { fiscalYear: existing } = result;

    const body = await request.json();
    const parsed = updateFiscalYearSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    // Changing status to or from CLOSED or PROVISIONAL_CLOSE strictly requires canCloseExercise
    if (parsed.data.status !== undefined && parsed.data.status !== existing.status) {
      if (!(await checkPermission(existing.companyId, "canCloseExercise"))) {
        return NextResponse.json(
          { error: "Droits insuffisants (canCloseExercise requis pour modifier le statut de l'exercice)" },
          { status: 403 }
        );
      }
    }

    // Prevent updates to a CLOSED fiscal year (except reopening by setting status)
    if (existing.status === "CLOSED") {
      // Only allow changing the status on a closed year
      const allowedKeys = Object.keys(parsed.data).filter(
        (k) => parsed.data[k as keyof typeof parsed.data] !== undefined
      );
      if (allowedKeys.length !== 1 || allowedKeys[0] !== "status") {
        return NextResponse.json(
          { error: "Cannot modify a closed fiscal year. Only status can be changed." },
          { status: 409 }
        );
      }

      const updated = await runAccountingTransaction(async (tx) => {
        // Lock FiscalYear exclusively
        await lockFiscalYear(tx, id, existing.companyId, "UPDATE");

        const res = await tx.fiscalYear.update({
          where: { id },
          data: { status: parsed.data.status },
        });

        await recordAuditLog(tx, {
          userId: session.user.id,
          companyId: existing.companyId,
          action: "FISCAL_YEAR_STATUS_CHANGED",
          entityType: "FiscalYear",
          entityId: id,
          details: { previousStatus: existing.status, newStatus: parsed.data.status },
        });

        return res;
      });

      return NextResponse.json(updated);
    }

    const { startDate, endDate, status, isDefault, label } = parsed.data;

    // If dates are being updated, validate duration and overlap
    const newStart = startDate ?? existing.startDate;
    const newEnd = endDate ?? existing.endDate;

    if (newEnd <= newStart) {
      return NextResponse.json(
        { error: "End date must be after start date" },
        { status: 400 }
      );
    }

    const diffMs = newEnd.getTime() - newStart.getTime();
    const diffMonths = diffMs / (1000 * 60 * 60 * 24 * 30.44);

    if (diffMonths > 24) {
      return NextResponse.json(
        { error: "Fiscal year cannot exceed 24 months" },
        { status: 400 }
      );
    }

    // Check for overlaps with other fiscal years (excluding the current one)
    if (startDate || endDate) {
      const overlapping = await prisma.fiscalYear.findFirst({
        where: {
          companyId: existing.companyId,
          id: { not: id },
          startDate: { lte: newEnd },
          endDate: { gte: newStart },
        },
      });

      if (overlapping) {
        return NextResponse.json(
          {
            error: `Fiscal year would overlap with "${overlapping.label}" (${overlapping.startDate.toISOString().slice(0, 10)} - ${overlapping.endDate.toISOString().slice(0, 10)})`,
          },
          { status: 409 }
        );
      }
    }

    // Prevent date changes if there are validated entries
    if ((startDate || endDate) && existing._count.journalEntries > 0) {
      return NextResponse.json(
        { error: "Cannot change dates of a fiscal year that has journal entries" },
        { status: 409 }
      );
    }

    const fiscalYear = await runAccountingTransaction(async (tx) => {
      // Lock FiscalYear exclusively if status is changing
      if (status !== undefined) {
        await lockFiscalYear(tx, id, existing.companyId, "UPDATE");
      }

      // If setting as default, unset others
      if (isDefault) {
        await tx.fiscalYear.updateMany({
          where: { companyId: existing.companyId, isDefault: true, id: { not: id } },
          data: { isDefault: false },
        });
      }

      const res = await tx.fiscalYear.update({
        where: { id },
        data: {
          ...(label !== undefined && { label }),
          ...(startDate !== undefined && { startDate }),
          ...(endDate !== undefined && { endDate }),
          ...(status !== undefined && { status }),
          ...(isDefault !== undefined && { isDefault }),
        },
        include: {
          _count: {
            select: { journalEntries: true },
          },
        },
      });

      if (status !== undefined && status !== existing.status) {
        await recordAuditLog(tx, {
          userId: session.user.id,
          companyId: existing.companyId,
          action: "FISCAL_YEAR_STATUS_CHANGED",
          entityType: "FiscalYear",
          entityId: id,
          details: { previousStatus: existing.status, newStatus: status },
        });
      }

      return res;
    });

    return NextResponse.json(fiscalYear);
  } catch (error: unknown) {
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
    console.error("Error updating fiscal year:", error);
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

    const { id } = await context.params;
    const result = await getFiscalYearWithOrgCheck(id, session.user.organizationId);

    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    const { fiscalYear } = result;

    if (!(await checkPermission(fiscalYear.companyId, "canAccessSetup"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Prevent deletion of fiscal years with journal entries
    if (fiscalYear._count.journalEntries > 0) {
      return NextResponse.json(
        { error: "Cannot delete a fiscal year that has journal entries" },
        { status: 409 }
      );
    }

    // Prevent deletion of closed fiscal years
    if (fiscalYear.status === "CLOSED") {
      return NextResponse.json(
        { error: "Cannot delete a closed fiscal year" },
        { status: 409 }
      );
    }

    await prisma.fiscalYear.delete({ where: { id } });

    return NextResponse.json({ message: "Fiscal year deleted" }, { status: 200 });
  } catch (error) {
    console.error("Error deleting fiscal year:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
