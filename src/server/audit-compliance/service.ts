import { AgentType, SuggestionStatus } from "@prisma/client";
import Decimal from "decimal.js";
import { agentRunner } from "@/server/agents";
import {
  auditComplianceOutputSchema,
  type AuditComplianceOutput,
} from "@/server/agents/schemas";
import { prisma } from "@/server/prisma";

const DEFAULT_AUDIT_RULES = [
  "Flag duplicate references across non-draft entries for human investigation.",
  "Flag stale draft entries older than 30 days that still affect period workflows.",
  "Flag postings dated on weekends as unusual timing signals for review.",
  "Flag reversal-heavy activity and reprocessing spikes in document workflows.",
  "Flag users with concentrated sensitive actions such as reprocesses, corrections, or bulk reviews.",
] as const;

const GOVERNANCE_CONSTRAINT =
  "Read-only access to records; the agent cannot modify underlying data; all alerts require human interpretation.";

const DEFAULT_AUDIT_PROMPT =
  "Analysez l'historique transactionnel, les traces d'audit et les comportements utilisateurs pour faire ressortir les anomalies, signaux inhabituels et points d'attention utiles aux auditeurs, sans prendre de decision autonome.";

const REPROCESS_ACTIONS = new Set(["DOCUMENT_REPROCESS"]);
const REVIEW_ACTIONS = new Set([
  "SUGGESTION_REVIEWED",
  "SUGGESTION_BULK_REVIEW",
  "FIELD_REVIEWED",
  "FIELD_CORRECTED",
]);
const SENSITIVE_ACTIONS = new Set([
  "DOCUMENT_REPROCESS",
  "FIELD_CORRECTED",
  "SUGGESTION_BULK_REVIEW",
  "DOCUMENT_REJECTED",
]);

function amount(value: Decimal.Value) {
  return new Decimal(value).toDecimalPlaces(2).toNumber();
}

function entryAmount(totalDebit: Decimal.Value, totalCredit: Decimal.Value) {
  return amount(
    Decimal.max(new Decimal(totalDebit), new Decimal(totalCredit))
  );
}

function isWeekend(date: Date) {
  const day = date.getDay();
  return day === 0 || day === 6;
}

function maxIsoDate(current: string | null, next: Date) {
  const nextIso = next.toISOString();
  if (!current) {
    return nextIso;
  }

  return current > nextIso ? current : nextIso;
}

async function resolveFiscalYear(companyId: string, fiscalYearId?: string) {
  if (fiscalYearId) {
    return prisma.fiscalYear.findFirst({
      where: {
        id: fiscalYearId,
        companyId,
      },
      select: {
        id: true,
        label: true,
        startDate: true,
        endDate: true,
        status: true,
      },
    });
  }

  return prisma.fiscalYear.findFirst({
    where: { companyId },
    orderBy: [{ isDefault: "desc" }, { startDate: "desc" }],
    select: {
      id: true,
      label: true,
      startDate: true,
      endDate: true,
      status: true,
    },
  });
}

