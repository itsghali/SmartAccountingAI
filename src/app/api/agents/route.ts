import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";
import {
  AgentType,
  AgentRunInput,
  agentRunner,
} from "@/server/agents";
import { z } from "zod";

type SupportedAgentType =
  | "VAT_ADVISOR"
  | "ENTRY_SUGGESTION"
  | "AMORTIZATION_ADVISOR"
  | "ANOMALY_DETECTOR"
  | "DOCUMENT_PROCESSOR"
  | "ACCOUNTING_ENTRY_PREPARER"
  | "TAX_SUPPORT"
  | "PAYROLL_SUPPORT"
  | "CLOSING_REPORTING"
  | "AUDIT_COMPLIANCE";

const runAgentSchema = z.object({
  agentType: z.enum([
    "VAT_ADVISOR",
    "ENTRY_SUGGESTION",
    "AMORTIZATION_ADVISOR",
    "ANOMALY_DETECTOR",
    "DOCUMENT_PROCESSOR",
    "ACCOUNTING_ENTRY_PREPARER",
    "TAX_SUPPORT",
    "PAYROLL_SUPPORT",
    "CLOSING_REPORTING",
    "AUDIT_COMPLIANCE",
  ]),
  userPrompt: z.string().min(1).max(5000),
  companyId: z.string(),
  inputData: z.record(z.string(), z.unknown()).optional(),
  fiscalYearId: z.string().optional(),
});

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = session.user as { id: string; organizationId: string };

  try {
    const body = await request.json();
    const validation = runAgentSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid input", details: validation.error.format() },
        { status: 400 }
      );
    }

    const { agentType, userPrompt, companyId, inputData, fiscalYearId } =
      validation.data;

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

    const userCompanyAccess = await prisma.userCompanyAccess.findUnique({
      where: {
        userId_companyId: {
          userId: user.id,
          companyId,
        },
      },
      select: {
        canAccessEntries: true,
        canAccessVAT: true,
        canAccessFixedAssets: true,
        canAccessReports: true,
      },
    });

    if (!userCompanyAccess) {
      return NextResponse.json(
        { error: "Access denied to this company" },
        { status: 403 }
      );
    }

    const requiredPermission: Record<
      SupportedAgentType,
      keyof typeof userCompanyAccess
    > = {
      VAT_ADVISOR: "canAccessVAT",
      ENTRY_SUGGESTION: "canAccessEntries",
      AMORTIZATION_ADVISOR: "canAccessFixedAssets",
      ANOMALY_DETECTOR: "canAccessEntries",
      DOCUMENT_PROCESSOR: "canAccessEntries",
      ACCOUNTING_ENTRY_PREPARER: "canAccessEntries",
      TAX_SUPPORT: "canAccessVAT",
      PAYROLL_SUPPORT: "canAccessEntries",
      CLOSING_REPORTING: "canAccessReports",
      AUDIT_COMPLIANCE: "canAccessReports",
    };

    const permission = requiredPermission[agentType];
    if (!userCompanyAccess[permission]) {
      return NextResponse.json(
        { error: `Insufficient permissions for ${agentType}` },
        { status: 403 }
      );
    }

    const agentInput: AgentRunInput = {
      agentType: agentType as AgentType,
      userPrompt,
      inputData: fiscalYearId
        ? { ...(inputData ?? {}), fiscalYearId }
        : inputData,
    };

    const result = await agentRunner.run(companyId, user.id, agentInput);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || "Agent execution failed" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      runId: result.runId,
      output: result.output,
      confidence: result.confidence?.toString(),
      durationMs: result.durationMs,
      modelVersion: result.modelVersion,
    });
  } catch (error) {
    console.error("Agent execution error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = session.user as { id: string; organizationId: string };

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get("companyId");
  const fiscalYearId = searchParams.get("fiscalYearId");
  const agentType = searchParams.get("agentType") as AgentType | null;
  const limit = parseInt(searchParams.get("limit") || "20", 10);

  if (!companyId) {
    return NextResponse.json(
      { error: "companyId query parameter is required" },
      { status: 400 }
    );
  }

  try {
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

    const history = await agentRunner.getRunHistory(
      companyId,
      agentType || undefined,
      Math.min(limit, 100),
      fiscalYearId || undefined
    );

    return NextResponse.json({
      runs: history.map((run) => ({
        ...run,
        confidence: run.confidence?.toString(),
      })),
    });
  } catch (error) {
    console.error("Get agent history error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
