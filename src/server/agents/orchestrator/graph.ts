import { BaseMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { RunnableConfig } from "@langchain/core/runnables";
import { z } from "zod";
import Decimal from "decimal.js";
import { AgentType, AgentContext, ModelConfig } from "../types";
import { modelGateway } from "../core/model-gateway";
import { formatPrompt } from "../prompts/base";
import {
  vatSuggestionOutputSchema,
  entrySuggestionOutputSchema,
  amortizationSuggestionOutputSchema,
  documentExtractionOutputSchema,
  documentExtractionOutputPromptSchema,
  accountingEntryPreparerOutputSchema,
  taxSupportOutputSchema,
  closingReportingOutputSchema,
  auditComplianceOutputSchema,
  type DocumentExtractionOutput,
} from "../schemas";

interface AgentState {
  messages: BaseMessage[];
  context: AgentContext;
  agentType: AgentType;
  modelConfig?: Partial<ModelConfig>;
  output?: Record<string, unknown>;
  error?: string;
  confidence?: Decimal;
  iteration: number;
  maxIterations: number;
}

const AGENT_OUTPUT_SCHEMAS: Record<AgentType, z.ZodTypeAny> = {
  VAT_ADVISOR: vatSuggestionOutputSchema,
  ENTRY_SUGGESTION: entrySuggestionOutputSchema,
  AMORTIZATION_ADVISOR: amortizationSuggestionOutputSchema,
  ANOMALY_DETECTOR: z.object({
    anomalies: z.array(
      z.object({
        type: z.string(),
        severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
        description: z.string(),
        affectedAccounts: z.array(z.string()).optional(),
        suggestedAction: z.string(),
        confidence: z.number().min(0).max(1),
      })
    ),
    summary: z.string(),
  }),
  DOCUMENT_PROCESSOR: documentExtractionOutputSchema,
  ACCOUNTING_ENTRY_PREPARER: accountingEntryPreparerOutputSchema,
  TAX_SUPPORT: taxSupportOutputSchema,
  PAYROLL_SUPPORT: z.object({ suggestions: z.array(z.record(z.string(), z.unknown())), summary: z.string() }),
  CLOSING_REPORTING: closingReportingOutputSchema,
  AUDIT_COMPLIANCE: auditComplianceOutputSchema,
};

type DocumentExtractionField = DocumentExtractionOutput["fields"][string];
type DocumentLineItem = DocumentExtractionOutput["line_items"][number];
type DocumentFinancialTable = DocumentExtractionOutput["financial_tables"][number];
type DocumentFinancialTableRow = DocumentFinancialTable["rows"][number];

interface MergedRow {
  row_code: string;
  label: string;
  columns: Map<string, DocumentExtractionField>;
}

interface MergedTable {
  table_code: string;
  table_name: string;
  rows: Map<string, MergedRow>;
  tableKeysByCode: Map<string, string>;
  tableKeysByName: Map<string, string>;
  rowKeysByCode: Map<string, string>;
  rowKeysByLabel: Map<string, string>;
}

interface DocumentProcessorPassOptions {
  strictFinancialTableRetry?: boolean;
}

export interface DocumentProcessorAttemptResult {
  output?: DocumentExtractionOutput;
  error?: string;
  iterations: number;
  rawOutput?: string;
}

const PAGE_SCOPED_FIELD_NAMES = new Set([
  "page_number",
  "page_title",
  "table_name",
  "table_number",
  "table_title",
  "title",
]);

const FINANCIAL_STATEMENT_CUES = [
  "liasse",
  "etat de synthese",
  "bilan",
  "bilan actif",
  "bilan passif",
  "compte de produits et charges",
  "cpc",
  "esg",
  "tresorerie",
] as const;

function clampConfidence(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }

  return Math.min(1, Math.max(0, value));
}

function normalizeFieldWithConfidence(value: unknown): DocumentExtractionField {
  if (value && typeof value === "object" && "confidence" in value) {
    const candidate = value as { value?: unknown; confidence?: unknown };
    return {
      value: candidate.value ?? null,
      confidence: clampConfidence(candidate.confidence),
    };
  }

  return {
    value: value ?? null,
    confidence: 0,
  };
}

function serializeComparableValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function normalizeFieldName(fieldName: string): string {
  return fieldName.trim().toLowerCase();
}

function isPageScopedFieldName(fieldName: string): boolean {
  return PAGE_SCOPED_FIELD_NAMES.has(normalizeFieldName(fieldName));
}

function hasMeaningfulValue(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }

  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return true;
  }

  if (Array.isArray(value)) {
    return value.some((item) => hasMeaningfulValue(item));
  }

  if (typeof value === "object") {
    return Object.values(value).some((item) => hasMeaningfulValue(item));
  }

  return false;
}

function hasConflictingNonNullFieldValues(
  candidates: DocumentExtractionField[]
): boolean {
  const distinctValues = new Set<string>();

  for (const candidate of candidates) {
    if (!hasMeaningfulValue(candidate.value)) {
      continue;
    }

    distinctValues.add(serializeComparableValue(candidate.value));
    if (distinctValues.size > 1) {
      return true;
    }
  }

  return false;
}

function shouldSuppressPageScopedField(
  fieldName: string,
  candidates: DocumentExtractionField[]
): boolean {
  return isPageScopedFieldName(fieldName) && hasConflictingNonNullFieldValues(candidates);
}

