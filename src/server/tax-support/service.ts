import {
  AgentRunStatus,
  AgentType,
  Prisma,
  VATRegime,
  VATperiodType,
} from "@prisma/client";
import { prisma } from "@/server/prisma";
import { agentRunner } from "@/server/agents";
import {
  TaxSupportDetermination,
  TaxSupportOutput,
  TaxSupportSuggestion,
  taxSupportDeterminationSchema,
  taxSupportOutputSchema,
  taxSupportSuggestionSchema,
} from "@/server/agents/schemas";
import { persistAgentSuggestions } from "@/server/suggestions/service";
import { computeDocumentTaxDetermination } from "@/server/tax-engine/document-tax";
import { contextBuilder } from "@/server/agents/core/context-builder";

interface ProposalFieldRecord {
  fieldName: string;
  fieldValue: unknown;
  correctedValue: unknown;
  reviewStatus: string;
}

interface LoadedTaxContext {
  companyId: string;
  companyName: string;
  currency: string;
  chartType: "NORMAL" | "SIMPLIFIED";
  document: {
    id: string;
    originalFilename: string;
    documentType: string | null;
    approvedAt: Date | null;
  };
  reviewedDocument: {
    documentType: string | null;
    fields: Record<string, unknown>;
    lineItems: Array<Record<string, unknown>>;
    warnings: string[];
  };
  jurisdiction: {
    country: "MA";
    regime: VATRegime | null;
    vatPeriodicity: VATperiodType | null;
    chartType: "NORMAL" | "SIMPLIFIED";
  };
  historicalTaxSignals: {
    vatRatesUsed: number[];
    recentDeclarationSummaries: Array<{
      regime: VATRegime;
      periodType: VATperiodType;
      totalOutputVAT: number;
      totalInputVAT: number;
    }>;
  };
}

function normalizeReviewStatus(status: string) {
  if (status === "ACCEPTED") return "APPROVED";
  if (status === "REVIEWED") return "REJECTED";
  return status;
}

function getResolvedFieldValue(field: ProposalFieldRecord) {
  const normalizedStatus = normalizeReviewStatus(field.reviewStatus);
  if (normalizedStatus === "REJECTED") {
    return undefined;
  }

  if (normalizedStatus === "CORRECTED" && field.correctedValue !== null) {
    return field.correctedValue;
  }

  return field.fieldValue;
}

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstString(values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}

function parseNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  let sanitized = trimmed.replace(/[^\d,.\-]/g, "");
  if (!sanitized) {
    return null;
  }

  if (sanitized.includes(",") && sanitized.includes(".")) {
    if (sanitized.lastIndexOf(",") > sanitized.lastIndexOf(".")) {
      sanitized = sanitized.replace(/\./g, "").replace(",", ".");
    } else {
      sanitized = sanitized.replace(/,/g, "");
    }
  } else if (sanitized.includes(",")) {
    sanitized = sanitized.replace(",", ".");
  }

  const numericValue = Number(sanitized);
  return Number.isFinite(numericValue) ? numericValue : null;
}

function firstNumber(values: unknown[]) {
  for (const value of values) {
    const numericValue = parseNumber(value);
    if (numericValue !== null) {
      return numericValue;
    }
  }

  return null;
}

function buildReviewedDocument(fields: ProposalFieldRecord[], documentType: string | null) {
  const reviewedFields: Record<string, unknown> = {};
  const lineItems = new Map<number, Record<string, unknown>>();
  let warnings: string[] = [];

  for (const field of fields) {
    const resolvedValue = getResolvedFieldValue(field);
    if (resolvedValue === undefined) {
      continue;
    }

    if (field.fieldName === "warnings") {
      if (Array.isArray(resolvedValue)) {
        warnings = resolvedValue.filter((value): value is string => typeof value === "string");
      }
      continue;
    }

    if (field.fieldName === "document_type") {
      reviewedFields.document_type = resolvedValue;
      continue;
    }

    const lineItemMatch = /^line_items\[(\d+)\]\.(.+)$/.exec(field.fieldName);
    if (lineItemMatch) {
      const index = Number(lineItemMatch[1]);
      const key = lineItemMatch[2];
      const currentLine = lineItems.get(index) ?? {};
      currentLine[key!] = resolvedValue;
      lineItems.set(index, currentLine);
      continue;
    }

    if (field.fieldName.startsWith("fields.")) {
      reviewedFields[field.fieldName.slice("fields.".length)] = resolvedValue;
      continue;
    }

    reviewedFields[field.fieldName] = resolvedValue;
  }

  return {
    documentType:
      typeof reviewedFields.document_type === "string"
        ? reviewedFields.document_type
        : documentType,
    fields: reviewedFields,
    lineItems: Array.from(lineItems.entries())
      .sort((left, right) => left[0] - right[0])
      .map(([, value]) => value),
    warnings,
  };
}

