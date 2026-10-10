import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";
import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";
import { agentRunner } from "@/server/agents";

vi.mock("@/server/auth", () => ({ auth: vi.fn() }));
vi.mock("@/server/prisma", () => ({
  prisma: {
    company: { findFirst: vi.fn() },
    userCompanyAccess: { findUnique: vi.fn() },
  },
}));
vi.mock("@/server/agents", () => ({
  agentRunner: { run: vi.fn() },
  AgentType: {
    VAT_ADVISOR: "VAT_ADVISOR",
    ENTRY_SUGGESTION: "ENTRY_SUGGESTION",
    AMORTIZATION_ADVISOR: "AMORTIZATION_ADVISOR",
    ANOMALY_DETECTOR: "ANOMALY_DETECTOR",
    DOCUMENT_PROCESSOR: "DOCUMENT_PROCESSOR",
    ACCOUNTING_ENTRY_PREPARER: "ACCOUNTING_ENTRY_PREPARER",
    TAX_SUPPORT: "TAX_SUPPORT",
    PAYROLL_SUPPORT: "PAYROLL_SUPPORT",
    CLOSING_REPORTING: "CLOSING_REPORTING",
    AUDIT_COMPLIANCE: "AUDIT_COMPLIANCE",
  },
}));

const supportedAgentTypes = [
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
] as const;

describe("agent execution API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({
      user: { id: "user-1", organizationId: "org-1" },
    } as never);
    vi.mocked(prisma.company.findFirst).mockResolvedValue({ id: "company-1" } as never);
    vi.mocked(prisma.userCompanyAccess.findUnique).mockResolvedValue({
      canAccessEntries: true,
      canAccessVAT: true,
      canAccessFixedAssets: true,
      canAccessReports: true,
    } as never);
    vi.mocked(agentRunner.run).mockResolvedValue({
      success: true,
      runId: "run-1",
      output: { ok: true },
      durationMs: 1,
      modelVersion: "test",
    } as never);
  });

  it.each(supportedAgentTypes)("accepts %s", async (agentType) => {
    const response = await POST(
      new NextRequest("http://localhost:3000/api/agents", {
        method: "POST",
        body: JSON.stringify({
          agentType,
          userPrompt: "Test agent execution",
          companyId: "company-1",
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(agentRunner.run).toHaveBeenCalledWith(
      "company-1",
      "user-1",
      expect.objectContaining({ agentType })
    );
  });
});