function hasMeaningfulLineItemContent(lineItem: DocumentLineItem): boolean {
  return Object.values(lineItem).some((value) =>
    hasMeaningfulValue(normalizeFieldWithConfidence(value).value)
  );
}

function hasMeaningfulFinancialTableContent(table: DocumentFinancialTable): boolean {
  return (table.rows ?? []).some((row) => {
    if (
      typeof row.label === "string" &&
      row.label.trim().length > 0 &&
      row.label.trim() !== row.row_code
    ) {
      return true;
    }

    return Object.values(row.columns ?? {}).some((value) =>
      hasMeaningfulValue(normalizeFieldWithConfidence(value).value)
    );
  });
}

export function hasUsableFinancialTableContent(table: DocumentFinancialTable): boolean {
  return (table.rows ?? []).some((row) =>
    Object.values(row.columns ?? {}).some((value) =>
      hasMeaningfulValue(normalizeFieldWithConfidence(value).value)
    )
  );
}

export function hasUsableFinancialTables(output: DocumentExtractionOutput): boolean {
  return (output.financial_tables ?? []).some((table) =>
    hasUsableFinancialTableContent(table)
  );
}

function hasMeaningfulDocumentContent(output: DocumentExtractionOutput): boolean {
  for (const [fieldName, fieldValue] of Object.entries(output.fields ?? {})) {
    if (isPageScopedFieldName(fieldName)) {
      continue;
    }

    if (hasMeaningfulValue(normalizeFieldWithConfidence(fieldValue).value)) {
      return true;
    }
  }

  if ((output.line_items ?? []).some((lineItem) => hasMeaningfulLineItemContent(lineItem))) {
    return true;
  }

  if ((output.financial_tables ?? []).some((table) => hasMeaningfulFinancialTableContent(table))) {
    return true;
  }

  return false;
}

function warningIndicatesEmptyPage(warning: string): boolean {
  return (
    /no content found on this page/i.test(warning) ||
    /unable to extract data from empty document/i.test(warning)
  );
}

function warningIndicatesMissingCompanyAndAddress(warning: string): boolean {
  return /missing company name/i.test(warning) && /address/i.test(warning);
}

function outputHasCompanyName(output: DocumentExtractionOutput): boolean {
  return Object.entries(output.fields ?? {}).some(([fieldName, fieldValue]) => {
    const normalizedFieldName = normalizeFieldName(fieldName);
    if (
      !normalizedFieldName.includes("name") ||
      !/(company|customer|client|entity|organization|supplier|vendor)/.test(
        normalizedFieldName
      )
    ) {
      return false;
    }

    return hasMeaningfulValue(normalizeFieldWithConfidence(fieldValue).value);
  });
}

function outputHasAddress(output: DocumentExtractionOutput): boolean {
  return Object.entries(output.fields ?? {}).some(([fieldName, fieldValue]) => {
    if (!normalizeFieldName(fieldName).includes("address")) {
      return false;
    }

    return hasMeaningfulValue(normalizeFieldWithConfidence(fieldValue).value);
  });
}

function normalizeCueText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeIdentifier(value: string): string {
  return normalizeCueText(value).replace(/\s+/g, "_");
}

function normalizeColumnName(value: string): string {
  const normalized = value.trim().replace(/\s+/g, " ").toUpperCase();
  return normalized.length > 0 ? normalized : "UNKNOWN";
}

function isPlaceholderTableCode(code: string): boolean {
  return /^(unknown(_table)?|table(_\d+)?|financial_table(_\d+)?)$/.test(code);
}

function isPlaceholderRowCode(code: string): boolean {
  return /^(unknown(_row)?|row(_\d+)?|line(_\d+)?|ligne(_\d+)?)$/.test(code);
}

function isPlaceholderTableName(name: string): boolean {
  return name.length === 0 || /^unknown(_table)?$/.test(name);
}

function isPlaceholderRowLabel(label: string): boolean {
  return label.length === 0 || /^unknown(_row)?$/.test(label);
}

function hasFinancialStatementCue(value: string): boolean {
  const normalized = normalizeCueText(value);
  if (!normalized) {
    return false;
  }

  return FINANCIAL_STATEMENT_CUES.some((cue) => normalized.includes(cue));
}

export function isFinancialStatementCandidate(output: DocumentExtractionOutput): boolean {
  const normalizedType = normalizeIdentifier(output.document_type ?? "");
  if (normalizedType === "liasse_fiscale" || normalizedType === "etat_de_synthese") {
    return true;
  }

  const candidateStrings: string[] = [];

  for (const [fieldName, fieldValue] of Object.entries(output.fields ?? {})) {
    candidateStrings.push(fieldName);

    const normalizedField = normalizeFieldWithConfidence(fieldValue).value;
    if (typeof normalizedField === "string") {
      candidateStrings.push(normalizedField);
    }
  }

  for (const warning of output.warnings ?? []) {
    if (typeof warning === "string") {
      candidateStrings.push(warning);
    }
  }

  for (const table of output.financial_tables ?? []) {
    if (typeof table.table_code === "string") {
      candidateStrings.push(table.table_code);
    }
    if (typeof table.table_name === "string") {
      candidateStrings.push(table.table_name);
    }

    for (const row of table.rows ?? []) {
      if (typeof row.row_code === "string") {
        candidateStrings.push(row.row_code);
      }
      if (typeof row.label === "string") {
        candidateStrings.push(row.label);
      }
    }
  }

  return candidateStrings.some((value) => hasFinancialStatementCue(value));
}