function looksLikeCompanyName(candidate: string | null | undefined, companyName: string) {
  if (!candidate) {
    return false;
  }

  const normalizedCandidate = normalizeText(candidate);
  const normalizedCompany = normalizeText(companyName);
  return (
    normalizedCandidate.length > 0 &&
    normalizedCompany.length > 0 &&
    (normalizedCandidate.includes(normalizedCompany) ||
      normalizedCompany.includes(normalizedCandidate))
  );
}

function inferDirection(fields: Record<string, unknown>, companyName: string) {
  const supplierName = firstString([
    fields.supplier_name,
    fields.vendor_name,
    fields.merchant_name,
  ]);
  const customerName = firstString([
    fields.customer_name,
    fields.client_name,
    fields.bill_to_name,
  ]);

  if (supplierName && looksLikeCompanyName(supplierName, companyName)) {
    return "SALE";
  }

  if (customerName && looksLikeCompanyName(customerName, companyName)) {
    return "PURCHASE";
  }

  if (supplierName) {
    return "PURCHASE";
  }

  if (customerName) {
    return "SALE";
  }

  return "UNKNOWN";
}

function inferTreatmentFromRate(rate: number | null): TaxSupportSuggestion["vatTreatment"] {
  if (rate === 20) return "STANDARD_20";
  if (rate === 14) return "REDUCED_14";
  if (rate === 10) return "REDUCED_10";
  if (rate === 7) return "REDUCED_7";
  return "UNKNOWN";
}