async function buildAuditSnapshot(
  companyId: string,
  fiscalYear: {
    id: string;
    label: string;
    startDate: Date;
    endDate: Date;
    status: string;
  }
) {
  const [entries, auditLogs, suggestionsSummary, documentsSummary] =
    await Promise.all([
      prisma.journalEntry.findMany({
        where: {
          fiscalYearId: fiscalYear.id,
          journal: {
            companyId,
          },
        },
        select: {
          id: true,
          entryNumber: true,
          entryDate: true,
          createdAt: true,
          description: true,
          reference: true,
          status: true,
          totalDebit: true,
          totalCredit: true,
          isReversal: true,
          createdById: true,
          journal: {
            select: {
              code: true,
              label: true,
            },
          },
          createdBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      }),
      prisma.auditLog.findMany({
        where: {
          companyId,
          createdAt: {
            gte: fiscalYear.startDate,
            lte: fiscalYear.endDate,
          },
        },
        select: {
          id: true,
          userId: true,
          action: true,
          entityType: true,
          createdAt: true,
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      }),
      prisma.suggestion.groupBy({
        by: ["status"],
        where: {
          companyId,
          createdAt: {
            gte: fiscalYear.startDate,
            lte: fiscalYear.endDate,
          },
        },
        _count: {
          status: true,
        },
      }),
      prisma.document.groupBy({
        by: ["status"],
        where: {
          tenantId: companyId,
          createdAt: {
            gte: fiscalYear.startDate,
            lte: fiscalYear.endDate,
          },
        },
        _count: {
          status: true,
        },
      }),
    ]);

  const entryCounts = {
    draft: entries.filter((entry) => entry.status === "DRAFT").length,
    validated: entries.filter((entry) => entry.status === "VALIDATED").length,
    reversed: entries.filter((entry) => entry.status === "REVERSED").length,
  };

  const totalDebit = entries.reduce(
    (sum, entry) => sum.plus(entry.totalDebit.toString()),
    new Decimal(0)
  );
  const totalCredit = entries.reduce(
    (sum, entry) => sum.plus(entry.totalCredit.toString()),
    new Decimal(0)
  );

  const entryAmounts = entries.map((entry) =>
    Decimal.max(
      new Decimal(entry.totalDebit.toString()),
      new Decimal(entry.totalCredit.toString())
    )
  );
  const totalEntryAmount = entryAmounts.reduce(
    (sum, value) => sum.plus(value),
    new Decimal(0)
  );
  const averageEntryAmount =
    entryAmounts.length > 0
      ? totalEntryAmount.div(entryAmounts.length)
      : new Decimal(0);
  const highValueThreshold = Decimal.max(
    averageEntryAmount.mul(3),
    new Decimal(10000)
  );
  const highValueEntryCount = entryAmounts.filter((value) =>
    value.greaterThanOrEqualTo(highValueThreshold)
  ).length;

  const duplicateReferenceMap = new Map<string, number>();
  for (const entry of entries) {
    const reference = entry.reference?.trim();
    if (!reference || entry.status === "DRAFT") {
      continue;
    }

    duplicateReferenceMap.set(
      reference,
      (duplicateReferenceMap.get(reference) ?? 0) + 1
    );
  }
  const duplicateReferenceCount = [...duplicateReferenceMap.values()].filter(
    (count) => count > 1
  ).length;

  const staleDraftThreshold = new Date();
  staleDraftThreshold.setDate(staleDraftThreshold.getDate() - 30);
  const staleDraftCount = entries.filter(
    (entry) =>
      entry.status === "DRAFT" && new Date(entry.createdAt) < staleDraftThreshold
  ).length;
  const weekendEntryCount = entries.filter((entry) =>
    isWeekend(new Date(entry.entryDate))
  ).length;
  const reversalCount = entries.filter(
    (entry) => entry.status === "REVERSED" || entry.isReversal
  ).length;

  const journalDistributionMap = new Map<
    string,
    {
      journalCode: string;
      journalLabel: string;
      entryCount: number;
      totalAmount: Decimal;
    }
  >();
  for (const entry of entries) {
    const key = entry.journal.code;
    const current = journalDistributionMap.get(key) ?? {
      journalCode: entry.journal.code,
      journalLabel: entry.journal.label,
      entryCount: 0,
      totalAmount: new Decimal(0),
    };
    current.entryCount += 1;
    current.totalAmount = current.totalAmount.plus(
      Decimal.max(
        new Decimal(entry.totalDebit.toString()),
        new Decimal(entry.totalCredit.toString())
      )
    );
    journalDistributionMap.set(key, current);
  }

  const topTransactions = [...entries]
    .sort((left, right) => {
      const leftAmount = entryAmount(left.totalDebit, left.totalCredit);
      const rightAmount = entryAmount(right.totalDebit, right.totalCredit);
      return rightAmount - leftAmount;
    })
    .slice(0, 10)
    .map((entry) => ({
      id: entry.id,
      entryNumber: entry.entryNumber,
      journalCode: entry.journal.code,
      status: entry.status,
      description: entry.description,
      amount: entryAmount(entry.totalDebit, entry.totalCredit),
      reference: entry.reference,
      entryDate: entry.entryDate.toISOString(),
      createdById: entry.createdById,
      createdByName: `${entry.createdBy.firstName} ${entry.createdBy.lastName}`.trim(),
    }));

  const userPatternsMap = new Map<
    string,
    {
      userId: string;
      name: string;
      entryCreatedCount: number;
      auditEventCount: number;
      documentUploads: number;
      reprocessActions: number;
      reviewActions: number;
      sensitiveActionCount: number;
      latestActivityAt: string | null;
      anomalySignals: string[];
    }
  >();

  for (const entry of entries) {
    const userId = entry.createdById;
    const current = userPatternsMap.get(userId) ?? {
      userId,
      name: `${entry.createdBy.firstName} ${entry.createdBy.lastName}`.trim(),
      entryCreatedCount: 0,
      auditEventCount: 0,
      documentUploads: 0,
      reprocessActions: 0,
      reviewActions: 0,
      sensitiveActionCount: 0,
      latestActivityAt: null,
      anomalySignals: [],
    };

    current.entryCreatedCount += 1;
    current.latestActivityAt = maxIsoDate(current.latestActivityAt, entry.createdAt);
    userPatternsMap.set(userId, current);
  }

  for (const log of auditLogs) {
    const userId = log.userId;
    const current = userPatternsMap.get(userId) ?? {
      userId,
      name: `${log.user.firstName} ${log.user.lastName}`.trim(),
      entryCreatedCount: 0,
      auditEventCount: 0,
      documentUploads: 0,
      reprocessActions: 0,
      reviewActions: 0,
      sensitiveActionCount: 0,
      latestActivityAt: null,
      anomalySignals: [],
    };

    current.auditEventCount += 1;
    if (log.action === "DOCUMENT_UPLOADED") {
      current.documentUploads += 1;
    }
    if (REPROCESS_ACTIONS.has(log.action)) {
      current.reprocessActions += 1;
    }
    if (REVIEW_ACTIONS.has(log.action)) {
      current.reviewActions += 1;
    }
    if (SENSITIVE_ACTIONS.has(log.action)) {
      current.sensitiveActionCount += 1;
    }
    current.latestActivityAt = maxIsoDate(current.latestActivityAt, log.createdAt);

    userPatternsMap.set(userId, current);
  }

  const averageEntriesPerUser =
    userPatternsMap.size > 0
      ? entries.length / userPatternsMap.size
      : 0;

  const activeUsers = [...userPatternsMap.values()]
    .map((user) => {
      const anomalySignals: string[] = [];
      if (user.reprocessActions >= 3) {
        anomalySignals.push("Frequent document reprocessing activity.");
      }
      if (user.sensitiveActionCount >= 5) {
        anomalySignals.push("High concentration of sensitive review actions.");
      }
      if (
        averageEntriesPerUser > 0 &&
        user.entryCreatedCount > averageEntriesPerUser * 2
      ) {
        anomalySignals.push("Entry creation volume is materially above peer average.");
      }

      return {
        ...user,
        anomalySignals,
      };
    })
    .sort(
      (left, right) =>
        right.sensitiveActionCount - left.sensitiveActionCount ||
        right.auditEventCount - left.auditEventCount ||
        right.entryCreatedCount - left.entryCreatedCount
    )
    .slice(0, 10);

  const suggestionStatusCount = (
    targetStatus: SuggestionStatus
  ) =>
    suggestionsSummary.find((item) => item.status === targetStatus)?._count
      .status ?? 0;
  const documentStatusCount = (targetStatus: string) =>
    documentsSummary.find((item) => item.status === targetStatus)?._count.status ??
    0;

  return {
    fiscalYear: {
      id: fiscalYear.id,
      label: fiscalYear.label,
      startDate: fiscalYear.startDate.toISOString(),
      endDate: fiscalYear.endDate.toISOString(),
      status: fiscalYear.status,
    },
    transactionHistory: {
      entryCounts,
      totals: {
        totalDebit: amount(totalDebit),
        totalCredit: amount(totalCredit),
        averageEntryAmount: amount(averageEntryAmount),
        highValueThreshold: amount(highValueThreshold),
        highValueEntryCount,
      },
      anomalySignals: {
        duplicateReferenceCount,
        weekendEntryCount,
        staleDraftCount,
        reversalCount,
      },
      journalDistribution: [...journalDistributionMap.values()]
        .sort((left, right) => right.totalAmount.comparedTo(left.totalAmount))
        .map((journal) => ({
          journalCode: journal.journalCode,
          journalLabel: journal.journalLabel,
          entryCount: journal.entryCount,
          totalAmount: amount(journal.totalAmount),
        })),
      topTransactions,
    },
    userBehaviorPatterns: {
      auditLogSummary: {
        totalEvents: auditLogs.length,
        reprocessEvents: auditLogs.filter((log) => REPROCESS_ACTIONS.has(log.action))
          .length,
        correctionEvents: auditLogs.filter((log) => log.action === "FIELD_CORRECTED")
          .length,
        bulkReviewEvents: auditLogs.filter(
          (log) => log.action === "SUGGESTION_BULK_REVIEW"
        ).length,
      },
      activeUsers,
    },
    workflowSignals: {
      pendingSuggestions: suggestionStatusCount("PENDING"),
      correctedSuggestions: suggestionStatusCount("CORRECTED"),
      reviewRequiredDocuments: documentStatusCount("REVIEW_REQUIRED"),
      rejectedDocuments: documentStatusCount("REJECTED"),
      approvedDocuments: documentStatusCount("APPROVED"),
      failedDocuments: documentStatusCount("FAILED"),
    },
  };
}

export interface RunAuditComplianceInput {
  companyId: string;
  userId: string;
  fiscalYearId?: string;
  userPrompt?: string;
}

type AuditSnapshot = Awaited<ReturnType<typeof buildAuditSnapshot>>;

export interface AuditComplianceResponse {
  runId: string;
  modelVersion: string;
  durationMs: number;
  summary: string;
  suggestions: AuditComplianceOutput["suggestions"];
  governance: AuditComplianceOutput["governance"];
  snapshot: {
    fiscalYear: {
      id: string;
      label: string;
      startDate: string;
      endDate: string;
      status: string;
    };
    transactionHistory: AuditSnapshot["transactionHistory"];
    userBehaviorPatterns: AuditSnapshot["userBehaviorPatterns"];
    workflowSignals: AuditSnapshot["workflowSignals"];
    priorPeriod: {
      label: string;
      reversalCount: number;
      duplicateReferenceCount: number;
      weekendEntryCount: number;
      pendingSuggestions: number;
    } | null;
    auditRules: string[];
    governanceConstraint: string;
  };
}

export async function runAuditCompliance({
  companyId,
  userId,
  fiscalYearId,
  userPrompt,
}: RunAuditComplianceInput): Promise<AuditComplianceResponse> {
  const currentFiscalYear = await resolveFiscalYear(companyId, fiscalYearId);
  if (!currentFiscalYear) {
    throw new Error("Fiscal year not found for this company.");
  }

  const previousFiscalYear = await prisma.fiscalYear.findFirst({
    where: {
      companyId,
      endDate: {
        lt: currentFiscalYear.startDate,
      },
    },
    orderBy: {
      endDate: "desc",
    },
    select: {
      id: true,
      label: true,
      startDate: true,
      endDate: true,
      status: true,
    },
  });

  const [currentSnapshot, previousSnapshot] = await Promise.all([
    buildAuditSnapshot(companyId, currentFiscalYear),
    previousFiscalYear
      ? buildAuditSnapshot(companyId, previousFiscalYear)
      : Promise.resolve(null),
  ]);

  const priorPeriod = previousSnapshot
    ? {
        label: previousSnapshot.fiscalYear.label,
        reversalCount: previousSnapshot.transactionHistory.anomalySignals.reversalCount,
        duplicateReferenceCount:
          previousSnapshot.transactionHistory.anomalySignals.duplicateReferenceCount,
        weekendEntryCount:
          previousSnapshot.transactionHistory.anomalySignals.weekendEntryCount,
        pendingSuggestions: previousSnapshot.workflowSignals.pendingSuggestions,
      }
    : null;

  const auditRules = [...DEFAULT_AUDIT_RULES];
  const inputData = {
    fiscalYearId: currentSnapshot.fiscalYear.id,
    fiscalYear: currentSnapshot.fiscalYear,
    transactionHistory: currentSnapshot.transactionHistory,
    auditRules,
    userBehaviorPatterns: currentSnapshot.userBehaviorPatterns,
    workflowSignals: currentSnapshot.workflowSignals,
    priorPeriod,
    governanceConstraint: GOVERNANCE_CONSTRAINT,
  };

  const result = await agentRunner.run(companyId, userId, {
    agentType: AgentType.AUDIT_COMPLIANCE,
    userPrompt: userPrompt?.trim() || DEFAULT_AUDIT_PROMPT,
    inputData,
  });

  if (!result.success || !result.output) {
    throw new Error(result.error || "Audit & compliance analysis failed.");
  }

  const output = auditComplianceOutputSchema.parse(result.output);

  return {
    runId: result.runId,
    modelVersion: result.modelVersion,
    durationMs: result.durationMs,
    summary: output.summary,
    suggestions: output.suggestions,
    governance: output.governance,
    snapshot: {
      fiscalYear: currentSnapshot.fiscalYear,
      transactionHistory: currentSnapshot.transactionHistory,
      userBehaviorPatterns: currentSnapshot.userBehaviorPatterns,
      workflowSignals: currentSnapshot.workflowSignals,
      priorPeriod,
      auditRules,
      governanceConstraint: GOVERNANCE_CONSTRAINT,
    },
  };
}