function filterMergedWarnings(
  warnings: Iterable<string>,
  output: DocumentExtractionOutput
): string[] {
  const filteredWarnings = new Set<string>();
  const hasDocumentContent = hasMeaningfulDocumentContent(output);
  const hasCompanyName = outputHasCompanyName(output);
  const hasAddress = outputHasAddress(output);

  for (const warning of warnings) {
    const trimmedWarning = warning.trim();
    if (!trimmedWarning) {
      continue;
    }

    if (hasDocumentContent && warningIndicatesEmptyPage(trimmedWarning)) {
      continue;
    }

    if (
      hasCompanyName &&
      hasAddress &&
      warningIndicatesMissingCompanyAndAddress(trimmedWarning)
    ) {
      continue;
    }

    filteredWarnings.add(trimmedWarning);
  }

  return [...filteredWarnings];
}

function mergeFieldCandidate(
  currentValue: DocumentExtractionField | undefined,
  incomingValue: DocumentExtractionField,
  warnings: Set<string>,
  label: string
): DocumentExtractionField {
  if (!currentValue) {
    return incomingValue;
  }

  const currentSerialized = serializeComparableValue(currentValue.value);
  const incomingSerialized = serializeComparableValue(incomingValue.value);

  if (currentSerialized === incomingSerialized) {
    return {
      value: currentValue.value,
      confidence: Math.max(currentValue.confidence, incomingValue.confidence),
    };
  }

  if (currentValue.value === null && incomingValue.value !== null) {
    return incomingValue;
  }

  if (incomingValue.value === null) {
    return currentValue;
  }

  if (incomingValue.confidence > currentValue.confidence) {
    warnings.add(`Conflicting extracted values detected for ${label}; kept the higher-confidence value.`);
    return incomingValue;
  }

  warnings.add(`Conflicting extracted values detected for ${label}; review this field carefully.`);
  return currentValue;
}

function getTableMergeKey(table: DocumentFinancialTable, mergedTables: Map<string, MergedTable>): string {
  const normalizedCode = normalizeIdentifier(table.table_code ?? "");
  const normalizedName = normalizeIdentifier(table.table_name ?? "");

  for (const existing of mergedTables.values()) {
    if (normalizedCode && existing.tableKeysByCode.has(normalizedCode)) {
      return existing.tableKeysByCode.get(normalizedCode)!;
    }
  }

  for (const existing of mergedTables.values()) {
    if (normalizedName && existing.tableKeysByName.has(normalizedName)) {
      return existing.tableKeysByName.get(normalizedName)!;
    }
  }

  if (normalizedCode && !isPlaceholderTableCode(normalizedCode)) {
    return `table:${normalizedCode}`;
  }

  if (normalizedName) {
    return `table_name:${normalizedName}`;
  }

  return `table:unknown_${mergedTables.size + 1}`;
}

function getRowMergeKey(row: DocumentFinancialTableRow, table: MergedTable): string {
  const normalizedCode = normalizeIdentifier(row.row_code ?? "");
  const normalizedLabel = normalizeIdentifier(row.label ?? "");

  if (normalizedCode && table.rowKeysByCode.has(normalizedCode)) {
    return table.rowKeysByCode.get(normalizedCode)!;
  }

  if (normalizedLabel && table.rowKeysByLabel.has(normalizedLabel)) {
    return table.rowKeysByLabel.get(normalizedLabel)!;
  }

  if (normalizedCode && !isPlaceholderRowCode(normalizedCode)) {
    return `row:${normalizedCode}`;
  }

  if (normalizedLabel) {
    return `row_label:${normalizedLabel}`;
  }

  return `row:unknown_${table.rows.size + 1}`;
}

function createMergedTable(table: DocumentFinancialTable): MergedTable {
  const tableCode =
    typeof table.table_code === "string" && table.table_code.trim().length > 0
      ? table.table_code.trim()
      : "unknown_table";
  const tableName =
    typeof table.table_name === "string" && table.table_name.trim().length > 0
      ? table.table_name.trim()
      : tableCode;
  const mergedTable: MergedTable = {
    table_code: tableCode,
    table_name: tableName,
    rows: new Map<string, MergedRow>(),
    tableKeysByCode: new Map<string, string>(),
    tableKeysByName: new Map<string, string>(),
    rowKeysByCode: new Map<string, string>(),
    rowKeysByLabel: new Map<string, string>(),
  };
  const normalizedCode = normalizeIdentifier(tableCode);
  const normalizedName = normalizeIdentifier(tableName);
  const mergeKey = getTableMergeKey(table, new Map<string, MergedTable>());

  if (normalizedCode) {
    mergedTable.tableKeysByCode.set(normalizedCode, mergeKey);
  }

  if (normalizedName) {
    mergedTable.tableKeysByName.set(normalizedName, mergeKey);
  }

  return mergedTable;
}

function createMergedRow(row: DocumentFinancialTableRow): MergedRow {
  const rowCode =
    typeof row.row_code === "string" && row.row_code.trim().length > 0
      ? row.row_code.trim()
      : "unknown_row";
  const rowLabel =
    typeof row.label === "string" && row.label.trim().length > 0
      ? row.label.trim()
      : rowCode;
  return {
    row_code: rowCode,
    label: rowLabel,
    columns: new Map<string, DocumentExtractionField>(),
  };
}

