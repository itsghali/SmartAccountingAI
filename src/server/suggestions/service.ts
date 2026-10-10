import {
  AgentType,
  FieldReviewStatus,
  Prisma,
  Suggestion,
  SuggestionSourceType,
  SuggestionStatus,
} from "@prisma/client";
import { randomUUID } from "node:crypto";
import { prisma } from "@/server/prisma";

type TxClient = Prisma.TransactionClient;
const DOCUMENT_SUGGESTION_BATCH_SIZE = 200;
const REVIEW_TRANSACTION_MAX_WAIT_MS = 10_000;
const REVIEW_TRANSACTION_TIMEOUT_MS = 30_000;

export function isSuggestionStorageUnavailableError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2021" || error.code === "P2022")
  );
}

interface PersistAgentSuggestionsInput {
  companyId: string;
  agentRunId: string;
  agentType: AgentType;
  output: Record<string, unknown>;
  documentId?: string;
}

interface PersistDocumentSuggestionsInput {
  companyId: string;
  documentId: string;
  extractionRunId: string;
  agentRunId: string;
  output: Record<string, unknown>;
}

interface ReviewSuggestionInput {
  suggestionId: string;
  reviewedById: string;
  status: SuggestionStatus;
  correctedValue?: unknown;
  notes?: string;
}

interface BulkReviewSuggestionsInput {
  companyId: string;
  suggestionIds: string[];
  reviewedById: string;
  status: Exclude<SuggestionStatus, "CORRECTED">;
  notes?: string;
}

type ReviewableSuggestion = Pick<
  Suggestion,
  | "id"
  | "status"
  | "value"
  | "extractedFieldId"
  | "companyId"
  | "documentId"
  | "isCurrent"
>;

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  if (value === null || value === undefined) {
    return Prisma.JsonNull as unknown as Prisma.InputJsonValue;
  }

  return value as Prisma.InputJsonValue;
}

function toOptionalText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function extractConfidence(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function chunkArray<T>(items: T[], chunkSize: number) {
  if (items.length === 0) {
    return [];
  }

  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }

  return chunks;
}

const REVIEW_TRANSACTION_OPTIONS = {
  maxWait: REVIEW_TRANSACTION_MAX_WAIT_MS,
  timeout: REVIEW_TRANSACTION_TIMEOUT_MS,
} as const;

function normalizeExtractedValue(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const candidate = value as { value?: unknown; confidence?: unknown };
    if ("value" in candidate || "confidence" in candidate) {
      return {
        value: candidate.value ?? null,
        confidence: extractConfidence(candidate.confidence),
      };
    }
  }

  return {
    value: value ?? null,
    confidence: null,
  };
}

function humanizeKey(value: string) {
  return value
    .replace(/^fields\./, "")
    .replace(/^suggestions\[\d+\]\.?/, "")
    .replace(/^anomalies\[\d+\]\.?/, "")
    .replace(/\./g, " / ")
    .replace(/\[(\d+)\]/g, " #$1")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (char) => char.toUpperCase());
}

function buildAgentSuggestionRecords(
  agentType: AgentType,
  output: Record<string, unknown>
) {
  const records: Array<{
    sourceKey: string;
    label: string | null;
    value: unknown;
    confidence: number | null;
  }> = [];

  if (Array.isArray(output.suggestions)) {
    output.suggestions.forEach((item, index) => {
      const suggestion = item as Record<string, unknown>;
      records.push({
        sourceKey: `suggestions[${index}]`,
        label:
          toOptionalText(suggestion.description) ??
          toOptionalText(suggestion.type) ??
          `${humanizeKey(agentType)} suggestion ${index + 1}`,
        value: suggestion,
        confidence: extractConfidence(suggestion.confidence),
      });
    });
  }

  if (Array.isArray(output.anomalies)) {
    output.anomalies.forEach((item, index) => {
      const anomaly = item as Record<string, unknown>;
      records.push({
        sourceKey: `anomalies[${index}]`,
        label:
          toOptionalText(anomaly.description) ??
          toOptionalText(anomaly.type) ??
          `Anomaly ${index + 1}`,
        value: anomaly,
        confidence: extractConfidence(anomaly.confidence),
      });
    });
  }

  return records;
}

