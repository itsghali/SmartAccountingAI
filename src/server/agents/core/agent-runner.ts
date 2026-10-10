import { z } from "zod";
import Decimal from "decimal.js";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/prisma";
import {
  AgentType,
  AgentRunStatus,
  AgentRunInput,
  AgentRunResult,
  AgentRunRecord,
} from "../types";
import { modelGateway } from "./model-gateway";
import { contextBuilder } from "./context-builder";
import { runAgentGraph } from "../orchestrator/graph";
import {
  vatSuggestionOutputSchema,
  vatSuggestionInputSchema,
  entrySuggestionOutputSchema,
  entrySuggestionInputSchema,
  amortizationSuggestionOutputSchema,
  amortizationSuggestionInputSchema,
  documentExtractionOutputSchema,
  documentExtractionInputSchema,
  accountingEntryPreparerInputSchema,
  accountingEntryPreparerOutputSchema,
  taxSupportInputSchema,
  taxSupportOutputSchema,
  closingReportingInputSchema,
  closingReportingOutputSchema,
  auditComplianceInputSchema,
  auditComplianceOutputSchema,
} from "../schemas";
import {
  isSuggestionStorageUnavailableError,
  persistAgentSuggestions,
} from "@/server/suggestions/service";

const AGENT_SCHEMAS: Record<
  AgentType,
  { output: z.ZodType<unknown>; input: z.ZodType<unknown> }
> = {
  VAT_ADVISOR: {
    output: vatSuggestionOutputSchema,
    input: vatSuggestionInputSchema,
  },
  ENTRY_SUGGESTION: {
    output: entrySuggestionOutputSchema,
    input: entrySuggestionInputSchema,
  },
  AMORTIZATION_ADVISOR: {
    output: amortizationSuggestionOutputSchema,
    input: amortizationSuggestionInputSchema,
  },
  ANOMALY_DETECTOR: {
    output: z.object({
      anomalies: z.array(
        z.object({
          type: z.string(),
          severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
          description: z.string(),
          affectedAccounts: z.array(z.string()).optional(),
          suggestedAction: z.string(),
          confidence: z.number().min(0).max(1),
        })
      ),
      summary: z.string(),
    }),
    input: z.object({
      userPrompt: z.string(),
      dataToAnalyze: z.record(z.string(), z.unknown()).optional(),
    }),
  },
  DOCUMENT_PROCESSOR: {
    output: documentExtractionOutputSchema,
    input: documentExtractionInputSchema,
  },
  ACCOUNTING_ENTRY_PREPARER: {
    output: accountingEntryPreparerOutputSchema,
    input: accountingEntryPreparerInputSchema,
  },
  TAX_SUPPORT: {
    output: taxSupportOutputSchema,
    input: taxSupportInputSchema,
  },
  PAYROLL_SUPPORT: {
    output: z.object({ suggestions: z.array(z.record(z.string(), z.unknown())), summary: z.string() }),
    input: z.object({ userPrompt: z.string() }),
  },
  CLOSING_REPORTING: {
    output: closingReportingOutputSchema,
    input: closingReportingInputSchema,
  },
  AUDIT_COMPLIANCE: {
    output: auditComplianceOutputSchema,
    input: auditComplianceInputSchema,
  },
};