function updateMergedTableMetadata(table: MergedTable, incoming: DocumentFinancialTable, mergeKey: string) {
  const normalizedExistingCode = normalizeIdentifier(table.table_code);
  const normalizedIncomingCode = normalizeIdentifier(incoming.table_code ?? "");
  const normalizedExistingName = normalizeIdentifier(table.table_name);
  const normalizedIncomingName = normalizeIdentifier(incoming.table_name ?? "");

  if (
    normalizedIncomingCode &&
    !isPlaceholderTableCode(normalizedIncomingCode) &&
    isPlaceholderTableCode(normalizedExistingCode)
  ) {
    table.table_code = incoming.table_code.trim();
  }

  if (
    normalizedIncomingName &&
    !isPlaceholderTableName(normalizedIncomingName) &&
    isPlaceholderTableName(normalizedExistingName)
  ) {
    table.table_name = incoming.table_name!.trim();
  }

  if (normalizedIncomingCode) {
    table.tableKeysByCode.set(normalizedIncomingCode, mergeKey);
  }

  if (normalizedIncomingName) {
    table.tableKeysByName.set(normalizedIncomingName, mergeKey);
  }
}

function updateMergedRowMetadata(
  table: MergedTable,
  row: MergedRow,
  incoming: DocumentFinancialTableRow,
  mergeKey: string
) {
  const normalizedExistingCode = normalizeIdentifier(row.row_code);
  const normalizedIncomingCode = normalizeIdentifier(incoming.row_code ?? "");
  const normalizedExistingLabel = normalizeIdentifier(row.label);
  const normalizedIncomingLabel = normalizeIdentifier(incoming.label ?? "");

  if (
    normalizedIncomingCode &&
    !isPlaceholderRowCode(normalizedIncomingCode) &&
    isPlaceholderRowCode(normalizedExistingCode)
  ) {
    row.row_code = incoming.row_code.trim();
  }

  if (
    normalizedIncomingLabel &&
    !isPlaceholderRowLabel(normalizedIncomingLabel) &&
    isPlaceholderRowLabel(normalizedExistingLabel)
  ) {
    row.label = incoming.label!.trim();
  }

  if (normalizedIncomingCode) {
    table.rowKeysByCode.set(normalizedIncomingCode, mergeKey);
  }

  if (normalizedIncomingLabel) {
    table.rowKeysByLabel.set(normalizedIncomingLabel, mergeKey);
  }
}

export function mergeDocumentExtractionOutputs(
  outputs: DocumentExtractionOutput[]
): DocumentExtractionOutput {
  const contentfulOutputs = outputs.filter((output) => hasMeaningfulDocumentContent(output));
  const outputsToMerge = contentfulOutputs.length > 0 ? contentfulOutputs : outputs;
  const documentTypeScores = new Map<
    string,
    { totalConfidence: number; maxConfidence: number }
  >();
  const mergedFields = new Map<string, DocumentExtractionField>();
  const fieldCandidates = new Map<string, DocumentExtractionField[]>();
  const mergedLineItems: DocumentLineItem[] = [];
  const mergedLineItemKeys = new Set<string>();
  const mergedWarnings = new Set<string>();
  const mergedTables = new Map<string, MergedTable>();

  for (const output of outputsToMerge) {
    const documentType =
      typeof output.document_type === "string" && output.document_type.trim().length > 0
        ? output.document_type.trim()
        : "other";
    const documentConfidence = clampConfidence(output.document_confidence);
    const currentScore = documentTypeScores.get(documentType) ?? {
      totalConfidence: 0,
      maxConfidence: 0,
    };
    currentScore.totalConfidence += documentConfidence;
    currentScore.maxConfidence = Math.max(currentScore.maxConfidence, documentConfidence);
    documentTypeScores.set(documentType, currentScore);

    for (const [fieldName, fieldValue] of Object.entries(output.fields ?? {})) {
      const normalizedField = normalizeFieldWithConfidence(fieldValue);
      const existingCandidates = fieldCandidates.get(fieldName) ?? [];
      existingCandidates.push(normalizedField);
      fieldCandidates.set(fieldName, existingCandidates);
    }

    for (const lineItem of output.line_items ?? []) {
      const normalizedEntries = Object.entries(lineItem)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => [key, normalizeFieldWithConfidence(value)] as const);
      const lineKey = JSON.stringify(
        normalizedEntries.map(([key, value]) => [key, value.value, value.confidence])
      );

      if (mergedLineItemKeys.has(lineKey)) {
        continue;
      }

      mergedLineItemKeys.add(lineKey);
      mergedLineItems.push(
        Object.fromEntries(normalizedEntries) as DocumentLineItem
      );
    }

    for (const warning of output.warnings ?? []) {
      if (typeof warning === "string" && warning.trim().length > 0) {
        mergedWarnings.add(warning.trim());
      }
    }

    for (const table of output.financial_tables ?? []) {
      const tableMergeKey = getTableMergeKey(table, mergedTables);
      const existingTable = mergedTables.get(tableMergeKey) ?? createMergedTable(table);
      updateMergedTableMetadata(existingTable, table, tableMergeKey);

      for (const row of table.rows ?? []) {
        const rowMergeKey = getRowMergeKey(row, existingTable);
        const existingRow = existingTable.rows.get(rowMergeKey) ?? createMergedRow(row);
        updateMergedRowMetadata(existingTable, existingRow, row, rowMergeKey);

        for (const [columnName, columnValue] of Object.entries(row.columns ?? {})) {
          const mergedColumnName = normalizeColumnName(columnName);
          const normalizedColumn = normalizeFieldWithConfidence(columnValue);
          existingRow.columns.set(
            mergedColumnName,
            mergeFieldCandidate(
              existingRow.columns.get(mergedColumnName),
              normalizedColumn,
              mergedWarnings,
              `financial table "${existingTable.table_code}" row "${existingRow.row_code}" column "${mergedColumnName}"`
            )
          );
        }

        existingTable.rows.set(rowMergeKey, existingRow);
      }

      mergedTables.set(tableMergeKey, existingTable);
    }
  }

  for (const [fieldName, candidates] of fieldCandidates.entries()) {
    // Page headers often vary by chunk and are not safe document-level fields.
    if (shouldSuppressPageScopedField(fieldName, candidates)) {
      continue;
    }

    let mergedField: DocumentExtractionField | undefined;

    for (const candidate of candidates) {
      mergedField = mergeFieldCandidate(
        mergedField,
        candidate,
        mergedWarnings,
        `field "${fieldName}"`
      );
    }

    if (mergedField) {
      mergedFields.set(fieldName, mergedField);
    }
  }

  const [resolvedDocumentType = "other", resolvedTypeScore] =
    [...documentTypeScores.entries()].sort((left, right) => {
      if (right[1].totalConfidence !== left[1].totalConfidence) {
        return right[1].totalConfidence - left[1].totalConfidence;
      }

      return right[1].maxConfidence - left[1].maxConfidence;
    })[0] ?? [];

  const mergedOutput: DocumentExtractionOutput = {
    document_type: resolvedDocumentType,
    document_confidence: resolvedTypeScore?.maxConfidence ?? 0,
    fields: Object.fromEntries(mergedFields.entries()),
    line_items: mergedLineItems,
    financial_tables: [...mergedTables.values()].map((table) => ({
      table_code: table.table_code,
      table_name: table.table_name,
      rows: [...table.rows.values()].map((row) => ({
        row_code: row.row_code,
        label: row.label,
        columns: Object.fromEntries(row.columns.entries()),
      })),
    })),
    warnings: [],
  };

  mergedOutput.warnings = filterMergedWarnings(mergedWarnings, mergedOutput);

  return mergedOutput;
}