async function applySuggestionReviewTx(
  tx: TxClient,
  suggestion: ReviewableSuggestion,
  reviewedById: string,
  status: SuggestionStatus,
  correctedValue?: unknown,
  notes?: string
) {
  if (status === SuggestionStatus.CORRECTED && correctedValue === undefined) {
    throw new Error("A corrected value is required when marking a suggestion as corrected.");
  }

  const finalValue =
    status === SuggestionStatus.CORRECTED
      ? correctedValue
      : status === SuggestionStatus.APPROVED
      ? suggestion.value
      : null;

  const updatedSuggestion = await tx.suggestion.update({
    where: { id: suggestion.id },
    data: {
      status,
      finalValue: toJsonValue(finalValue),
      reviewNotes: toOptionalText(notes),
      reviewedById,
      reviewedAt: new Date(),
    },
  });

  await tx.suggestionReviewEvent.create({
    data: {
      suggestionId: suggestion.id,
      previousStatus: suggestion.status,
      nextStatus: status,
      finalValue: toJsonValue(finalValue),
      notes: toOptionalText(notes),
      reviewedById,
    },
  });

  if (suggestion.extractedFieldId) {
    await tx.extractedField.update({
      where: { id: suggestion.extractedFieldId },
      data: {
        reviewStatus: status as unknown as FieldReviewStatus,
        correctedValue:
          status === SuggestionStatus.CORRECTED
            ? toJsonValue(correctedValue)
            : Prisma.JsonNull,
        correctedById:
          status === SuggestionStatus.CORRECTED ? reviewedById : null,
        correctedAt:
          status === SuggestionStatus.CORRECTED ? new Date() : null,
      },
    });
  }

  return updatedSuggestion;
}

export async function persistAgentSuggestions({
  companyId,
  agentRunId,
  agentType,
  output,
  documentId,
}: PersistAgentSuggestionsInput) {
  if (agentType === AgentType.DOCUMENT_PROCESSOR) {
    return 0;
  }

  const records = buildAgentSuggestionRecords(agentType, output);
  if (records.length === 0) {
    return 0;
  }

  await prisma.suggestion.createMany({
    data: records.map((record) => ({
      companyId,
      agentRunId,
      documentId,
      sourceType: SuggestionSourceType.AGENT_SUGGESTION,
      agentType,
      sourceKey: record.sourceKey,
      label: record.label,
      value: toJsonValue(record.value),
      confidence: record.confidence,
      status: SuggestionStatus.PENDING,
      finalValue: Prisma.JsonNull,
    })),
  });

  return records.length;
}

