import { z } from "zod";
import { baseAgentInputSchema } from "../types";

export const auditSeveritySchema = z.enum([
  "LOW",
  "MEDIUM",
  "HIGH",
  "CRITICAL",
]);

export const auditAreaSchema = z.enum([
  "TRANSACTION_PATTERN",
  "USER_BEHAVIOR",
  "DOCUMENT_WORKFLOW",
  "APPROVAL_TRAIL",
  "ACCESS_CONTROL",
  "JOURNAL_CONTROL",
  "GENERAL",
]);

export const suspiciousBehaviorCategorySchema = z.enum([
  "CONCENTRATED_ACTIVITY",
  "REPROCESSING_SPIKE",
  "REVIEW_OVERRIDE_PATTERN",
  "WEEKEND_ACTIVITY",
  "REVERSAL_PATTERN",
  "DUPLICATE_REFERENCE_PATTERN",
  "OTHER",
]);

export const auditFocusAreaSchema = z.enum([
  "TRANSACTION_HISTORY",
  "USER_BEHAVIOR",
  "DOCUMENT_WORKFLOW",
  "APPROVAL_TRAIL",
  "GENERAL",
]);

export const auditEntityTypeSchema = z.enum([
  "JOURNAL_ENTRY",
  "DOCUMENT",
  "USER",
  "SUGGESTION",
  "AUDIT_LOG",
  "GENERAL",
]);

const numericMapSchema = z.record(z.string(), z.number());

export const auditAnomalyAlertSchema = z.object({
  type: z.literal("ANOMALY_ALERT"),
  title: z.string().min(1),
  description: z.string().min(1),
  area: auditAreaSchema,
  severity: auditSeveritySchema,
  relatedEntityType: auditEntityTypeSchema.optional(),
  relatedEntityIds: z.array(z.string()).optional(),
  evidence: z.array(z.string()).default([]),
  metrics: numericMapSchema.optional(),
  recommendedInvestigation: z.string().min(1),
  confidence: z.number().min(0).max(1),
});

export const suspiciousBehaviorFlagSchema = z.object({
  type: z.literal("SUSPICIOUS_BEHAVIOR_FLAG"),
  title: z.string().min(1),
  description: z.string().min(1),
  behaviorCategory: suspiciousBehaviorCategorySchema,
  severity: auditSeveritySchema,
  actorId: z.string().optional(),
  actorName: z.string().optional(),
  evidence: z.array(z.string()).default([]),
  recommendedInvestigation: z.string().min(1),
  confidence: z.number().min(0).max(1),
});

export const auditSupportNoteSchema = z.object({
  type: z.literal("AUDIT_SUPPORT_NOTE"),
  title: z.string().min(1),
  description: z.string().min(1),
  focusArea: auditFocusAreaSchema,
  highlights: z.array(z.string()).default([]),
  recommendedProcedure: z.string().min(1),
  confidence: z.number().min(0).max(1),
});

export const auditComplianceSuggestionSchema = z.union([
  auditAnomalyAlertSchema,
  suspiciousBehaviorFlagSchema,
  auditSupportNoteSchema,
]);

export const auditComplianceGovernanceSchema = z.object({
  readOnlyAccess: z.literal(true),
  autonomousDecisioningAllowed: z.literal(false),
  humanInterpretationRequired: z.literal(true),
  note: z.string().min(1),
});

export const auditComplianceOutputSchema = z.object({
  suggestions: z.array(auditComplianceSuggestionSchema).min(1),
  summary: z.string().min(1),
  governance: auditComplianceGovernanceSchema,
});

export const auditComplianceInputSchema = baseAgentInputSchema.extend({
  fiscalYearId: z.string().min(1).optional(),
  fiscalYear: z.object({
    id: z.string().min(1),
    label: z.string().min(1),
    startDate: z.string().min(1),
    endDate: z.string().min(1),
    status: z.string().min(1),
  }),
  transactionHistory: z.object({
    entryCounts: z.object({
      draft: z.number().int().min(0),
      validated: z.number().int().min(0),
      reversed: z.number().int().min(0),
    }),
    totals: z.object({
      totalDebit: z.number(),
      totalCredit: z.number(),
      averageEntryAmount: z.number(),
      highValueThreshold: z.number(),
      highValueEntryCount: z.number().int().min(0),
    }),
    anomalySignals: z.object({
      duplicateReferenceCount: z.number().int().min(0),
      weekendEntryCount: z.number().int().min(0),
      staleDraftCount: z.number().int().min(0),
      reversalCount: z.number().int().min(0),
    }),
    journalDistribution: z.array(
      z.object({
        journalCode: z.string().min(1),
        journalLabel: z.string().min(1),
        entryCount: z.number().int().min(0),
        totalAmount: z.number(),
      })
    ),
    topTransactions: z.array(
      z.object({
        id: z.string().min(1),
        entryNumber: z.number().int().min(0),
        journalCode: z.string().min(1),
        status: z.string().min(1),
        description: z.string().min(1),
        amount: z.number(),
        reference: z.string().nullable(),
        entryDate: z.string().min(1),
        createdById: z.string().min(1),
        createdByName: z.string().min(1),
      })
    ),
  }),
  auditRules: z.array(z.string()).min(1),
  userBehaviorPatterns: z.object({
    auditLogSummary: z.object({
      totalEvents: z.number().int().min(0),
      reprocessEvents: z.number().int().min(0),
      correctionEvents: z.number().int().min(0),
      bulkReviewEvents: z.number().int().min(0),
    }),
    activeUsers: z.array(
      z.object({
        userId: z.string().min(1),
        name: z.string().min(1),
        entryCreatedCount: z.number().int().min(0),
        auditEventCount: z.number().int().min(0),
        documentUploads: z.number().int().min(0),
        reprocessActions: z.number().int().min(0),
        reviewActions: z.number().int().min(0),
        sensitiveActionCount: z.number().int().min(0),
        latestActivityAt: z.string().nullable(),
        anomalySignals: z.array(z.string()).default([]),
      })
    ),
  }),
  workflowSignals: z.object({
    pendingSuggestions: z.number().int().min(0),
    correctedSuggestions: z.number().int().min(0),
    reviewRequiredDocuments: z.number().int().min(0),
    rejectedDocuments: z.number().int().min(0),
    approvedDocuments: z.number().int().min(0),
    failedDocuments: z.number().int().min(0),
  }),
  priorPeriod: z
    .object({
      label: z.string().min(1),
      reversalCount: z.number().int().min(0),
      duplicateReferenceCount: z.number().int().min(0),
      weekendEntryCount: z.number().int().min(0),
      pendingSuggestions: z.number().int().min(0),
    })
    .nullable()
    .optional(),
  governanceConstraint: z.string().min(1),
});

export type AuditComplianceOutput = z.infer<typeof auditComplianceOutputSchema>;
export type AuditComplianceSuggestion = z.infer<
  typeof auditComplianceSuggestionSchema
>;