function buildFallbackSuggestion(context: LoadedTaxContext): TaxSupportOutput {
  const direction = inferDirection(context.reviewedDocument.fields, context.companyName);
  const normalizedDocType = normalizeText(context.reviewedDocument.documentType ?? "");
  const vatAmount = firstNumber([
    context.reviewedDocument.fields.vat_amount,
    context.reviewedDocument.fields.tax_amount,
    context.reviewedDocument.fields.tva_amount,
  ]);
  const vatRate = firstNumber([
    context.reviewedDocument.fields.vat_rate,
    context.reviewedDocument.fields.tax_rate,
    context.reviewedDocument.fields.tva_rate,
  ]);
  const fallbackTreatment = inferTreatmentFromRate(vatRate);

  let category: TaxSupportSuggestion["category"] = "OTHER";
  let vatApplicability: TaxSupportSuggestion["vatApplicability"] = "UNKNOWN";
  let vatTreatment: TaxSupportSuggestion["vatTreatment"] = fallbackTreatment;
  const edgeCases: string[] = [];

  if (normalizedDocType.includes("bank")) {
    category = "BANK_OR_FINANCIAL";
    vatApplicability = "VAT_OUT_OF_SCOPE";
    vatTreatment = "OUT_OF_SCOPE";
  } else if (normalizedDocType.includes("payslip") || normalizedDocType.includes("payroll")) {
    category = "PAYROLL_OR_STAFF";
    vatApplicability = "VAT_OUT_OF_SCOPE";
    vatTreatment = "OUT_OF_SCOPE";
  } else if (normalizedDocType.includes("utility")) {
    category = "UTILITY_EXPENSE";
    vatApplicability =
      vatAmount && vatAmount > 0 ? "INPUT_VAT_RECOVERABLE" : "UNKNOWN";
    vatTreatment = vatTreatment === "UNKNOWN" ? "STANDARD_20" : vatTreatment;
  } else if (direction === "SALE") {
    category = normalizedDocType.includes("service") ? "SALE_SERVICE" : "SALE_GOODS";
    vatApplicability = vatAmount && vatAmount > 0 ? "OUTPUT_VAT_COLLECTED" : "UNKNOWN";
    vatTreatment = vatTreatment === "UNKNOWN" ? "STANDARD_20" : vatTreatment;
  } else if (direction === "PURCHASE") {
    category = normalizedDocType.includes("asset") ? "PURCHASE_ASSET" : "PURCHASE_GOODS";
    vatApplicability = vatAmount && vatAmount > 0 ? "INPUT_VAT_RECOVERABLE" : "UNKNOWN";
    vatTreatment = vatTreatment === "UNKNOWN" ? "STANDARD_20" : vatTreatment;
  }

  const textualFields = [
    firstString([context.reviewedDocument.fields.tax_note]),
    firstString([context.reviewedDocument.fields.notes]),
    firstString([context.reviewedDocument.fields.description]),
  ]
    .filter(Boolean)
    .join(" ");
  const normalizedTextual = normalizeText(textualFields);
  if (
    normalizedTextual.includes("exempt") ||
    normalizedTextual.includes("exonere") ||
    normalizedTextual.includes("hors champ")
  ) {
    category = normalizedTextual.includes("hors champ")
      ? "OUT_OF_SCOPE_TRANSACTION"
      : "EXEMPT_TRANSACTION";
    vatApplicability =
      category === "OUT_OF_SCOPE_TRANSACTION" ? "VAT_OUT_OF_SCOPE" : "VAT_EXEMPT";
    vatTreatment =
      category === "OUT_OF_SCOPE_TRANSACTION" ? "OUT_OF_SCOPE" : "EXEMPT";
  }

  if (vatTreatment === "UNKNOWN") {
    edgeCases.push("The document does not show a clear VAT rate, so treatment classification remains uncertain.");
  }

  const suggestion = taxSupportSuggestionSchema.parse({
    type: "DOCUMENT_TAX_CLASSIFICATION",
    confidence: vatTreatment === "UNKNOWN" ? 0.48 : 0.74,
    description: `Tax classification suggestion for ${context.document.originalFilename}`,
    reason:
      "Built from reviewed document values, inferred transaction direction, and explicit VAT markers when present.",
    category,
    vatApplicability,
    vatTreatment,
    supportingFields: ["document_type", "vat_amount", "vat_rate"],
    edgeCases,
    warnings: context.reviewedDocument.warnings,
  });

  return {
    suggestions: [suggestion],
    summary:
      "Fallback tax classification generated from deterministic heuristics because model output was unavailable.",
  };
}

function normalizeDetermination(
  suggestion: TaxSupportSuggestion,
  context: LoadedTaxContext
) {
  return taxSupportDeterminationSchema.parse({
    ...suggestion,
    engineResult: computeDocumentTaxDetermination(
      context.reviewedDocument,
      suggestion,
      {
        currency: context.currency,
        regime: context.jurisdiction.regime,
      }
    ),
  });
}

