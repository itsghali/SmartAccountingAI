import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";
import { agentRunner } from "@/server/agents";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = session.user as { id: string; organizationId: string };

  try {
    const body = await request.json();
    const { companyId, fiscalYearId, userPrompt } = body;

    if (!companyId) {
      return NextResponse.json(
        { error: "L'ID société est requis" },
        { status: 400 }
      );
    }

    // Verify company access
    const company = await prisma.company.findFirst({
      where: {
        id: companyId,
        organizationId: user.organizationId,
      },
      select: { id: true, name: true, currency: true },
    });

    if (!company) {
      return NextResponse.json(
        { error: "Société introuvable ou accès refusé" },
        { status: 404 }
      );
    }

    // Check user permissions for payroll
    const userAccess = await prisma.userCompanyAccess.findUnique({
      where: {
        userId_companyId: {
          userId: user.id,
          companyId,
        },
      },
      select: { canAccessEntries: true },
    });

    if (!userAccess?.canAccessEntries) {
      return NextResponse.json(
        { error: "Permissions insuffisantes pour l'analyse de paie" },
        { status: 403 }
      );
    }

    // Gather payroll context data
    const fiscalYear = fiscalYearId
      ? await prisma.fiscalYear.findFirst({
          where: { id: fiscalYearId, companyId },
          select: { id: true, label: true, startDate: true, endDate: true },
        })
      : await prisma.fiscalYear.findFirst({
          where: { companyId, status: "OPEN" },
          orderBy: { startDate: "desc" },
          select: { id: true, label: true, startDate: true, endDate: true },
        });

    // Get recent payslip documents for context with extracted fields
    const payslipDocuments = await prisma.document.findMany({
      where: {
        tenantId: companyId,
        ...(fiscalYear
          ? {
              createdAt: {
                gte: fiscalYear.startDate,
                lte: fiscalYear.endDate,
              },
            }
          : {}),
        documentType: {
          in: ["payslip", "fiche_paie", "bulletin_paie"],
        },
        status: "APPROVED",
      },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        originalFilename: true,
        documentType: true,
        approvedAt: true,
        extractedFields: {
          where: { isCurrent: true },
          select: {
            fieldName: true,
            fieldValue: true,
            confidenceScore: true,
          },
        },
      },
    });

    // Get pending payroll suggestions from previous runs
    const previousSuggestions = await prisma.suggestion.findMany({
      where: {
        companyId,
        agentType: "PAYROLL_SUPPORT",
        status: "PENDING",
        ...(fiscalYear
          ? {
              agentRun: {
                inputSnapshot: {
                  path: ["inputData", "fiscalYearId"],
                  equals: fiscalYear.id,
                },
              },
            }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        label: true,
        value: true,
        confidence: true,
      },
    });

    // Build enriched context for the agent
    const enrichedInputData = {
      company: {
        name: company.name,
        currency: company.currency,
      },
      ...(fiscalYear ? { fiscalYearId: fiscalYear.id } : {}),
      fiscalYear: fiscalYear
        ? {
            id: fiscalYear.id,
            label: fiscalYear.label,
            startDate: fiscalYear.startDate,
            endDate: fiscalYear.endDate,
          }
        : null,
      payslipCount: payslipDocuments.length,
      recentPayslips: payslipDocuments.map((d) => ({
        id: d.id,
        filename: d.originalFilename,
        type: d.documentType,
        approvedAt: d.approvedAt,
        extractedFields: d.extractedFields.map((f) => ({
          fieldName: f.fieldName,
          fieldValue: f.fieldValue,
          confidence: f.confidenceScore,
        })),
      })),
      previousPendingSuggestions: previousSuggestions.map((s) => ({
        label: s.label,
        value: s.value,
        confidence: s.confidence,
      })),
    };

    // Run Agent 4 (PAYROLL_SUPPORT)
    const result = await agentRunner.run(companyId, user.id, {
      agentType: "PAYROLL_SUPPORT",
      userPrompt:
        userPrompt ||
        "Analysez les données de paie pour détecter les anomalies, exceptions et schémas inhabituels.",
      inputData: enrichedInputData,
    });

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || "L'analyse de paie a échoué" },
        { status: 500 }
      );
    }

    // Parse and normalize the output
    const output = result.output as {
      suggestions?: Array<{
        type?: string;
        severity?: string;
        description?: string;
        affectedEmployee?: string;
        suggestedAction?: string;
        confidence?: number;
      }>;
      summary?: string;
    };

    const validSeverities = new Set(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);

    const normalizedSuggestions = (output.suggestions || []).map((s, index) => ({
      id: `payroll-${result.runId}-${index}`,
      type: s.type || "ANOMALY",
      severity: validSeverities.has(s.severity || "")
        ? (s.severity as "LOW" | "MEDIUM" | "HIGH" | "CRITICAL")
        : "MEDIUM",
      description: s.description || "Anomalie détectée",
      affectedEmployee: s.affectedEmployee,
      suggestedAction: s.suggestedAction || "Vérifier manuellement",
      confidence:
        typeof s.confidence === "number"
          ? Math.max(0, Math.min(1, s.confidence))
          : 0.5,
    }));

    return NextResponse.json({
      fiscalYearId: fiscalYear?.id ?? "",
      summary:
        output.summary ||
        `Analyse terminée. ${normalizedSuggestions.length} anomalie(s) détectée(s).`,
      suggestions: normalizedSuggestions,
      runId: result.runId,
      modelVersion: result.modelVersion,
      durationMs: result.durationMs,
    });
  } catch (error) {
    console.error("Payroll analysis error:", error);
    return NextResponse.json(
      { error: "Erreur interne du serveur" },
      { status: 500 }
    );
  }
}
