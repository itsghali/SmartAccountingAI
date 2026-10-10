import { z } from "zod";
import { baseAgentInputSchema } from "../types";

export const vatSuggestionOutputSchema = z.object({
  suggestions: z.array(
    z.object({
      type: z.enum([
        "VAT_RATE_CORRECTION",
        "MISSING_DEDUCTION",
        "PERIOD_TIMING",
        "CREDIT_CARRYFORWARD",
        "REGIME_RECOMMENDATION",
        "OTHER",
      ]),
      severity: z.enum(["INFO", "WARNING", "CRITICAL"]),
      description: z.string(),
      accountCode: z.string().optional(),
      affectedAmount: z.number().optional(),
      recommendation: z.string(),
      confidence: z.number().min(0).max(1),
    })
  ),
  summary: z.string(),
  computedTotals: z.object({
    outputVAT: z.number(),
    inputVAT: z.number(),
    netVAT: z.number(),
    previousCreditApplied: z.number(),
    isCredit: z.boolean(),
    creditToCarryForward: z.number(),
  }),
  risks: z.array(
    z.object({
      riskType: z.string(),
      description: z.string(),
      mitigation: z.string(),
    })
  ),
});

export const vatSuggestionInputSchema = baseAgentInputSchema.extend({
  declarationData: z.object({
    periodType: z.enum(["MONTHLY", "QUARTERLY"]),
    periodIndex: z.number().int().min(1).max(12),
    startDate: z.string().datetime(),
    endDate: z.string().datetime(),
    regime: z.enum(["ENCAISSEMENT", "DEBIT"]),
    previousCredit: z.number().default(0),
  }).optional(),
  draftValues: z.record(z.string(), z.number()).optional(),
});

export type VatSuggestionOutput = z.infer<typeof vatSuggestionOutputSchema>;
export type VatSuggestionInput = z.infer<typeof vatSuggestionInputSchema>;
