import { z } from "zod";
import { baseAgentInputSchema } from "../types";

export const entryLineSuggestionSchema = z.object({
  lineNumber: z.number().int().positive(),
  accountCode: z.string(),
  label: z.string(),
  debit: z.number().min(0),
  credit: z.number().min(0),
  tiersName: z.string().optional(),
  tiersReference: z.string().optional(),
  analyticalAllocation: z.array(
    z.object({
      gridCode: z.string(),
      postCode: z.string(),
      percentage: z.number().min(0).max(100),
    })
  ).optional(),
});

export const entrySuggestionOutputSchema = z.object({
  suggestions: z.array(
    z.object({
      type: z.enum([
        "COMPLETE_ENTRY",
        "ACCOUNT_CORRECTION",
        "LABEL_IMPROVEMENT",
        "ANALYTICAL_ALLOCATION",
        "BALANCE_CHECK",
        "VAT_LINE_ADDITION",
        "OTHER",
      ]),
      confidence: z.number().min(0).max(1),
      description: z.string(),
      reason: z.string(),
      proposedLines: z.array(entryLineSuggestionSchema).optional(),
      affectedExistingLines: z.array(z.number().int()).optional(),
      warnings: z.array(z.string()).optional(),
    })
  ),
  entryComplete: z.boolean(),
  totalDebit: z.number(),
  totalCredit: z.number(),
  isBalanced: z.boolean(),
  journalCode: z.string().optional(),
  reference: z.string().optional(),
  description: z.string().optional(),
  summary: z.string(),
});

export const entrySuggestionInputSchema = baseAgentInputSchema.extend({
  partialEntry: z.object({
    journalId: z.string().optional(),
    journalCode: z.string().optional(),
    entryDate: z.string().datetime().optional(),
    reference: z.string().optional(),
    description: z.string(),
    lines: z.array(
      z.object({
        lineNumber: z.number().int(),
        accountCode: z.string(),
        label: z.string(),
        debit: z.number().min(0),
        credit: z.number().min(0),
        tiersName: z.string().optional(),
        tiersReference: z.string().optional(),
      })
    ).optional(),
  }),
  context: z.object({
    supplierName: z.string().optional(),
    invoiceNumber: z.string().optional(),
    invoiceAmount: z.number().optional(),
    vatAmount: z.number().optional(),
    transactionType: z.enum(["PURCHASE", "SALE", "PAYMENT", "RECEIPT", "ADJUSTMENT"]).optional(),
  }).optional(),
});

export type EntrySuggestionOutput = z.infer<typeof entrySuggestionOutputSchema>;
export type EntrySuggestionInput = z.infer<typeof entrySuggestionInputSchema>;
export type EntryLineSuggestion = z.infer<typeof entryLineSuggestionSchema>;