export async function persistDocumentSuggestions({
  companyId,
  documentId,
  extractionRunId,
  agentRunId,
  output,
}: PersistDocumentSuggestionsInput) {
  const fields = output.fields as Record<string, unknown> | undefined;
  const lineItems = output.line_items as Array<Record<string, unknown>> | undefined;
  const financialTables = output.financial_tables as Array<Record<string, unknown>> | undefined;
  const warnings = output.warnings as string[] | undefined;
  const extractedFieldRows: Prisma.ExtractedFieldCreateManyInput[] = [];
  const suggestionRows: Prisma.SuggestionCreateManyInput[] = [];

  const addFieldRecord = (
    fieldName: string,
    fieldValue: unknown,
    confidenceScore: number | null,
    reviewStatus: FieldReviewStatus = FieldReviewStatus.PENDING
  ) => {
    const now = new Date();
    const extractedFieldId = randomUUID();

    extractedFieldRows.push({
      id: extractedFieldId,
      documentId,
      extractionRunId,
      fieldName,
      fieldValue: toJsonValue(fieldValue),
      confidenceScore,
      reviewStatus,
      isCurrent: true,
      createdAt: now,
      updatedAt: now,
    });

    if (reviewStatus !== FieldReviewStatus.PENDING) {
      return;
    }

    suggestionRows.push({
      id: randomUUID(),
      companyId,
      agentRunId,
      documentId,
      extractionRunId,
      extractedFieldId,
      sourceType: SuggestionSourceType.DOCUMENT_FIELD,
      agentType: AgentType.DOCUMENT_PROCESSOR,
      sourceKey: fieldName,
      label: humanizeKey(fieldName),
      value: toJsonValue(fieldValue),
      confidence: confidenceScore,
      status: SuggestionStatus.PENDING,
      finalValue: Prisma.JsonNull,
      isCurrent: true,
      createdAt: now,
      updatedAt: now,
    });
  };

  if (fields) {
    for (const [fieldName, fieldData] of Object.entries(fields)) {
      const normalizedField = normalizeExtractedValue(fieldData);
      addFieldRecord(
        `fields.${fieldName}`,
        normalizedField.value,
        normalizedField.confidence
      );
    }
  }

  if (lineItems) {
    for (let index = 0; index < lineItems.length; index += 1) {
      for (const [fieldName, fieldData] of Object.entries(lineItems[index]!)) {
        const normalizedField = normalizeExtractedValue(fieldData);
        addFieldRecord(
          `line_items[${index}].${fieldName}`,
          normalizedField.value,
          normalizedField.confidence
        );
      }
    }
  }

  if (financialTables && Array.isArray(financialTables)) {
    for (const table of financialTables) {
      const tableCode = toOptionalText(table.table_code) ?? "UNKNOWN";
      const tableName = toOptionalText(table.table_name) ?? tableCode;
      const rows = Array.isArray(table.rows)
        ? (table.rows as Array<Record<string, unknown>>)
        : [];

      addFieldRecord(
        `financial_tables.${tableCode}._table_name`,
        tableName,
        null,
        FieldReviewStatus.APPROVED
      );

      for (const row of rows) {
        const rowCode = toOptionalText(row.row_code) ?? "UNKNOWN";
        const rowLabel = toOptionalText(row.label) ?? rowCode;
        const columns =
          row.columns && typeof row.columns === "object" && !Array.isArray(row.columns)
            ? (row.columns as Record<string, unknown>)
            : {};

        addFieldRecord(
          `financial_tables.${tableCode}.${rowCode}._label`,
          rowLabel,
          null,
          FieldReviewStatus.APPROVED
        );

        for (const [colName, colData] of Object.entries(columns)) {
          const normalizedColumn = normalizeExtractedValue(colData);
          addFieldRecord(
            `financial_tables.${tableCode}.${rowCode}.${colName}`,
            normalizedColumn.value,
            normalizedColumn.confidence
          );
        }
      }
    }
  }

  addFieldRecord(
    "document_type",
    output.document_type ?? null,
    extractConfidence(output.document_confidence)
  );

  if (warnings && warnings.length > 0) {
    addFieldRecord(
      "warnings",
      warnings,
      null,
      FieldReviewStatus.APPROVED
    );
  }

  await prisma.$transaction(
    async (tx) => {
      for (const batch of chunkArray(extractedFieldRows, DOCUMENT_SUGGESTION_BATCH_SIZE)) {
        await tx.extractedField.createMany({
          data: batch,
        });
      }

      for (const batch of chunkArray(suggestionRows, DOCUMENT_SUGGESTION_BATCH_SIZE)) {
        await tx.suggestion.createMany({
          data: batch,
        });
      }

      await tx.document.update({
        where: { id: documentId },
        data: {
          documentType: toOptionalText(output.document_type),
        },
      });
    },
    {
      maxWait: 10_000,
      timeout: 30_000,
    }
  );

  return suggestionRows.length;
}

export async function reviewSuggestion({
  suggestionId,
  reviewedById,
  status,
  correctedValue,
  notes,
}: ReviewSuggestionInput) {
  return prisma.$transaction(async (tx) => {
    const suggestion = await tx.suggestion.findUnique({
      where: { id: suggestionId },
      select: {
        id: true,
        status: true,
        value: true,
        extractedFieldId: true,
        companyId: true,
        documentId: true,
        isCurrent: true,
      },
    });

    if (!suggestion) {
      throw new Error("Suggestion not found.");
    }

    return applySuggestionReviewTx(
      tx,
      suggestion,
      reviewedById,
      status,
      correctedValue,
      notes
    );
  }, REVIEW_TRANSACTION_OPTIONS);
}