function getDocumentProcessorPageChunkSize(): number {
  const rawChunkSize = Number.parseInt(
    process.env.DOCUMENT_PROCESSOR_PAGE_CHUNK_SIZE ?? "1",
    10
  );

  if (!Number.isFinite(rawChunkSize) || rawChunkSize <= 0) {
    return 1;
  }

  return rawChunkSize;
}

function getDocumentProcessorImagePayload(context: AgentContext) {
  const legacyImageBase64 =
    typeof context.inputData?.imageBase64 === "string"
      ? context.inputData.imageBase64
      : undefined;
  const imageBase64Pages = Array.isArray(context.inputData?.imageBase64Pages)
    ? context.inputData.imageBase64Pages.filter(
        (value): value is string => typeof value === "string" && value.length > 0
      )
    : legacyImageBase64
      ? [legacyImageBase64]
      : [];
  const imageMime =
    typeof context.inputData?.imageMimeType === "string"
      ? context.inputData.imageMimeType
      : typeof context.inputData?.mimeType === "string" &&
          context.inputData.mimeType.startsWith("image/")
        ? context.inputData.mimeType
        : undefined;

  return { imageBase64Pages, imageMime };
}

async function runDocumentProcessorChunk(
  context: AgentContext,
  modelConfig: Partial<ModelConfig> | undefined,
  imageBase64Pages: string[],
  imageMime: string,
  pageStart: number,
  pageEnd: number,
  totalPages: number,
  options: DocumentProcessorPassOptions = {}
): Promise<DocumentProcessorAttemptResult> {
  const sanitizedContext = sanitizeContextForPrompt(context);
  const prompt = formatPrompt(
    AgentType.DOCUMENT_PROCESSOR,
    sanitizedContext,
    context.userPrompt,
    context.inputData || {}
  );
  const model = modelGateway.getModel(modelConfig);
  const jsonSchema = z.toJSONSchema(documentExtractionOutputPromptSchema);
  const pageInstruction =
    pageStart === pageEnd
      ? `You are processing page ${pageStart} of ${totalPages} from a single document.`
      : `You are processing pages ${pageStart} to ${pageEnd} of ${totalPages} from a single document.`;

  let lastRawOutput: string | undefined;
  let lastError: string | undefined;

  // STEP 1: Get OCR text — reuse pre-extracted text from document-processor if available
  let ocrText = "";
  const preExtractedOcrText =
    typeof context.inputData?.ocrText === "string" ? context.inputData.ocrText : "";

  if (preExtractedOcrText.trim().length > 0) {
    ocrText = preExtractedOcrText;
  } else {
    // Fallback: call OCR service directly (only if document-processor didn't provide text)
    try {
      const { extractDocumentWithOCR } = await import("@/server/ocr-client");
      for (const base64Page of imageBase64Pages) {
        const pageBuffer = Buffer.from(base64Page, "base64");
        const data = await extractDocumentWithOCR(pageBuffer, "page");
        ocrText += (data.raw_text || "") + "\n\n";
      }
    } catch (error) {
      console.error("[docTR OCR] Failed to extract text:", error);
      return {
        error: `Failed to extract text using OCR service: ${error instanceof Error ? error.message : "Unknown error"}`,
        iterations: 0,
      };
    }
  }

  // STEP 2: Structure the OCR Text via LLM
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const correctiveInstruction = lastError
      ? `Previous attempt issue: ${lastError}. Fix the JSON and schema problems completely.`
      : "";
    const retryInstruction = options.strictFinancialTableRetry
      ? `This is a financial-table recovery pass. Assume the document may be a Moroccan liasse fiscale or état de synthèse even if the first pass was uncertain. Prioritize CPC, bilan, ESG, trésorerie, and similar statement tables over generic metadata. If any financial table is visible, "financial_tables" is required. Keep fields and line_items sparse if needed, but do not omit visible statement tables.`
      : "";
    const systemMessage = new SystemMessage(
      `${prompt}

${pageInstruction}
Extract ONLY the data found in the provided OCR text.
If a financial table continues across multiple pages, reuse consistent table_code, row_code, and column names so results can be merged later.
Do not summarize unseen pages. Do not omit zero-valued rows that are visible on these pages.
For liasse fiscale and état de synthèse pages, focus on reading the numeric table cells exactly as printed. Do not emit a row with every numeric cell null unless the source row itself appears blank.
${retryInstruction}
${correctiveInstruction}

You must respond with a valid JSON object matching this schema: ${JSON.stringify(jsonSchema)}`
    );

    const contentBlocks: Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }> = [
      {
        type: "text",
        text: `${context.userPrompt}

These pages are only one chunk of the document. Return fields, line_items, and financial_tables for what is visible on these pages only.${options.strictFinancialTableRetry ? " This retry is specifically for recovering financial statement tables, so prioritize visible CPC, bilan, ESG, and tresorerie tables." : ""}

--- OCR TEXT EXTRACTED BY DOCTR ---
${ocrText.trim()}
-----------------------------------`
      }
    ];

    // Only append images if the model isn't explicitly a text-only model
    const isTextOnly = modelConfig?.model?.includes("gpt-oss-120b");
    if (!isTextOnly) {
      for (const page of imageBase64Pages) {
        contentBlocks.push({
          type: "image_url",
          image_url: { url: `data:${imageMime};base64,${page}` },
        });
      }
    }

    const userMessage = new HumanMessage({
      content: contentBlocks,
    });

    const response = await model.invoke([systemMessage, userMessage]);
    const content =
      typeof response.content === "string"
        ? response.content
        : JSON.stringify(response.content);
    lastRawOutput = content;

    const parsed = extractJson(content);
    if (!parsed.ok) {
      lastError = `JSON parsing failed: ${parsed.error}`;
      continue;
    }

    const validation = documentExtractionOutputSchema.safeParse(parsed.value);
    if (!validation.success) {
      lastError = `Output validation failed: ${validation.error.message}`;
      continue;
    }

    return {
      output: validation.data,
      iterations: attempt,
      rawOutput: content,
    };
  }

  return {
    error: lastError ?? "Document extraction chunk failed after maximum retries.",
    iterations: 3,
    rawOutput: lastRawOutput,
  };
}