async function loadTaxContext(
  documentId: string,
  organizationId: string
): Promise<LoadedTaxContext> {
  const document = await prisma.document.findUnique({
    where: { id: documentId },
    select: {
      id: true,
      tenantId: true,
      status: true,
      originalFilename: true,
      documentType: true,
      approvedAt: true,
      extractedFields: {
        where: { isCurrent: true },
        orderBy: { fieldName: "asc" },
        select: {
          fieldName: true,
          fieldValue: true,
          correctedValue: true,
          reviewStatus: true,
        },
      },
    },
  });

  if (!document) {
    throw new Error("Document not found.");
  }

  if (document.status !== "APPROVED") {
    throw new Error("Only approved documents can be used for tax determination.");
  }

  const company = await prisma.company.findFirst({
    where: {
      id: document.tenantId,
      organizationId,
    },
    select: {
      id: true,
      name: true,
      currency: true,
      chartType: true,
      vatDeclarations: {
        orderBy: { createdAt: "desc" },
        take: 6,
        select: {
          regime: true,
          periodType: true,
          totalOutputVAT: true,
          totalInputVAT: true,
          taxableRevenue20: true,
          taxableRevenue14: true,
          taxableRevenue10: true,
          taxableRevenue7: true,
        },
      },
    },
  });

  if (!company) {
    throw new Error("Access denied.");
  }

  const latestDeclaration = company.vatDeclarations[0];
  const vatRatesUsed = [7, 10, 14, 20].filter((rate) =>
    company.vatDeclarations.some(
      (declaration) =>
        (rate === 20 && declaration.taxableRevenue20.gt(0)) ||
        (rate === 14 && declaration.taxableRevenue14.gt(0)) ||
        (rate === 10 && declaration.taxableRevenue10.gt(0)) ||
        (rate === 7 && declaration.taxableRevenue7.gt(0))
    )
  );

  return {
    companyId: company.id,
    companyName: company.name,
    currency: company.currency,
    chartType: company.chartType,
    document: {
      id: document.id,
      originalFilename: document.originalFilename,
      documentType: document.documentType,
      approvedAt: document.approvedAt,
    },
    reviewedDocument: buildReviewedDocument(
      document.extractedFields as ProposalFieldRecord[],
      document.documentType
    ),
    jurisdiction: {
      country: "MA",
      regime: latestDeclaration?.regime ?? null,
      vatPeriodicity: latestDeclaration?.periodType ?? null,
      chartType: company.chartType,
    },
    historicalTaxSignals: {
      vatRatesUsed,
      recentDeclarationSummaries: company.vatDeclarations.map((declaration) => ({
        regime: declaration.regime,
        periodType: declaration.periodType,
        totalOutputVAT: Number(declaration.totalOutputVAT.toFixed(2)),
        totalInputVAT: Number(declaration.totalInputVAT.toFixed(2)),
      })),
    },
  };
}

async function upsertNormalizedTaxSuggestions(
  agentRunId: string,
  documentId: string,
  determinations: TaxSupportDetermination[]
) {
  for (let index = 0; index < determinations.length; index += 1) {
    const determination = determinations[index]!;
    await prisma.suggestion.updateMany({
      where: {
        agentRunId,
        documentId,
        sourceKey: `suggestions[${index}]`,
      },
      data: {
        label: determination.description,
        value: determination as Prisma.InputJsonValue,
      },
    });
  }
}

async function createFallbackAgentRun(
  context: LoadedTaxContext,
  userId: string,
  userPrompt: string,
  inputData: Record<string, unknown>,
  output: TaxSupportOutput
) {
  const startTime = Date.now();
  const agentContext = await contextBuilder.buildContext(
    context.companyId,
    userId,
    userPrompt,
    inputData,
    {
      includeHistoricalPatterns: true,
      patternLimit: 10,
    }
  );

  const agentRun = await prisma.agentRun.create({
    data: {
      companyId: context.companyId,
      userId,
      agentType: AgentType.TAX_SUPPORT,
      status: AgentRunStatus.COMPLETED,
      inputSnapshot: {
        userPrompt,
        inputData,
      } as Prisma.InputJsonValue,
      contextSnapshot: contextBuilder.sanitizeForAgent(agentContext) as Prisma.InputJsonValue,
      modelProvider: "internal",
      modelVersion: "heuristic-tax-v1",
      structuredOutput: output as Prisma.InputJsonValue,
      rawOutput: JSON.stringify(output),
      confidence: new Prisma.Decimal(output.suggestions[0]?.confidence ?? 0.5),
      durationMs: Date.now() - startTime,
      completedAt: new Date(),
    },
  });

  await persistAgentSuggestions({
    companyId: context.companyId,
    agentRunId: agentRun.id,
    agentType: AgentType.TAX_SUPPORT,
    output: output as Record<string, unknown>,
    documentId: context.document.id,
  });

  return agentRun.id;
}

async function supersedeOlderCurrentDeterminations(documentId: string, currentAgentRunId: string) {
  await prisma.suggestion.updateMany({
    where: {
      documentId,
      agentType: AgentType.TAX_SUPPORT,
      isCurrent: true,
      agentRunId: {
        not: currentAgentRunId,
      },
    },
    data: {
      isCurrent: false,
    },
  });
}

