import { z } from "zod";
import { baseAgentInputSchema } from "../types";

export const taxCategorySchema = z.enum([
  "PURCHASE_GOODS",
  "PURCHASE_SERVICE",
  "PURCHASE_ASSET",
  "SALE_GOODS",
  "SALE_SERVICE",
  "UTILITY_EXPENSE",
  "BANK_OR_FINANCIAL",
  "EXEMPT_TRANSACTION",
  "OUT_OF_SCOPE_TRANSACTION",
  "REVERSE_CHARGE_SERVICE",
  "PAYROLL_OR_STAFF",
  "OTHER",
]);

export const vatApplicabilitySchema = z.enum([
  "INPUT_VAT_RECOVERABLE",
  "INPUT_VAT_NON_RECOVERABLE",
  "OUTPUT_VAT_COLLECTED",
  "VAT_EXEMPT",
  "VAT_OUT_OF_SCOPE",
  "VAT_REVERSE_CHARGE",
  "UNKNOWN",
]);

export const vatTreatmentSchema = z.enum([
  "STANDARD_20",
  "REDUCED_14",
  "REDUCED_10",
  "REDUCED_7",
  "ZERO_RATED",
  "EXEMPT",
  "OUT_OF_SCOPE",
  "REVERSE_CHARGE",
  "UNKNOWN",
]);

export const deterministicTaxResultSchema = z.object({
  jurisdictionCode: z.literal("MA"),
  regime: z.enum(["ENCAISSEMENT", "DEBIT"]).nullable(),
  category: taxCategorySchema,
  vatApplicability: vatApplicabilitySchema,
  vatTreatment: vatTreatmentSchema,
  currency: z.string().min(1),
  taxableBase: z.number().min(0),
  vatRatePercent: z.number().min(0).max(100),
  vatAmount: z.number().min(0),
  totalAmount: z.number().min(0),
  deductibleVATAmount: z.number().min(0),
  collectedVATAmount: z.number().min(0),
  computationBasis: z.enum([
    "DOCUMENT_EXPLICIT",
    "SUGGESTED_TREATMENT",
    "MIXED",
    "UNDETERMINED",
  ]),
  engineNotes: z.array(z.string()).default([]),
  edgeCases: z.array(z.string()).default([]),
  requiresHumanReview: z.boolean(),
});

export const taxSupportSuggestionSchema = z.object({
  type: z.literal("DOCUMENT_TAX_CLASSIFICATION"),
  confidence: z.number().min(0).max(1),
  description: z.string().min(1),
  reason: z.string().min(1),
  category: taxCategorySchema,
  vatApplicability: vatApplicabilitySchema,
  vatTreatment: vatTreatmentSchema,
  supportingFields: z.array(z.string()).optional(),
  edgeCases: z.array(z.string()).optional(),
  warnings: z.array(z.string()).optional(),
});

export const taxSupportDeterminationSchema = taxSupportSuggestionSchema.extend({
  engineResult: deterministicTaxResultSchema,
});

export const taxSupportOutputSchema = z.object({
  suggestions: z.array(taxSupportSuggestionSchema).min(1),
  summary: z.string().min(1),
});

export const taxSupportInputSchema = baseAgentInputSchema.extend({
  documentId: z.string().min(1),
  validatedDocument: z.object({
    originalFilename: z.string().min(1),
    documentType: z.string().optional(),
    approvedAt: z.string().optional(),
    fields: z.record(z.string(), z.unknown()),
    lineItems: z.array(z.record(z.string(), z.unknown())).default([]),
    warnings: z.array(z.string()).optional().default([]),
  }),
  jurisdiction: z.object({
    country: z.literal("MA"),
    regime: z.enum(["ENCAISSEMENT", "DEBIT"]).nullable().optional(),
    vatPeriodicity: z.enum(["MONTHLY", "QUARTERLY"]).nullable().optional(),
    chartType: z.enum(["NORMAL", "SIMPLIFIED"]).optional(),
  }),
  historicalTaxSignals: z
    .object({
      vatRatesUsed: z.array(z.number()).default([]),
      recentDeclarationSummaries: z
        .array(
          z.object({
            regime: z.enum(["ENCAISSEMENT", "DEBIT"]),
            periodType: z.enum(["MONTHLY", "QUARTERLY"]),
            totalOutputVAT: z.number().min(0),
            totalInputVAT: z.number().min(0),
          })
        )
        .default([]),
    })
    .optional(),
});

export type TaxSupportOutput = z.infer<typeof taxSupportOutputSchema>;
export type TaxSupportSuggestion = z.infer<typeof taxSupportSuggestionSchema>;
export type TaxSupportDetermination = z.infer<
  typeof taxSupportDeterminationSchema
>;
export type DeterministicTaxResult = z.infer<
  typeof deterministicTaxResultSchema
>;
