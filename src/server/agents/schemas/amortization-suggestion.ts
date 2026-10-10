import { z } from "zod";
import { baseAgentInputSchema } from "../types";

export const amortizationSuggestionOutputSchema = z.object({
  suggestions: z.array(
    z.object({
      type: z.enum([
        "METHOD_RECOMMENDATION",
        "PRORATA_CALCULATION",
        "ANNUAL_DOTATION",
        "DEGRESSIVE_SWITCH",
        "IMPAIRMENT_INDICATION",
        "DISPOSAL_TIMING",
        "OTHER",
      ]),
      confidence: z.number().min(0).max(1),
      description: z.string(),
      currentMethod: z.enum(["LINEAR", "DEGRESSIVE"]).optional(),
      recommendedMethod: z.enum(["LINEAR", "DEGRESSIVE"]).optional(),
      reason: z.string(),
      calculations: z.array(
        z.object({
          year: z.number().int(),
          openingValue: z.number(),
          annualDotation: z.number(),
          cumulativeAmortization: z.number(),
          closingNetValue: z.number(),
          isProrata: z.boolean(),
          methodUsed: z.enum(["LINEAR", "DEGRESSIVE"]),
        })
      ).optional(),
      accountingEntries: z.array(
        z.object({
          accountCode: z.string(),
          label: z.string(),
          debit: z.number(),
          credit: z.number(),
        })
      ).optional(),
    })
  ),
  assetAnalysis: z.object({
    category: z.string(),
    usefulLifeYears: z.number().int(),
    acquisitionValue: z.number(),
    amortizableBase: z.number(),
    residualValue: z.number(),
    standardRate: z.number(),
    recommendedMethod: z.enum(["LINEAR", "DEGRESSIVE"]),
    justification: z.string(),
  }),
  scheduleSummary: z.object({
    totalYears: z.number().int(),
    totalDotations: z.number(),
    finalNetValue: z.number(),
  }),
  warnings: z.array(z.string()),
  summary: z.string(),
});

export const amortizationSuggestionInputSchema = baseAgentInputSchema.extend({
  assetData: z.object({
    code: z.string(),
    label: z.string(),
    category: z.enum([
      "INTANGIBLE",
      "LAND",
      "BUILDINGS",
      "EQUIPMENT",
      "TRANSPORT",
      "IT_EQUIPMENT",
      "FURNITURE",
      "OTHER_TANGIBLE",
      "FINANCIAL",
      "STARTUP_COSTS",
    ]),
    acquisitionDate: z.string().datetime(),
    commissioningDate: z.string().datetime(),
    acquisitionValue: z.number().positive(),
    residualValue: z.number().min(0).default(0),
    usefulLifeYears: z.number().int().positive(),
    currentMethod: z.enum(["LINEAR", "DEGRESSIVE"]).optional(),
    degressiveCoefficient: z.number().optional(),
    fiscalYearStart: z.string().datetime(),
    fiscalYearEnd: z.string().datetime(),
  }),
  existingSchedule: z.array(
    z.object({
      year: z.number().int(),
      annualDotation: z.number(),
      cumulativeAmortization: z.number(),
      closingNetValue: z.number(),
    })
  ).optional(),
});

export type AmortizationSuggestionOutput = z.infer<typeof amortizationSuggestionOutputSchema>;
export type AmortizationSuggestionInput = z.infer<typeof amortizationSuggestionInputSchema>;
