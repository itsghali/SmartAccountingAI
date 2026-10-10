import { z } from "zod";
import { baseAgentInputSchema } from "../types";

export const accountingEntryProposalLineSchema = z.object({
  lineNumber: z.number().int().positive(),
  accountCode: z.string().min(1),
  accountLabel: z.string().min(1),
  label: z.string().min(1),
  debit: z.number().min(0),
  credit: z.number().min(0),
  confidence: z.number().min(0).max(1),
  rationale: z.string().optional(),
  tiersName: z.string().optional(),
  tiersReference: z.string().optional(),
});

export const accountingEntryClassificationSchema = z.object({
  fieldName: z.string().min(1),
  matchedAccountCode: z.string().min(1),
  matchedAccountLabel: z.string().min(1),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1),
});

export const accountingEntryProposalSchema = z.object({
  journalCode: z.string().min(1),
  journalLabel: z.string().min(1),
  entryDate: z.string().min(1),
  reference: z.string().optional(),
  description: z.string().min(1),
  documentType: z.string().optional(),
  lines: z.array(accountingEntryProposalLineSchema).min(2),
  totalDebit: z.number().min(0),
  totalCredit: z.number().min(0),
  isBalanced: z.boolean(),
});

export const accountingEntrySuggestionSchema = z.object({
  type: z.literal("PROPOSED_JOURNAL_ENTRY"),
  confidence: z.number().min(0).max(1),
  description: z.string().min(1),
  reason: z.string().min(1),
  proposedEntry: accountingEntryProposalSchema,
  accountClassification: z.array(accountingEntryClassificationSchema).optional(),
  warnings: z.array(z.string()).optional(),
});

export const accountingEntryPreparerOutputSchema = z.object({
  suggestions: z.array(accountingEntrySuggestionSchema).min(1),
  summary: z.string().min(1),
});

export const accountingEntryPreparerInputSchema = baseAgentInputSchema.extend({
  documentId: z.string().min(1),
  validatedDocument: z.object({
    originalFilename: z.string().min(1),
    documentType: z.string().optional(),
    approvedAt: z.string().optional(),
    fields: z.record(z.string(), z.unknown()),
    lineItems: z.array(z.record(z.string(), z.unknown())).default([]),
    warnings: z.array(z.string()).optional().default([]),
  }),
  availableJournals: z.array(
    z.object({
      code: z.string().min(1),
      label: z.string().min(1),
      type: z.string().min(1),
    })
  ),
  relevantAccounts: z.array(
    z.object({
      code: z.string().min(1),
      label: z.string().min(1),
      classNumber: z.number().int().optional(),
      accountType: z.string().optional(),
    })
  ),
  historicalEntries: z
    .array(
      z.object({
        journalCode: z.string().min(1),
        journalLabel: z.string().min(1),
        description: z.string().min(1),
        reference: z.string().nullable().optional(),
        entryDate: z.string().optional(),
        lines: z.array(
          z.object({
            accountCode: z.string().min(1),
            accountLabel: z.string().min(1),
            debit: z.number().min(0),
            credit: z.number().min(0),
          })
        ),
      })
    )
    .optional()
    .default([]),
});

export type AccountingEntryProposalOutput = z.infer<
  typeof accountingEntryPreparerOutputSchema
>;
export type AccountingEntryProposalInput = z.infer<
  typeof accountingEntryPreparerInputSchema
>;
export type AccountingEntryProposal = z.infer<
  typeof accountingEntryProposalSchema
>;
export type AccountingEntryProposalLine = z.infer<
  typeof accountingEntryProposalLineSchema
>;