async function runDocumentProcessorPass(
  context: AgentContext,
  modelConfig: Partial<ModelConfig> | undefined,
  imageBase64Pages: string[],
  imageMime: string,
  options: DocumentProcessorPassOptions = {}
): Promise<DocumentProcessorAttemptResult> {
  if (imageBase64Pages.length === 0) {
    return {
      iterations: 0,
      error: "Document processor requires at least one image page.",
    };
  }

  const chunkSize = getDocumentProcessorPageChunkSize();
  const chunkOutputs: DocumentExtractionOutput[] = [];
  const rawOutputs: string[] = [];
  let totalIterations = 0;

  for (let start = 0; start < imageBase64Pages.length; start += chunkSize) {
    const end = Math.min(start + chunkSize, imageBase64Pages.length);
    const chunkResult = await runDocumentProcessorChunk(
      context,
      modelConfig,
      imageBase64Pages.slice(start, end),
      imageMime,
      start + 1,
      end,
      imageBase64Pages.length,
      options
    );

    totalIterations += chunkResult.iterations;
    if (chunkResult.rawOutput) {
      rawOutputs.push(`[pages ${start + 1}-${end}] ${chunkResult.rawOutput}`);
    }

    if (chunkResult.error || !chunkResult.output) {
      return {
        error: chunkResult.error || `Failed to extract pages ${start + 1}-${end}.`,
        iterations: totalIterations,
        rawOutput: rawOutputs.join("\n\n"),
      };
    }

    chunkOutputs.push(chunkResult.output);
  }

  const mergedOutput = mergeDocumentExtractionOutputs(chunkOutputs);

  return {
    output: mergedOutput,
    iterations: totalIterations,
    rawOutput: rawOutputs.join("\n\n"),
  };
}