export async function getCurrentDocumentTaxDetermination(
  documentId: string,
  organizationId: string
) {
  const document = await prisma.document.findUnique({
    where: { id: documentId },
    select: {
      id: true,
      tenantId: true,
    },
  });

  if (!document) {
    throw new Error("Document not found.");
  }

  const company = await prisma.company.findFirst({
    where: {
      id: document.tenantId,
      organizationId,
    },
    select: { id: true },
  });

  if (!company) {
    throw new Error("Access denied.");
  }

  const suggestion = await prisma.suggestion.findFirst({
    where: {
      documentId,
      agentType: AgentType.TAX_SUPPORT,
      isCurrent: true,
    },
    orderBy: { createdAt: "desc" },
    include: {
      agentRun: {
        select: {
          id: true,
          modelVersion: true,
          createdAt: true,
          structuredOutput: true,
        },
      },
      reviewedBy: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
        },
      },
      reviewEvents: {
        orderBy: { createdAt: "desc" },
        include: {
          reviewedBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      },
    },
  });

  if (!suggestion) {
    return null;
  }

  const parsedValue = taxSupportDeterminationSchema.parse(
    (suggestion.finalValue ?? suggestion.value) as Prisma.JsonValue | null
  );

  return {
    id: suggestion.id,
    status: suggestion.status,
    reviewNotes: suggestion.reviewNotes,
    reviewedAt: suggestion.reviewedAt,
    reviewedBy: suggestion.reviewedBy,
    createdAt: suggestion.createdAt,
    agentRun: suggestion.agentRun,
    summary:
      suggestion.agentRun &&
      typeof suggestion.agentRun.structuredOutput === "object" &&
      suggestion.agentRun.structuredOutput !== null &&
      "summary" in suggestion.agentRun.structuredOutput
        ? (suggestion.agentRun.structuredOutput as Record<string, unknown>).summary
        : null,
    determination: parsedValue,
    reviewEvents: suggestion.reviewEvents,
  };
}

export async function generateDocumentTaxDetermination(input: {
  documentId: string;
  organizationId: string;
  userId: string;
}) {
  const context = await loadTaxContext(input.documentId, input.organizationId);
  const userPrompt = `Classify the tax treatment for approved document ${context.document.originalFilename}.`;
  const agentInput = {
    documentId: context.document.id,
    validatedDocument: {
      originalFilename: context.document.originalFilename,
      documentType: context.reviewedDocument.documentType ?? undefined,
      approvedAt: context.document.approvedAt?.toISOString(),
      fields: context.reviewedDocument.fields,
      lineItems: context.reviewedDocument.lineItems,
      warnings: context.reviewedDocument.warnings,
    },
    jurisdiction: context.jurisdiction,
    historicalTaxSignals: context.historicalTaxSignals,
  };

  let agentRunId: string;
  let determinations: TaxSupportDetermination[];

  try {
    const result = await agentRunner.run<TaxSupportOutput>(
      context.companyId,
      input.userId,
      {
        agentType: AgentType.TAX_SUPPORT,
        userPrompt,
        inputData: agentInput,
      }
    );

    if (!result.success || !result.output) {
      throw new Error(result.error || "Tax support generation failed.");
    }

    const output = taxSupportOutputSchema.parse(result.output);
    determinations = output.suggestions.map((suggestion) =>
      normalizeDetermination(suggestion, context)
    );
    agentRunId = result.runId;
    await upsertNormalizedTaxSuggestions(result.runId, context.document.id, determinations);
  } catch (error) {
    console.warn("[TaxSupport] Falling back to heuristic classification.", error);

    const fallbackOutput = buildFallbackSuggestion(context);
    determinations = fallbackOutput.suggestions.map((suggestion) =>
      normalizeDetermination(suggestion, context)
    );
    agentRunId = await createFallbackAgentRun(
      context,
      input.userId,
      userPrompt,
      agentInput,
      fallbackOutput
    );
    await upsertNormalizedTaxSuggestions(agentRunId, context.document.id, determinations);
  }

  await supersedeOlderCurrentDeterminations(context.document.id, agentRunId);
  return getCurrentDocumentTaxDetermination(context.document.id, input.organizationId);
}
