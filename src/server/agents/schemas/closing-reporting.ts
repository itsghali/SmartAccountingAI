import { z } from "zod";
import { baseAgentInputSchema } from "../types";

export const closingSeveritySchema = z.enum([
  "LOW",
  "MEDIUM",
  "HIGH",
  "CRITICAL",
]);

export const closingCheckStatusSchema = z.enum(["PASS", "WARN", "FAIL"]);

export const closingAreaSchema = z.enum([
  "GENERAL_LEDGER",
  "TRIAL_BALANCE",
  "FINANCIAL_STATEMENTS",
  "OPEN_ITEMS",
  "RECONCILIATION",
  "VAT",
  "FIXED_ASSETS",
  "CLOSING_ENTRIES",
  "REPORTING",
  "GENERAL",
]);

export const closingReportCodeSchema = z.enum([
  "TRIAL_BALANCE",
  "BALANCE_SHEET",
  "INCOME_STATEMENT",
  "AGED_BALANCE",
  "CLOSING_CHECKLIST",
]);

const closeMetricMapSchema = z.record(z.string(), z.number());

export const closingConsistencyCheckSchema = z.object({
  type: z.literal("CONSISTENCY_CHECK"),
  title: z.string().min(1),
  description: z.string().min(1),
  area: closingAreaSchema,
  status: closingCheckStatusSchema,
  severity: closingSeveritySchema,
  evidence: z.array(z.string()).default([]),
  recommendedAction: z.string().min(1),
  metrics: closeMetricMapSchema.optional(),
  confidence: z.number().min(0).max(1),
});

export const closingReconciliationPromptSchema = z.object({
  type: z.literal("RECONCILIATION_PROMPT"),
  title: z.string().min(1),
  description: z.string().min(1),
  area: z.enum(["CUSTOMERS", "SUPPLIERS", "BANK", "VAT", "FIXED_ASSETS", "GENERAL"]),
  priority: closingSeveritySchema,
  accountCode: z.string().min(1).optional(),
  accountLabel: z.string().min(1).optional(),
  targetAmount: z.number().optional(),
  openItemCount: z.number().int().min(0).optional(),
  supportingRefs: z.array(z.string()).default([]),
  recommendedAction: z.string().min(1),
  confidence: z.number().min(0).max(1),
});

export const closingDraftReportSchema = z.object({
  type: z.literal("DRAFT_REPORT"),
  title: z.string().min(1),
  description: z.string().min(1),
  reportCode: closingReportCodeSchema,
  periodLabel: z.string().min(1),
  highlights: z.array(z.string()).default([]),
  totals: closeMetricMapSchema.optional(),
  recommendedAction: z.string().optional(),
  confidence: z.number().min(0).max(1),
});

export const closingReportingSuggestionSchema = z.union([
  closingConsistencyCheckSchema,
  closingReconciliationPromptSchema,
  closingDraftReportSchema,
]);

export const closingReportingGovernanceSchema = z.object({
  humanApprovalRequired: z.literal(true),
  postingRecommendation: z.enum([
    "READY_FOR_HUMAN_REVIEW",
    "REVIEW_REQUIRED",
    "BLOCKED",
  ]),
  note: z.string().min(1),
});

export const closingReportingOutputSchema = z.object({
  suggestions: z.array(closingReportingSuggestionSchema).min(1),
  summary: z.string().min(1),
  governance: closingReportingGovernanceSchema,
});

export const closingReportingInputSchema = baseAgentInputSchema.extend({
  fiscalYearId: z.string().min(1).optional(),
  fiscalYear: z.object({
    id: z.string().min(1),
    label: z.string().min(1),
    startDate: z.string().min(1),
    endDate: z.string().min(1),
    status: z.string().min(1),
  }),
  ledgerState: z.object({
    entries: z.object({
      validatedCount: z.number().int().min(0),
      draftCount: z.number().int().min(0),
      closingCount: z.number().int().min(0),
      draftImbalanceCount: z.number().int().min(0),
      lastValidatedEntryDate: z.string().nullable(),
    }),
    trialBalance: z.object({
      totalDebit: z.number(),
      totalCredit: z.number(),
      difference: z.number(),
      balanced: z.boolean(),
      topAccounts: z.array(
        z.object({
          accountCode: z.string().min(1),
          accountLabel: z.string().min(1),
          soldeDebit: z.number(),
          soldeCredit: z.number(),
        })
      ),
    }),
    financialStatements: z.object({
      totalActif: z.number(),
      totalPassif: z.number(),
      balanceGap: z.number(),
      resultatExploitation: z.number(),
      resultatCourant: z.number(),
      resultatNet: z.number(),
    }),
    compliance: z.object({
      pendingSuggestionCount: z.number().int().min(0),
      pendingFixedAssetAmortizations: z.number().int().min(0),
      draftVatDeclarations: z.number().int().min(0),
      computedVatDeclarations: z.number().int().min(0),
      taxPackageStatus: z.string().nullable(),
    }),
  }),
  openItems: z.object({
    agedBalanceSummary: z.object({
      totalReceivables: z.number(),
      totalPayables: z.number(),
      totalOverdue: z.number(),
      rowsCount: z.number().int().min(0),
    }),
    largestOpenItems: z.array(
      z.object({
        tiersName: z.string().min(1),
        accountCode: z.string().min(1),
        accountType: z.enum(["client", "fournisseur"]),
        totalBalance: z.number(),
        overdueAmount: z.number(),
      })
    ),
    bankReconciliation: z.object({
      unreconciledLineCount: z.number().int().min(0),
      unreconciledMovementTotal: z.number(),
      sampleLines: z.array(
        z.object({
          description: z.string().min(1),
          transactionDate: z.string().min(1),
          amount: z.number(),
        })
      ),
    }),
    tiersReconciliation: z.object({
      unletteredCustomerLines: z.number().int().min(0),
      unletteredSupplierLines: z.number().int().min(0),
    }),
  }),
  priorPeriod: z
    .object({
      label: z.string().min(1),
      totalActif: z.number(),
      totalPassif: z.number(),
      balanceGap: z.number(),
      resultatNet: z.number(),
      totalOverdue: z.number(),
    })
    .nullable()
    .optional(),
  reportingRequirements: z.array(z.string()).default([]),
  governanceConstraint: z.string().min(1),
});

export type ClosingReportingOutput = z.infer<typeof closingReportingOutputSchema>;
export type ClosingReportingSuggestion = z.infer<
  typeof closingReportingSuggestionSchema
>;
export type ClosingConsistencyCheck = z.infer<
  typeof closingConsistencyCheckSchema
>;
export type ClosingReconciliationPrompt = z.infer<
  typeof closingReconciliationPromptSchema
>;
export type ClosingDraftReport = z.infer<typeof closingDraftReportSchema>;