export async function runDocumentProcessorReliabilityPolicy(
  runPass: (options: DocumentProcessorPassOptions) => Promise<DocumentProcessorAttemptResult>
): Promise<{
  output?: Record<string, unknown>;
  confidence?: Decimal;
  error?: string;
  iterations: number;
  rawOutput?: string;
}> {
  const rawOutputs: string[] = [];
  let totalIterations = 0;

  const initialResult = await runPass({});
  totalIterations += initialResult.iterations;
  if (initialResult.rawOutput) {
    rawOutputs.push(`[initial-pass] ${initialResult.rawOutput}`);
  }

  if (initialResult.error || !initialResult.output) {
    return {
      error: initialResult.error || "Document extraction failed.",
      iterations: totalIterations,
      rawOutput: rawOutputs.join("\n\n"),
    };
  }

  let finalOutput = initialResult.output;

  if (
    isFinancialStatementCandidate(initialResult.output) &&
    !hasUsableFinancialTables(initialResult.output)
  ) {
    const retryResult = await runPass({ strictFinancialTableRetry: true });
    totalIterations += retryResult.iterations;

    if (retryResult.rawOutput) {
      rawOutputs.push(`[financial-table-retry] ${retryResult.rawOutput}`);
    }

    if (retryResult.error || !retryResult.output) {
      return {
        error:
          retryResult.error ||
          "Financial statement detected but retry extraction failed.",
        iterations: totalIterations,
        rawOutput: rawOutputs.join("\n\n"),
      };
    }

    if (!hasUsableFinancialTables(retryResult.output)) {
      return {
        error:
          "Financial statement detected but no usable financial tables were extracted after retry.",
        iterations: totalIterations,
        rawOutput: rawOutputs.join("\n\n"),
      };
    }

    finalOutput = retryResult.output;
  }

  return {
    output: finalOutput as Record<string, unknown>,
    confidence: new Decimal(finalOutput.document_confidence),
    iterations: totalIterations,
    rawOutput: rawOutputs.join("\n\n"),
  };
}

async function runDocumentProcessorImageWorkflow(
  context: AgentContext,
  modelConfig?: Partial<ModelConfig>
): Promise<{
  output?: Record<string, unknown>;
  confidence?: Decimal;
  error?: string;
  iterations: number;
  rawOutput?: string;
}> {
  const { imageBase64Pages, imageMime } = getDocumentProcessorImagePayload(context);

  if (!imageMime || imageBase64Pages.length === 0) {
    return {
      iterations: 0,
      error: "Document processor requires an image payload.",
    };
  }

  return runDocumentProcessorReliabilityPolicy((options) =>
    runDocumentProcessorPass(context, modelConfig, imageBase64Pages, imageMime, options)
  );
}

function createInitialState(
  context: AgentContext,
  agentType: AgentType,
  modelConfig?: Partial<ModelConfig>
): AgentState {
  return {
    messages: [],
    context,
    agentType,
    modelConfig,
    iteration: 0,
    maxIterations: 3,
  };
}

async function generateNode(
  state: AgentState,
  config?: RunnableConfig
): Promise<AgentState> {
  const { context, agentType, iteration, modelConfig } = state;

  const sanitizedContext = sanitizeContextForPrompt(context);
  const prompt = formatPrompt(
    agentType,
    sanitizedContext,
    context.userPrompt,
    context.inputData || {}
  );

  const model = modelGateway.getModel(modelConfig);
  const outputSchema = AGENT_OUTPUT_SCHEMAS[agentType];
  const promptSchema =
    agentType === AgentType.DOCUMENT_PROCESSOR
      ? documentExtractionOutputPromptSchema
      : outputSchema;
  const jsonSchema = z.toJSONSchema(promptSchema);

  const systemMessage = new SystemMessage(
    `${prompt}\n\nYou must respond with a valid JSON object matching this schema: ${JSON.stringify(
      jsonSchema
    )}`
  );

  const legacyImageBase64 =
    typeof context.inputData?.imageBase64 === "string"
      ? context.inputData.imageBase64
      : undefined;
  const imageBase64Pages = Array.isArray(context.inputData?.imageBase64Pages)
    ? context.inputData.imageBase64Pages.filter(
        (value): value is string => typeof value === "string" && value.length > 0
      )
    : legacyImageBase64
      ? [legacyImageBase64]
      : [];
  const imageMime =
    typeof context.inputData?.imageMimeType === "string"
      ? context.inputData.imageMimeType
      : typeof context.inputData?.mimeType === "string" &&
          context.inputData.mimeType.startsWith("image/")
        ? context.inputData.mimeType
        : undefined;
  const hasImages = imageBase64Pages.length > 0 && !!imageMime;

  const userMessage: BaseMessage = hasImages
    ? new HumanMessage({
        content: [
          { type: "text" as const, text: context.userPrompt },
          ...imageBase64Pages.map((page) => ({
            type: "image_url" as const,
            image_url: { url: `data:${imageMime};base64,${page}` },
          })),
        ],
      })
    : new HumanMessage(context.userPrompt);

  const messages = [systemMessage, userMessage, ...state.messages];

  const response = await model.invoke(messages, config);
  const content =
    typeof response.content === "string"
      ? response.content
      : JSON.stringify(response.content);

  return {
    ...state,
    messages: [...state.messages, new HumanMessage(content)],
    iteration: iteration + 1,
  };
}

