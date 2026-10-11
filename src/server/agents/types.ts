import { AgentType, AgentRunStatus } from "@prisma/client";
import { Decimal } from "decimal.js";
import { z } from "zod";

export { AgentType, AgentRunStatus };

export interface TenantConfig {
  companyId: string;
  organizationId: string;
  userId: string;
  company: {
    name: string;
    legalForm?: string | null;
    chartType: string;
    currency: string;
    ice?: string | null;
    rc?: string | null;
    patente?: string | null;
  };
  fiscalYear?: {
    id: string;
    label: string;
    startDate: Date;
    endDate: Date;
    status: string;
  } | null;
}

export interface JurisdictionContext {
  country: "MA";
  regime?: "ENCAISSEMENT" | "DEBIT";
  vatPeriodicity?: "MONTHLY" | "QUARTERLY";
  chartType: "NORMAL" | "SIMPLIFIED";
}

export interface HistoricalPatterns {
  commonAccounts: Array<{
    code: string;
    label: string;
    usageCount: number;
  }>;
  recentEntries: Array<{
    description: string;
    accountCodes: string[];
    totalAmount: Decimal;
    date: Date;
  }>;
  vatRatesUsed: number[];
  averageMonthlyRevenue?: Decimal;
  anomalyPatterns?: string[];
}

export interface AgentContext {
  tenant: TenantConfig;
  jurisdiction: JurisdictionContext;
  patterns?: HistoricalPatterns;
  userPrompt: string;
  inputData?: Record<string, unknown>;
}

export interface ModelConfig {
  provider: "openai" | "groq" | "openrouter" | "ollama";
  model: string;
  temperature: number;
  maxTokens?: number;
}

export interface AgentRunInput {
  agentType: AgentType;
  userPrompt: string;
  inputData?: Record<string, unknown>;
  modelConfig?: Partial<ModelConfig>;
}

export interface AgentRunResult<T = unknown> {
  success: boolean;
  runId: string;
  output?: T;
  confidence?: Decimal;
  error?: string;
  durationMs: number;
  modelVersion: string;
  rawOutput?: string;
}

export interface AgentRunRecord {
  id: string;
  agentType: AgentType;
  status: AgentRunStatus;
  inputSnapshot: Record<string, unknown>;
  contextSnapshot?: Record<string, unknown>;
  structuredOutput?: Record<string, unknown>;
  confidence?: Decimal;
  modelVersion: string;
  createdAt: Date;
  completedAt?: Date;
}

export const baseAgentInputSchema = z.object({
  userPrompt: z.string().min(1, 'User prompt must be at least 1 character').max(5000, 'User prompt must be at most 5000 characters'),
  inputData: z.record(z.string(), z.unknown()).optional(),
});

export type BaseAgentInput = z.infer<typeof baseAgentInputSchema>;
