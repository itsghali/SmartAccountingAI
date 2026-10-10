import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";
import { runAuditCompliance } from "@/server/audit-compliance/service";

const runAuditComplianceSchema = z.object({
  companyId: z.string().min(1),
  fiscalYearId: z.string().min(1).optional(),
  userPrompt: z.string().min(1).max(5000).optional(),
});

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = session.user as { id: string; organizationId: string };

  try {
    const body = await request.json();
    const validation = runAuditComplianceSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid input", details: validation.error.format() },
        { status: 400 }
      );
    }

    const { companyId, fiscalYearId, userPrompt } = validation.data;

    const company = await prisma.company.findFirst({
      where: {
        id: companyId,
        organizationId: user.organizationId,
      },
      select: { id: true },
    });

    if (!company) {
      return NextResponse.json(
        { error: "Company not found or access denied" },
        { status: 404 }
      );
    }

    const access = await prisma.userCompanyAccess.findUnique({
      where: {
        userId_companyId: {
          userId: user.id,
          companyId,
        },
      },
      select: {
        canAccessReports: true,
      },
    });

    if (!access?.canAccessReports) {
      return NextResponse.json(
        { error: "Insufficient permissions for audit preparation" },
        { status: 403 }
      );
    }

    const result = await runAuditCompliance({
      companyId,
      userId: user.id,
      fiscalYearId,
      userPrompt,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Audit & compliance analysis error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