async function validateNode(
  state: AgentState
): Promise<AgentState> {
  const { messages, agentType } = state;
  const lastMessage = messages[messages.length - 1];

  if (!lastMessage || typeof lastMessage.content !== "string") {
    return { ...state, error: "No message content to validate" };
  }

  const outputSchema = AGENT_OUTPUT_SCHEMAS[agentType];

  const parsed = extractJson(lastMessage.content);
  if (!parsed.ok) {
    return {
      ...state,
      error: `JSON parsing failed: ${parsed.error}`,
      messages: [
        ...messages,
        new SystemMessage(
          "Your previous response was not valid JSON. Return ONLY a single valid JSON object matching the schema. No prose, no markdown, no code fences, no commentary. Double-check that all braces and brackets are balanced."
        ),
      ],
    };
  }

  const validation = outputSchema.safeParse(parsed.value);
  if (!validation.success) {
    return {
      ...state,
      error: `Output validation failed: ${validation.error.message}`,
      messages: [
        ...messages,
        new SystemMessage(
          `Your previous JSON did not match the required schema. Errors: ${validation.error.message}. Every field in "fields" and every entry in "line_items" must be an object shaped exactly { "value": <any|null>, "confidence": <number 0..1> }. Return the corrected JSON only.`
        ),
      ],
    };
  }

  const confidence = extractConfidence(validation.data);

  return {
    ...state,
    output: validation.data as Record<string, unknown>,
    confidence,
    error: undefined,
  };
}

function extractJson(raw: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const stripped = raw
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();

  const candidates: string[] = [stripped];
  const first = stripped.indexOf("{");
  const last = stripped.lastIndexOf("}");
  if (first !== -1 && last > first) {
    candidates.push(stripped.slice(first, last + 1));
  }

  let lastError = "no JSON candidate found";
  for (const c of candidates) {
    try {
      return { ok: true, value: JSON.parse(c) };
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }
  return { ok: false, error: lastError };
}

function shouldRetry(state: AgentState): boolean {
  return Boolean(state.error) && !state.output && state.iteration < state.maxIterations;
}

export async function runAgentGraph(
  context: AgentContext,
  agentType: AgentType,
  modelConfig?: Partial<ModelConfig>
): Promise<{
  output?: Record<string, unknown>;
  confidence?: Decimal;
  error?: string;
  iterations: number;
  rawOutput?: string;
}> {
  const legacyImageBase64 =
    typeof context.inputData?.imageBase64 === "string"
      ? context.inputData.imageBase64
      : undefined;
  const imageBase64Pages = Array.isArray(context.inputData?.imageBase64Pages)
    ? context.inputData.imageBase64Pages.filter(
        (value): value is string => typeof value === "string" && value.length > 0
      )
    : legacyImageBase64
      ? [legacyImageBase64]
      : [];

  if (agentType === AgentType.DOCUMENT_PROCESSOR && imageBase64Pages.length > 0) {
    return runDocumentProcessorImageWorkflow(context, modelConfig);
  }

  let state = createInitialState(context, agentType, modelConfig);

  try {
    do {
      state = await generateNode(state);
      state = await validateNode(state);
    } while (shouldRetry(state));

    let rawOutput: string | undefined;
    if (state.messages.length > 0) {
      const lastMsg = state.messages[state.messages.length - 1]!;
      if (lastMsg.content) {
        rawOutput =
          typeof lastMsg.content === "string"
            ? lastMsg.content
            : JSON.stringify(lastMsg.content);
      }
    }

    return {
      output: state.output,
      confidence: state.confidence,
      error:
        state.output || !state.error
          ? undefined
          : state.error,
      iterations: state.iteration,
      rawOutput,
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Workflow failed",
      iterations: 0,
    };
  }
}

function sanitizeContextForPrompt(
  context: AgentContext
): Record<string, unknown> {
  return {
    tenant: {
      company: {
        name: context.tenant.company.name,
        legalForm: context.tenant.company.legalForm,
        chartType: context.tenant.company.chartType,
        currency: context.tenant.company.currency,
      },
      fiscalYear: context.tenant.fiscalYear
        ? {
            label: context.tenant.fiscalYear.label,
            startDate: context.tenant.fiscalYear.startDate.toISOString(),
            endDate: context.tenant.fiscalYear.endDate.toISOString(),
            status: context.tenant.fiscalYear.status,
          }
        : null,
    },
    jurisdiction: context.jurisdiction,
    patterns: context.patterns
      ? {
          commonAccounts: context.patterns.commonAccounts,
          vatRatesUsed: context.patterns.vatRatesUsed,
          averageMonthlyRevenue: context.patterns.averageMonthlyRevenue?.toNumber(),
          recentEntryDescriptions: context.patterns.recentEntries.map(
            (e) => e.description
          ),
        }
      : undefined,
  };
}

function extractConfidence(output: unknown): Decimal | undefined {
  if (typeof output !== "object" || output === null) return undefined;

  const obj = output as Record<string, unknown>;

  if (Array.isArray(obj.suggestions) && obj.suggestions.length > 0) {
    const confidences = obj.suggestions
      .map((s: unknown) =>
        typeof s === "object" && s !== null
          ? (s as Record<string, unknown>).confidence
          : undefined
      )
      .filter((c): c is number => typeof c === "number");

    if (confidences.length > 0) {
      const avg =
        confidences.reduce((sum, c) => sum + c, 0) / confidences.length;
      return new Decimal(avg);
    }
  }

  if (typeof obj.confidence === "number") {
    return new Decimal(obj.confidence);
  }

  if (typeof obj.document_confidence === "number") {
    return new Decimal(obj.document_confidence);
  }

  return undefined;
}

export const agentWorkflow = null;