export class AgentRunner {
  async run<T = unknown>(
    companyId: string,
    userId: string,
    input: AgentRunInput
  ): Promise<AgentRunResult<T>> {
    const startTime = Date.now();
    const effectiveConfig = {
      ...modelGateway.getDefaultConfig(),
      ...(input.modelConfig || {}),
    };

    const snapshotInputData = input.inputData
      ? Object.fromEntries(
          Object.entries(input.inputData).filter(
            ([k]) => k !== "imageBase64" && k !== "imageBase64Pages"
          )
        )
      : undefined;
    const inputSnapshot = {
      userPrompt: input.userPrompt,
      ...(snapshotInputData ? { inputData: snapshotInputData } : {}),
      modelConfig: effectiveConfig,
    } as Prisma.InputJsonValue;

    const agentRun = await prisma.agentRun.create({
      data: {
        companyId,
        userId,
        agentType: input.agentType,
        status: AgentRunStatus.PENDING,
        inputSnapshot,
        modelProvider: effectiveConfig.provider,
        modelVersion: modelGateway.getModelVersion(effectiveConfig.model),
      },
    });

    try {
      await prisma.agentRun.update({
        where: { id: agentRun.id },
        data: { status: AgentRunStatus.RUNNING },
      });

      const schemas = AGENT_SCHEMAS[input.agentType];
      if (!schemas) {
        throw new Error(`Unknown agent type: ${input.agentType}`);
      }

      if (input.inputData) {
        const inputValidation = schemas.input.safeParse({
          userPrompt: input.userPrompt,
          ...input.inputData,
        });
        if (!inputValidation.success) {
          throw new Error(
            `Input validation failed: ${inputValidation.error.message}`
          );
        }
      }

      const context = await contextBuilder.buildContext(
        companyId,
        userId,
        input.userPrompt,
        input.inputData || {},
        {
          includeHistoricalPatterns: true,
          patternLimit: 10,
          fiscalYearId:
            typeof input.inputData?.fiscalYearId === "string"
              ? input.inputData.fiscalYearId
              : undefined,
        }
      );

      const sanitizedContext = contextBuilder.sanitizeForAgent(context);
      await prisma.agentRun.update({
        where: { id: agentRun.id },
        data: { contextSnapshot: sanitizedContext as Prisma.InputJsonValue },
      });

      const graphResult = await runAgentGraph(
        context,
        input.agentType,
        effectiveConfig
      );
      const { output, confidence, error, rawOutput } = graphResult;

      if (error || !output) {
        const wrappedError = new Error(
          error || "Workflow failed to produce valid output after maximum iterations"
        );
        (wrappedError as Error & { rawOutput?: string }).rawOutput = rawOutput;
        throw wrappedError;
      }

      const durationMs = Date.now() - startTime;

      await prisma.agentRun.update({
        where: { id: agentRun.id },
        data: {
          status: AgentRunStatus.COMPLETED,
          structuredOutput: output as Prisma.InputJsonValue,
          rawOutput,
          confidence,
          durationMs,
          completedAt: new Date(),
        },
      });

      try {
        await persistAgentSuggestions({
          companyId,
          agentRunId: agentRun.id,
          agentType: input.agentType,
          output: output as Record<string, unknown>,
          documentId:
            typeof input.inputData?.documentId === "string"
              ? input.inputData.documentId
              : undefined,
        });
      } catch (error) {
        if (!isSuggestionStorageUnavailableError(error)) {
          throw error;
        }

        console.warn(
          "[AgentRunner] Suggestion storage unavailable, skipping normalized suggestion persistence."
        );
      }

      return {
        success: true,
        runId: agentRun.id,
        output: output as T,
        confidence,
        durationMs,
        modelVersion: modelGateway.getModelVersion(effectiveConfig.model),
        rawOutput: process.env.NODE_ENV === "development" ? rawOutput : undefined,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      const rawOutput =
        error && typeof error === "object" && "rawOutput" in error
          ? (error as { rawOutput?: string }).rawOutput
          : undefined;

      await prisma.agentRun.update({
        where: { id: agentRun.id },
        data: {
          status: AgentRunStatus.FAILED,
          errorMessage,
          rawOutput,
          durationMs,
          completedAt: new Date(),
        },
      });

      return {
        success: false,
        runId: agentRun.id,
        error: errorMessage,
        durationMs,
        modelVersion: modelGateway.getModelVersion(effectiveConfig.model),
        rawOutput: process.env.NODE_ENV === "development" ? rawOutput : undefined,
      };
    }
  }

  async getRunHistory(
    companyId: string,
    agentType?: AgentType,
    limit: number = 20,
    fiscalYearId?: string
  ): Promise<AgentRunRecord[]> {
    const runs = await prisma.agentRun.findMany({
      where: {
        companyId,
        ...(agentType && { agentType }),
        ...(fiscalYearId
          ? {
              inputSnapshot: {
                path: ["inputData", "fiscalYearId"],
                equals: fiscalYearId,
              },
            }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        agentType: true,
        status: true,
        inputSnapshot: true,
        contextSnapshot: true,
        structuredOutput: true,
        confidence: true,
        modelVersion: true,
        createdAt: true,
        completedAt: true,
      },
    });

    return runs.map((run) => ({
      id: run.id,
      agentType: run.agentType,
      status: run.status,
      modelVersion: run.modelVersion,
      createdAt: run.createdAt,
      completedAt: run.completedAt ? new Date(run.completedAt) : undefined,
      inputSnapshot: run.inputSnapshot as Record<string, unknown>,
      contextSnapshot: run.contextSnapshot as Record<string, unknown> | undefined,
      structuredOutput: run.structuredOutput as Record<string, unknown> | undefined,
      confidence: run.confidence ? new Decimal(run.confidence.toString()) : undefined,
    }));
  }
}

export const agentRunner = new AgentRunner();