export async function bulkReviewSuggestions({
  companyId,
  suggestionIds,
  reviewedById,
  status,
  notes,
}: BulkReviewSuggestionsInput) {
  if (suggestionIds.length === 0) {
    return [];
  }

  return prisma.$transaction(async (tx) => {
    const suggestions = await tx.suggestion.findMany({
      where: {
        id: { in: suggestionIds },
        companyId,
      },
      select: {
        id: true,
        status: true,
        value: true,
        extractedFieldId: true,
        companyId: true,
        documentId: true,
        isCurrent: true,
      },
    });

    if (suggestions.length !== suggestionIds.length) {
      throw new Error("Some suggestions could not be found for this company.");
    }

    const updated = [];
    for (const suggestion of suggestions) {
      updated.push(
        await applySuggestionReviewTx(
          tx,
          suggestion,
          reviewedById,
          status,
          undefined,
          notes
        )
      );
    }

    return updated;
  }, REVIEW_TRANSACTION_OPTIONS);
}

export async function supersedeDocumentSuggestions(
  documentId: string,
  reviewedById: string,
  notes: string
) {
  return prisma.$transaction(async (tx) => {
    const suggestions = await tx.suggestion.findMany({
      where: {
        documentId,
        isCurrent: true,
      },
      select: {
        id: true,
        status: true,
        value: true,
        extractedFieldId: true,
        companyId: true,
        documentId: true,
        isCurrent: true,
      },
    });

    const pendingSuggestions = suggestions.filter(
      (suggestion) => suggestion.status === SuggestionStatus.PENDING
    );
    const pendingSuggestionIds = pendingSuggestions.map((suggestion) => suggestion.id);
    const pendingExtractedFieldIds = pendingSuggestions
      .map((suggestion) => suggestion.extractedFieldId)
      .filter((value): value is string => typeof value === "string" && value.length > 0);
    const reviewNotes = toOptionalText(notes);
    const reviewedAt = new Date();

    if (pendingSuggestionIds.length > 0) {
      await tx.suggestion.updateMany({
        where: {
          id: {
            in: pendingSuggestionIds,
          },
        },
        data: {
          status: SuggestionStatus.REJECTED,
          finalValue: Prisma.JsonNull,
          reviewNotes,
          reviewedById,
          reviewedAt,
        },
      });
    }

    for (const batch of chunkArray(pendingSuggestions, DOCUMENT_SUGGESTION_BATCH_SIZE)) {
      if (batch.length === 0) {
        continue;
      }

      await tx.suggestionReviewEvent.createMany({
        data: batch.map((suggestion) => ({
          id: randomUUID(),
          suggestionId: suggestion.id,
          previousStatus: suggestion.status,
          nextStatus: SuggestionStatus.REJECTED,
          finalValue: Prisma.JsonNull,
          notes: reviewNotes,
          reviewedById,
          createdAt: reviewedAt,
        })),
      });
    }

    if (pendingExtractedFieldIds.length > 0) {
      await tx.extractedField.updateMany({
        where: {
          id: {
            in: pendingExtractedFieldIds,
          },
        },
        data: {
          reviewStatus: FieldReviewStatus.REJECTED,
          correctedValue: Prisma.JsonNull,
          correctedById: null,
          correctedAt: null,
        },
      });
    }

    await tx.suggestion.updateMany({
      where: {
        documentId,
        isCurrent: true,
      },
      data: {
        isCurrent: false,
      },
    });

    await tx.extractedField.updateMany({
      where: {
        documentId,
        isCurrent: true,
      },
      data: {
        isCurrent: false,
      },
    });

    return suggestions.length;
  }, REVIEW_TRANSACTION_OPTIONS);
}
