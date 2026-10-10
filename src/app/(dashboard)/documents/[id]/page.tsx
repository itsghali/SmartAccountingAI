"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  Calculator,
  Check,
  CheckCircle,
  FileText,
  RotateCcw,
  Save,
  Sparkles,
  XCircle,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAppContext } from "@/hooks/useAppContext";
import { toast } from "sonner";

interface ExtractedField {
  id: string;
  fieldName: string;
  fieldValue: unknown;
  confidenceScore: number | null;
  reviewStatus: string;
  correctedValue: unknown;
}

interface DocumentRecord {
  id: string;
  originalFilename: string;
  mimeType: string;
  status: string;
  fileSize: number | null;
  createdAt: string;
  extractedFields: ExtractedField[];
  approvedBy: { firstName: string; lastName: string } | null;
  approvedAt: string | null;
}

interface EntryProposalLine {
  lineNumber: number;
  accountCode: string;
  accountLabel: string;
  label: string;
  debit: number;
  credit: number;
  confidence: number;
  rationale?: string;
}

interface EntryProposalSuggestion {
  type: "PROPOSED_JOURNAL_ENTRY";
  confidence: number;
  description: string;
  reason: string;
  warnings?: string[];
  proposedEntry: {
    journalCode: string;
    journalLabel: string;
    entryDate: string;
    reference?: string;
    description: string;
    isBalanced: boolean;
    totalDebit: number;
    totalCredit: number;
    lines: EntryProposalLine[];
  };
}

interface EntryProposalRecord {
  id: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CORRECTED";
  reviewNotes: string | null;
  reviewedAt: string | null;
  reviewedBy: { firstName: string; lastName: string } | null;
  summary: string | null;
  suggestion: EntryProposalSuggestion;
}

interface TaxDeterminationValue {
  type: "DOCUMENT_TAX_CLASSIFICATION";
  confidence: number;
  description: string;
  reason: string;
  category: string;
  vatApplicability: string;
  vatTreatment: string;
  warnings?: string[];
  edgeCases?: string[];
  engineResult: {
    jurisdictionCode: "MA";
    regime: "ENCAISSEMENT" | "DEBIT" | null;
    category: string;
    vatApplicability: string;
    vatTreatment: string;
    currency: string;
    taxableBase: number;
    vatRatePercent: number;
    vatAmount: number;
    totalAmount: number;
    deductibleVATAmount: number;
    collectedVATAmount: number;
    computationBasis: string;
    engineNotes: string[];
    edgeCases: string[];
    requiresHumanReview: boolean;
  };
}

interface TaxDeterminationRecord {
  id: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CORRECTED";
  reviewNotes: string | null;
  reviewedAt: string | null;
  reviewedBy: { firstName: string; lastName: string } | null;
  summary: string | null;
  determination: TaxDeterminationValue;
}

const CONFIDENCE_THRESHOLD = 0.8;
const TAX_CATEGORY_OPTIONS = [
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
] as const;
const VAT_APPLICABILITY_OPTIONS = [
  "INPUT_VAT_RECOVERABLE",
  "INPUT_VAT_NON_RECOVERABLE",
  "OUTPUT_VAT_COLLECTED",
  "VAT_EXEMPT",
  "VAT_OUT_OF_SCOPE",
  "VAT_REVERSE_CHARGE",
  "UNKNOWN",
] as const;
const VAT_TREATMENT_OPTIONS = [
  "STANDARD_20",
  "REDUCED_14",
  "REDUCED_10",
  "REDUCED_7",
  "ZERO_RATED",
  "EXEMPT",
  "OUT_OF_SCOPE",
  "REVERSE_CHARGE",
  "UNKNOWN",
] as const;

function formatFieldName(name: string) {
  return name
    .replace(/^fields\./, "")
    .replace(/_/g, " ")
    .replace(/\./g, " › ")
    .replace(/\[/g, " [")
    .replace(/\]/g, "]")
    .replace(/^([a-z])/, (char) => char.toUpperCase());
}

function getFieldSection(name: string) {
  if (name.startsWith("fields.vendor")) return "Vendor Information";
  if (name.startsWith("fields.invoice")) return "Invoice Details";
  if (name.startsWith("fields.total")) return "Totals";
  if (name.startsWith("line_items")) return "Line Items";
  if (name.startsWith("financial_tables.")) return "Financial Tables";
  if (name === "document_type") return "Document Type";
  return "Other";
}

function isFinancialTableField(name: string) {
  return name.startsWith("financial_tables.");
}

function parseFinancialTableField(name: string) {
  // financial_tables.TABLE_CODE.ROW_CODE.COLUMN_NAME
  // financial_tables.TABLE_CODE._table_name (metadata)
  // financial_tables.TABLE_CODE.ROW_CODE._label (metadata)
  const parts = name.replace("financial_tables.", "").split(".");
  return {
    tableCode: parts[0] ?? "",
    rowCode: parts[1] ?? "",
    column: parts[2] ?? "",
    isTableName: parts[1] === "_table_name",
    isRowLabel: parts[2] === "_label",
  };
}

interface FinancialTableGroup {
  tableCode: string;
  tableName: string;
  rows: Array<{
    rowCode: string;
    label: string;
    columns: Array<{ columnCode: string; field: ExtractedField }>;
  }>;
}

function buildFinancialTableGroups(fields: ExtractedField[]): FinancialTableGroup[] {
  const ftFields = fields.filter((f) => isFinancialTableField(f.fieldName));
  const tableMap = new Map<string, { name: string; rows: Map<string, { label: string; columns: Map<string, ExtractedField> }> }>();

  for (const field of ftFields) {
    const parsed = parseFinancialTableField(field.fieldName);
    if (!tableMap.has(parsed.tableCode)) {
      tableMap.set(parsed.tableCode, { name: "", rows: new Map() });
    }
    const table = tableMap.get(parsed.tableCode)!;

    if (parsed.isTableName) {
      table.name = String(field.fieldValue ?? parsed.tableCode);
      continue;
    }

    if (!table.rows.has(parsed.rowCode)) {
      table.rows.set(parsed.rowCode, { label: parsed.rowCode, columns: new Map() });
    }
    const row = table.rows.get(parsed.rowCode)!;

    if (parsed.isRowLabel) {
      row.label = String(field.fieldValue ?? parsed.rowCode);
      continue;
    }

    if (parsed.column) {
      row.columns.set(parsed.column, field);
    }
  }

  return Array.from(tableMap.entries()).map(([tableCode, table]) => ({
    tableCode,
    tableName: table.name || tableCode,
    rows: Array.from(table.rows.entries()).map(([rowCode, row]) => ({
      rowCode,
      label: row.label || rowCode,
      columns: Array.from(row.columns.entries()).map(([columnCode, field]) => ({
        columnCode,
        field,
      })),
    })),
  }));
}

function groupFieldsBySection(fields: ExtractedField[]) {
  return fields.reduce<Record<string, ExtractedField[]>>((acc, field) => {
    const section = getFieldSection(field.fieldName);
    if (!acc[section]) acc[section] = [];
    acc[section].push(field);
    return acc;
  }, {});
}

function normalizeReviewStatus(status: string) {
  if (status === "ACCEPTED") return "APPROVED";
  if (status === "REVIEWED") return "REJECTED";
  return status;
}

function statusBadgeClass(status: string) {
  switch (normalizeReviewStatus(status)) {
    case "APPROVED":
      return "bg-green-100 text-green-700";
    case "REJECTED":
      return "bg-red-100 text-red-700";
    case "CORRECTED":
      return "bg-blue-100 text-blue-700";
    default:
      return "bg-slate-100 text-slate-700";
  }
}

function serializeValue(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function coerceEditedValue(rawValue: string, originalValue: unknown) {
  if (typeof originalValue === "number") {
    const numericValue = Number(rawValue);
    return Number.isFinite(numericValue) ? numericValue : rawValue;
  }

  if (typeof originalValue === "boolean") {
    if (rawValue.toLowerCase() === "true") return true;
    if (rawValue.toLowerCase() === "false") return false;
  }

  if (Array.isArray(originalValue) || (originalValue && typeof originalValue === "object")) {
    try {
      return JSON.parse(rawValue);
    } catch {
      return rawValue;
    }
  }

  return rawValue;
}

function formatAmount(value: number) {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatTokenLabel(value: string | null | undefined) {
  if (!value) {
    return "-";
  }

  return value.replaceAll("_", " ");
}

function cloneSerializable<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function parseNumberInput(value: string) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function toMultilineValue(values: string[] | undefined) {
  return (values ?? []).join("\n");
}

function parseMultilineValue(rawValue: string) {
  return rawValue
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function normalizeProposalCorrection(
  suggestion: EntryProposalSuggestion
): EntryProposalSuggestion {
  const lines = suggestion.proposedEntry.lines.map((line, index) => ({
    ...line,
    lineNumber: index + 1,
    debit: Number(line.debit.toFixed(2)),
    credit: Number(line.credit.toFixed(2)),
  }));
  const totalDebit = Number(
    lines.reduce((sum, line) => sum + line.debit, 0).toFixed(2)
  );
  const totalCredit = Number(
    lines.reduce((sum, line) => sum + line.credit, 0).toFixed(2)
  );

  return {
    ...suggestion,
    warnings: suggestion.warnings?.filter((warning) => warning.trim().length > 0),
    proposedEntry: {
      ...suggestion.proposedEntry,
      reference: suggestion.proposedEntry.reference?.trim() || undefined,
      lines,
      totalDebit,
      totalCredit,
      isBalanced: Math.abs(totalDebit - totalCredit) < 0.01,
    },
  };
}

function normalizeTaxCorrection(
  determination: TaxDeterminationValue
): TaxDeterminationValue {
  return {
    ...determination,
    warnings: determination.warnings?.filter((warning) => warning.trim().length > 0),
    edgeCases: determination.edgeCases?.filter((edgeCase) => edgeCase.trim().length > 0),
    engineResult: {
      ...determination.engineResult,
      category: determination.category,
      vatApplicability: determination.vatApplicability,
      vatTreatment: determination.vatTreatment,
      taxableBase: Number(determination.engineResult.taxableBase.toFixed(2)),
      vatRatePercent: Number(determination.engineResult.vatRatePercent.toFixed(4)),
      vatAmount: Number(determination.engineResult.vatAmount.toFixed(2)),
      totalAmount: Number(determination.engineResult.totalAmount.toFixed(2)),
      deductibleVATAmount: Number(
        determination.engineResult.deductibleVATAmount.toFixed(2)
      ),
      collectedVATAmount: Number(
        determination.engineResult.collectedVATAmount.toFixed(2)
      ),
      engineNotes: determination.engineResult.engineNotes.filter(
        (note) => note.trim().length > 0
      ),
      edgeCases: determination.engineResult.edgeCases.filter(
        (edgeCase) => edgeCase.trim().length > 0
      ),
    },
  };
}

export default function DocumentReviewPage() {
  const params = useParams();
  const documentId = params.id as string;
  const { currentFiscalYearId } = useAppContext();
  const [zoom, setZoom] = useState(1);
  const [editedValues, setEditedValues] = useState<Record<string, string>>({});
  const [isApproveDialogOpen, setIsApproveDialogOpen] = useState(false);
  const [approveNotes, setApproveNotes] = useState("");
  const [isProposalCorrectionDialogOpen, setIsProposalCorrectionDialogOpen] =
    useState(false);
  const [proposalCorrectionDraft, setProposalCorrectionDraft] =
    useState<EntryProposalSuggestion | null>(null);
  const [proposalCorrectionNotes, setProposalCorrectionNotes] = useState("");
  const [isTaxCorrectionDialogOpen, setIsTaxCorrectionDialogOpen] = useState(false);
  const [taxCorrectionDraft, setTaxCorrectionDraft] =
    useState<TaxDeterminationValue | null>(null);
  const [taxCorrectionNotes, setTaxCorrectionNotes] = useState("");

  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ["document", documentId],
    queryFn: async () => {
      const res = await fetch(`/api/documents/${documentId}`);
      if (!res.ok) throw new Error("Failed to fetch document");
      const payload = await res.json();
      return payload.document as DocumentRecord;
    },
  });

  const reviewFieldMutation = useMutation({
    mutationFn: async ({
      fieldId,
      reviewStatus,
      correctedValue,
    }: {
      fieldId: string;
      reviewStatus: "APPROVED" | "REJECTED" | "CORRECTED";
      correctedValue?: unknown;
    }) => {
      const res = await fetch(`/api/documents/${documentId}/fields/${fieldId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewStatus, correctedValue }),
      });

      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload.error || "Failed to review field");
      }

      return payload;
    },
    onSuccess: () => {
      toast.success("Field review saved");
      refetch();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Field review failed");
    },
  });

  const {
    data: entryProposal,
    isLoading: isLoadingEntryProposal,
    refetch: refetchEntryProposal,
  } = useQuery({
    queryKey: ["document-entry-proposal", documentId],
    queryFn: async () => {
      const res = await fetch(`/api/documents/${documentId}/entry-proposal`);
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload.error || "Failed to fetch entry proposal");
      }
      return payload.proposal as EntryProposalRecord | null;
    },
    enabled: !!documentId,
  });

  const {
    data: taxDetermination,
    error: taxDeterminationError,
    isLoading: isLoadingTaxDetermination,
    refetch: refetchTaxDetermination,
  } = useQuery({
    queryKey: ["document-tax-determination", documentId],
    queryFn: async () => {
      const res = await fetch(`/api/documents/${documentId}/tax-determination`);
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload.error || "Failed to fetch tax determination");
      }
      return payload.determination as TaxDeterminationRecord | null;
    },
    enabled: !!documentId,
  });

  const generateProposalMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/documents/${documentId}/entry-proposal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fiscalYearId: currentFiscalYearId ?? undefined,
        }),
      });

      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload.error || "Failed to generate entry proposal");
      }

      return payload;
    },
    onSuccess: () => {
      toast.success("Journal entry proposal generated");
      refetchEntryProposal();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Proposal generation failed");
    },
  });

  const generateTaxDeterminationMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/documents/${documentId}/tax-determination`, {
        method: "POST",
      });

      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload.error || "Failed to generate tax determination");
      }

      return payload;
    },
    onSuccess: () => {
      toast.success("Tax determination generated");
      refetchTaxDetermination();
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Tax determination failed"
      );
    },
  });

  const reviewProposalMutation = useMutation({
    mutationFn: async ({
      suggestionId,
      status,
      correctedValue,
      notes,
    }: {
      suggestionId: string;
      status: "APPROVED" | "REJECTED" | "CORRECTED";
      correctedValue?: EntryProposalSuggestion;
      notes?: string;
    }) => {
      const res = await fetch(`/api/suggestions/${suggestionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, correctedValue, notes }),
      });

      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload.error || "Failed to review proposal");
      }

      return payload;
    },
    onSuccess: (_, variables) => {
      toast.success(
        variables.status === "APPROVED"
          ? "Proposal approved"
          : variables.status === "CORRECTED"
            ? "Proposal corrected"
            : "Proposal rejected"
      );
      if (variables.status === "CORRECTED") {
        setIsProposalCorrectionDialogOpen(false);
        setProposalCorrectionDraft(null);
        setProposalCorrectionNotes("");
      }
      refetchEntryProposal();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Proposal review failed");
    },
  });

  const reviewTaxDeterminationMutation = useMutation({
    mutationFn: async ({
      suggestionId,
      status,
      correctedValue,
      notes,
    }: {
      suggestionId: string;
      status: "APPROVED" | "REJECTED" | "CORRECTED";
      correctedValue?: TaxDeterminationValue;
      notes?: string;
    }) => {
      const res = await fetch(`/api/suggestions/${suggestionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, correctedValue, notes }),
      });

      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload.error || "Failed to review tax determination");
      }

      return payload;
    },
    onSuccess: (_, variables) => {
      toast.success(
        variables.status === "APPROVED"
          ? "Tax result approved"
          : variables.status === "CORRECTED"
            ? "Tax result corrected"
            : "Tax result rejected"
      );
      if (variables.status === "CORRECTED") {
        setIsTaxCorrectionDialogOpen(false);
        setTaxCorrectionDraft(null);
        setTaxCorrectionNotes("");
      }
      refetchTaxDetermination();
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : "Tax result review failed"
      );
    },
  });

  const approveMutation = useMutation({
    mutationFn: async (notes: string) => {
      const res = await fetch(`/api/documents/${documentId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes }),
      });

      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload.error || "Failed to approve document");
      }

      return payload;
    },
    onSuccess: () => {
      toast.success("Document approved");
      setIsApproveDialogOpen(false);
      refetch();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Document approval failed");
    },
  });

  const reprocessMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/documents/${documentId}/reprocess`, {
        method: "POST",
      });

      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload.error || "Failed to reprocess document");
      }

      return payload;
    },
    onSuccess: () => {
      toast.success("Document reprocessing started");
      refetch();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Document reprocessing failed");
    },
  });

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-6">
        <p>{error instanceof Error ? error.message : "Document not found"}</p>
        <Link href="/documents">
          <Button variant="link">Back to documents</Button>
        </Link>
      </div>
    );
  }

  const groupedFields = groupFieldsBySection(data.extractedFields);
  const warningsField = data.extractedFields.find((field) => field.fieldName === "warnings");
  const warnings = Array.isArray(warningsField?.fieldValue)
    ? (warningsField.fieldValue as string[])
    : [];
  const reviewableFields = data.extractedFields.filter((field) => field.fieldName !== "warnings");
  const pendingCount = reviewableFields.filter(
    (field) => normalizeReviewStatus(field.reviewStatus) === "PENDING"
  ).length;
  const correctedCount = reviewableFields.filter(
    (field) => normalizeReviewStatus(field.reviewStatus) === "CORRECTED"
  ).length;
  const approvedCount = reviewableFields.filter(
    (field) => normalizeReviewStatus(field.reviewStatus) === "APPROVED"
  ).length;
  const rejectedCount = reviewableFields.filter(
    (field) => normalizeReviewStatus(field.reviewStatus) === "REJECTED"
  ).length;
  const proposalReadyForDraft =
    entryProposal &&
    (entryProposal.status === "APPROVED" || entryProposal.status === "CORRECTED");
  const taxResultApproved =
    taxDetermination &&
    (taxDetermination.status === "APPROVED" ||
      taxDetermination.status === "CORRECTED");
  const proposalCorrectionPreview = proposalCorrectionDraft
    ? normalizeProposalCorrection(proposalCorrectionDraft)
    : null;
  const taxCorrectionPreview = taxCorrectionDraft
    ? normalizeTaxCorrection(taxCorrectionDraft)
    : null;

  const openProposalCorrectionDialog = () => {
    if (!entryProposal) {
      return;
    }

    setProposalCorrectionDraft(cloneSerializable(entryProposal.suggestion));
    setProposalCorrectionNotes(entryProposal.reviewNotes ?? "");
    setIsProposalCorrectionDialogOpen(true);
  };

  const openTaxCorrectionDialog = () => {
    if (!taxDetermination) {
      return;
    }

    setTaxCorrectionDraft(cloneSerializable(taxDetermination.determination));
    setTaxCorrectionNotes(taxDetermination.reviewNotes ?? "");
    setIsTaxCorrectionDialogOpen(true);
  };

  const updateProposalDraftLine = (
    lineIndex: number,
    updates: Partial<EntryProposalLine>
  ) => {
    setProposalCorrectionDraft((currentDraft) => {
      if (!currentDraft) {
        return currentDraft;
      }

      const lines = currentDraft.proposedEntry.lines.map((line, index) =>
        index === lineIndex ? { ...line, ...updates } : line
      );

      return {
        ...currentDraft,
        proposedEntry: {
          ...currentDraft.proposedEntry,
          lines,
        },
      };
    });
  };

  const addProposalDraftLine = () => {
    setProposalCorrectionDraft((currentDraft) => {
      if (!currentDraft) {
        return currentDraft;
      }

      return {
        ...currentDraft,
        proposedEntry: {
          ...currentDraft.proposedEntry,
          lines: [
            ...currentDraft.proposedEntry.lines,
            {
              lineNumber: currentDraft.proposedEntry.lines.length + 1,
              accountCode: "",
              accountLabel: "",
              label: "",
              debit: 0,
              credit: 0,
              confidence: 1,
            },
          ],
        },
      };
    });
  };

  const removeProposalDraftLine = (lineIndex: number) => {
    setProposalCorrectionDraft((currentDraft) => {
      if (!currentDraft || currentDraft.proposedEntry.lines.length <= 2) {
        return currentDraft;
      }

      return {
        ...currentDraft,
        proposedEntry: {
          ...currentDraft.proposedEntry,
          lines: currentDraft.proposedEntry.lines.filter(
            (_, index) => index !== lineIndex
          ),
        },
      };
    });
  };

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      <div className="flex items-center justify-between border-b px-6 py-4">
        <div className="flex items-center gap-4">
          <Link href="/documents">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
          </Link>
          <div>
            <h1 className="text-lg font-semibold">{data.originalFilename}</h1>
            <p className="text-sm text-muted-foreground">
              {approvedCount} approved, {correctedCount} corrected, {rejectedCount} rejected,{" "}
              {pendingCount} pending
            </p>
          </div>
          <Badge
            className={
              data.status === "REVIEW_REQUIRED"
                ? "bg-yellow-100 text-yellow-700"
                : data.status === "APPROVED"
                  ? "bg-green-100 text-green-700"
                  : "bg-slate-100 text-slate-700"
            }
          >
            {data.status.replaceAll("_", " ")}
          </Badge>
        </div>

        <div className="flex items-center gap-2">
          {warnings.length > 0 && (
            <Badge variant="outline" className="border-yellow-500 text-yellow-700">
              <AlertCircle className="mr-1 h-3 w-3" />
              {warnings.length} warning{warnings.length > 1 ? "s" : ""}
            </Badge>
          )}

          {data.status !== "PROCESSING" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => reprocessMutation.mutate()}
              disabled={reprocessMutation.isPending}
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              Reprocess
            </Button>
          )}

          {data.status === "REVIEW_REQUIRED" && (
            <Button
              size="sm"
              onClick={() => setIsApproveDialogOpen(true)}
              disabled={approveMutation.isPending || pendingCount > 0}
            >
              <CheckCircle className="mr-2 h-4 w-4" />
              Approve Document
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-3 border-b bg-muted/20 px-6 py-3 text-sm md:grid-cols-4">
        <div className="rounded-md border bg-white px-3 py-2">
          <div className="text-muted-foreground">Pending Review</div>
          <div className="text-lg font-semibold text-yellow-700">{pendingCount}</div>
        </div>
        <div className="rounded-md border bg-white px-3 py-2">
          <div className="text-muted-foreground">Approved</div>
          <div className="text-lg font-semibold text-green-700">{approvedCount}</div>
        </div>
        <div className="rounded-md border bg-white px-3 py-2">
          <div className="text-muted-foreground">Corrected</div>
          <div className="text-lg font-semibold text-blue-700">{correctedCount}</div>
        </div>
        <div className="rounded-md border bg-white px-3 py-2">
          <div className="text-muted-foreground">Rejected</div>
          <div className="text-lg font-semibold text-red-700">{rejectedCount}</div>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-1 flex-col border-r bg-muted/30">
          <div className="flex items-center justify-between border-b bg-white px-4 py-2">
            <span className="text-sm font-medium">Document Preview</span>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setZoom((currentZoom) => Math.max(0.5, currentZoom - 0.1))}
              >
                <ZoomOut className="h-4 w-4" />
              </Button>
              <span className="px-2 text-sm">{Math.round(zoom * 100)}%</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setZoom((currentZoom) => Math.min(3, currentZoom + 0.1))}
              >
                <ZoomIn className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="flex-1 overflow-auto p-4">
            {data.mimeType === "application/pdf" ? (
              <iframe
                src={`/api/documents/${documentId}/file`}
                className="h-full w-full rounded border bg-white"
                style={{ transform: `scale(${zoom})`, transformOrigin: "top left" }}
              />
            ) : data.mimeType.startsWith("image/") ? (
              <Image
                src={`/api/documents/${documentId}/file`}
                alt="Document"
                width={1200}
                height={900}
                unoptimized
                className="mx-auto max-h-full rounded border bg-white object-contain"
                style={{ transform: `scale(${zoom})` }}
              />
            ) : (
              <div className="flex h-full items-center justify-center">
                <FileText className="h-16 w-16 text-muted-foreground" />
                <p className="ml-4 text-muted-foreground">Preview not available</p>
              </div>
            )}
          </div>
        </div>

        <div className="w-130 overflow-y-auto bg-white p-4">
          {warnings.length > 0 && (
            <div className="mb-4 rounded-md border border-yellow-200 bg-yellow-50 p-3">
              <div className="flex items-center gap-2 text-yellow-800">
                <AlertCircle className="h-4 w-4" />
                <span className="font-medium">Extraction Warnings</span>
              </div>
              <ul className="mt-2 list-inside list-disc text-sm text-yellow-700">
                {warnings.map((warning, index) => (
                  <li key={`${warning}-${index}`}>{warning}</li>
                ))}
              </ul>
            </div>
          )}

          {pendingCount > 0 && data.status === "REVIEW_REQUIRED" && (
            <div className="mb-4 rounded-md border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-800">
              Every field suggestion must be approved, rejected, or corrected before the
              document can be approved.
            </div>
          )}

          {Object.entries(groupedFields).map(([section, fields]) => {
            // Render Financial Tables section as structured tables
            if (section === "Financial Tables") {
              const tableGroups = buildFinancialTableGroups(fields);
              return tableGroups.map((table) => {
                const allColumnCodes = Array.from(
                  new Set(table.rows.flatMap((r) => r.columns.map((c) => c.columnCode)))
                );
                return (
                  <Card key={table.tableCode} className="mb-4">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-semibold">{table.tableName}</CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b bg-muted/30">
                            <th className="px-3 py-2 text-left font-medium text-muted-foreground">Libellé</th>
                            {allColumnCodes.map((col) => (
                              <th key={col} className="px-3 py-2 text-right font-medium text-muted-foreground">
                                {col}
                              </th>
                            ))}
                            <th className="w-24 px-3 py-2 text-right font-medium text-muted-foreground">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {table.rows.map((row) => (
                            <tr key={row.rowCode} className="border-b last:border-0">
                              <td className="px-3 py-2 text-sm">{row.label}</td>
                              {allColumnCodes.map((col) => {
                                const colData = row.columns.find((c) => c.columnCode === col);
                                if (!colData) return <td key={col} className="px-3 py-2 text-right" />;
                                const field = colData.field;
                                const referenceValue =
                                  field.correctedValue !== null ? field.correctedValue : field.fieldValue;
                                const displayValue = serializeValue(referenceValue);
                                const hasPendingEdit =
                                  editedValues[field.id] !== undefined &&
                                  editedValues[field.id] !== displayValue;
                                const isLowConfidence =
                                  field.confidenceScore !== null &&
                                  field.confidenceScore < CONFIDENCE_THRESHOLD;

                                return (
                                  <td key={col} className="px-3 py-2 text-right">
                                    <div className="flex items-center justify-end gap-1">
                                      <Input
                                        value={editedValues[field.id] ?? displayValue}
                                        onChange={(event) =>
                                          setEditedValues((currentValues) => ({
                                            ...currentValues,
                                            [field.id]: event.target.value,
                                          }))
                                        }
                                        disabled={data.status === "APPROVED"}
                                        className={`h-7 w-28 text-right font-mono text-sm ${
                                          isLowConfidence ? "border-yellow-300" : ""
                                        }`}
                                      />
                                      {data.status !== "APPROVED" && hasPendingEdit && (
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          className="h-7 w-7 p-0"
                                          onClick={() =>
                                            reviewFieldMutation.mutate({
                                              fieldId: field.id,
                                              reviewStatus: "CORRECTED",
                                              correctedValue: coerceEditedValue(
                                                editedValues[field.id] ?? displayValue,
                                                field.correctedValue ?? field.fieldValue
                                              ),
                                            })
                                          }
                                          disabled={reviewFieldMutation.isPending}
                                        >
                                          <Save className="h-3.5 w-3.5" />
                                        </Button>
                                      )}
                                    </div>
                                  </td>
                                );
                              })}
                              <td className="px-3 py-2 text-right">
                                {(() => {
                                  // Show status of first column field as representative
                                  const firstCol = row.columns[0]?.field;
                                  if (!firstCol) return null;
                                  const normalizedStatus = normalizeReviewStatus(firstCol.reviewStatus);
                                  return (
                                    <div className="flex items-center justify-end gap-1">
                                      {data.status !== "APPROVED" && (
                                        <div className="flex gap-1">
                                          <Button
                                            size="sm"
                                            variant={normalizedStatus === "APPROVED" ? "default" : "ghost"}
                                            className="h-6 w-6 p-0"
                                            onClick={() => {
                                              row.columns.forEach((c) => {
                                                if (normalizeReviewStatus(c.field.reviewStatus) !== "APPROVED") {
                                                  reviewFieldMutation.mutate({
                                                    fieldId: c.field.id,
                                                    reviewStatus: "APPROVED",
                                                  });
                                                }
                                              });
                                            }}
                                            disabled={reviewFieldMutation.isPending}
                                          >
                                            <Check className="h-3 w-3" />
                                          </Button>
                                          <Button
                                            size="sm"
                                            variant="ghost"
                                            className="h-6 w-6 p-0"
                                            onClick={() => {
                                              row.columns.forEach((c) => {
                                                if (normalizeReviewStatus(c.field.reviewStatus) !== "REJECTED") {
                                                  reviewFieldMutation.mutate({
                                                    fieldId: c.field.id,
                                                    reviewStatus: "REJECTED",
                                                  });
                                                }
                                              });
                                            }}
                                            disabled={reviewFieldMutation.isPending}
                                          >
                                            <XCircle className="h-3 w-3" />
                                          </Button>
                                        </div>
                                      )}
                                      <Badge className={statusBadgeClass(normalizedStatus)}>
                                        {normalizedStatus}
                                      </Badge>
                                    </div>
                                  );
                                })()}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </CardContent>
                  </Card>
                );
              });
            }

            // Standard flat field rendering for other sections
            return (
            <Card key={section} className="mb-4">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold">{section}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {fields
                  .filter((field) => field.fieldName !== "warnings")
                  .map((field) => {
                    const normalizedStatus = normalizeReviewStatus(field.reviewStatus);
                    const isLowConfidence =
                      field.confidenceScore !== null &&
                      field.confidenceScore < CONFIDENCE_THRESHOLD;
                    const referenceValue =
                      field.correctedValue !== null ? field.correctedValue : field.fieldValue;
                    const displayValue = serializeValue(referenceValue);
                    const hasPendingEdit =
                      editedValues[field.id] !== undefined &&
                      editedValues[field.id] !== displayValue;

                    return (
                      <div
                        key={field.id}
                        className={`rounded-md border p-3 ${
                          isLowConfidence ? "border-yellow-400 bg-yellow-50/40" : "border-border"
                        }`}
                      >
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <Label className="text-xs font-medium text-muted-foreground">
                            {formatFieldName(field.fieldName)}
                          </Label>
                          <div className="flex items-center gap-2">
                            {field.confidenceScore !== null && (
                              <Badge
                                variant="outline"
                                className={
                                  field.confidenceScore >= CONFIDENCE_THRESHOLD
                                    ? "border-green-200 text-green-700"
                                    : "border-yellow-200 text-yellow-700"
                                }
                              >
                                {Math.round(field.confidenceScore * 100)}%
                              </Badge>
                            )}
                            <Badge className={statusBadgeClass(normalizedStatus)}>
                              {normalizedStatus}
                            </Badge>
                          </div>
                        </div>

                        <div className="flex gap-2">
                          <Input
                            value={editedValues[field.id] ?? displayValue}
                            onChange={(event) =>
                              setEditedValues((currentValues) => ({
                                ...currentValues,
                                [field.id]: event.target.value,
                              }))
                            }
                            disabled={data.status === "APPROVED"}
                            className={isLowConfidence ? "border-yellow-300" : ""}
                          />
                          {data.status !== "APPROVED" && hasPendingEdit && (
                            <Button
                              size="sm"
                              onClick={() =>
                                reviewFieldMutation.mutate({
                                  fieldId: field.id,
                                  reviewStatus: "CORRECTED",
                                  correctedValue: coerceEditedValue(
                                    editedValues[field.id] ?? displayValue,
                                    field.correctedValue ?? field.fieldValue
                                  ),
                                })
                              }
                              disabled={reviewFieldMutation.isPending}
                            >
                              <Save className="h-4 w-4" />
                            </Button>
                          )}
                        </div>

                        {data.status !== "APPROVED" && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              variant={normalizedStatus === "APPROVED" ? "default" : "outline"}
                              onClick={() =>
                                reviewFieldMutation.mutate({
                                  fieldId: field.id,
                                  reviewStatus: "APPROVED",
                                })
                              }
                              disabled={reviewFieldMutation.isPending}
                            >
                              <Check className="mr-1 h-4 w-4" />
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                reviewFieldMutation.mutate({
                                  fieldId: field.id,
                                  reviewStatus: "REJECTED",
                                })
                              }
                              disabled={reviewFieldMutation.isPending}
                            >
                              <XCircle className="mr-1 h-4 w-4" />
                              Reject
                            </Button>
                          </div>
                        )}

                        {isLowConfidence && (
                          <p className="mt-2 flex items-center gap-1 text-xs text-yellow-700">
                            <AlertCircle className="h-3 w-3" />
                            Low confidence, so this value deserves a human decision.
                          </p>
                        )}
                      </div>
                    );
                  })}
              </CardContent>
            </Card>
            );
          })}

          {data.status === "APPROVED" && data.approvedBy && (
            <div className="rounded-md border border-green-200 bg-green-50 p-3">
              <div className="flex items-center gap-2 text-green-800">
                <Check className="h-4 w-4" />
                <span className="font-medium">Approved</span>
              </div>
              <p className="mt-1 text-sm text-green-700">
                By {data.approvedBy.firstName} {data.approvedBy.lastName} on{" "}
                {data.approvedAt && new Date(data.approvedAt).toLocaleString()}
              </p>
            </div>
          )}

          {data.status === "APPROVED" && (
            <Card className="mt-4">
              <CardHeader className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Calculator className="h-4 w-4 text-emerald-600" />
                      Tax Determination
                    </CardTitle>
                    <p className="text-sm text-muted-foreground">
                      AI classifies the tax treatment. The deterministic engine computes the final
                      tax numbers.
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant={taxDetermination ? "outline" : "default"}
                    onClick={() => generateTaxDeterminationMutation.mutate()}
                    disabled={generateTaxDeterminationMutation.isPending}
                  >
                    {taxDetermination ? "Regenerate" : "Generate"}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {taxDeterminationError instanceof Error ? (
                  <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                    {taxDeterminationError.message}
                  </div>
                ) : isLoadingTaxDetermination ? (
                  <p className="text-sm text-muted-foreground">Loading tax determination...</p>
                ) : !taxDetermination ? (
                  <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                    Generate a tax determination to review the suggested tax category, VAT
                    applicability, and the deterministic computation result before approval.
                  </div>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className={statusBadgeClass(taxDetermination.status)}>
                        {taxDetermination.status}
                      </Badge>
                      <Badge variant="outline">
                        {Math.round(taxDetermination.determination.confidence * 100)}% confidence
                      </Badge>
                      <Badge variant="outline">
                        {formatTokenLabel(taxDetermination.determination.category)}
                      </Badge>
                      <Badge variant="outline">
                        {formatTokenLabel(taxDetermination.determination.vatApplicability)}
                      </Badge>
                    </div>

                    <div className="rounded-md border bg-muted/20 p-3 text-sm">
                      <p className="font-medium">{taxDetermination.determination.description}</p>
                      <p className="mt-1 text-muted-foreground">
                        {taxDetermination.determination.reason}
                      </p>
                      {taxDetermination.summary && (
                        <p className="mt-2 text-muted-foreground">{taxDetermination.summary}</p>
                      )}
                      {taxDetermination.reviewNotes && (
                        <p className="mt-2 text-xs text-muted-foreground">
                          Review notes: {taxDetermination.reviewNotes}
                        </p>
                      )}
                      {taxDetermination.reviewedBy && taxDetermination.reviewedAt && (
                        <p className="mt-2 text-xs text-muted-foreground">
                          Reviewed by {taxDetermination.reviewedBy.firstName}{" "}
                          {taxDetermination.reviewedBy.lastName} on{" "}
                          {new Date(taxDetermination.reviewedAt).toLocaleString()}
                        </p>
                      )}
                    </div>

                    <div className="grid gap-3 text-sm md:grid-cols-2">
                      <div className="rounded-md border p-3">
                        <div className="text-muted-foreground">VAT Treatment</div>
                        <div className="font-medium">
                          {formatTokenLabel(taxDetermination.determination.vatTreatment)}
                        </div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-muted-foreground">Regime</div>
                        <div className="font-medium">
                          {formatTokenLabel(
                            taxDetermination.determination.engineResult.regime
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="rounded-md border overflow-hidden">
                      <div className="grid grid-cols-2 bg-muted/40 px-3 py-2 text-xs font-medium uppercase text-muted-foreground">
                        <div>Deterministic Engine</div>
                        <div className="text-right">
                          {formatTokenLabel(
                            taxDetermination.determination.engineResult.computationBasis
                          )}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-0 border-t text-sm">
                        <div className="border-r px-3 py-2 text-muted-foreground">Taxable Base</div>
                        <div className="px-3 py-2 text-right">
                          {formatAmount(
                            taxDetermination.determination.engineResult.taxableBase
                          )}{" "}
                          {taxDetermination.determination.engineResult.currency}
                        </div>
                        <div className="border-r border-t px-3 py-2 text-muted-foreground">
                          VAT Rate
                        </div>
                        <div className="border-t px-3 py-2 text-right">
                          {formatAmount(
                            taxDetermination.determination.engineResult.vatRatePercent
                          )}
                          %
                        </div>
                        <div className="border-r border-t px-3 py-2 text-muted-foreground">
                          VAT Amount
                        </div>
                        <div className="border-t px-3 py-2 text-right">
                          {formatAmount(
                            taxDetermination.determination.engineResult.vatAmount
                          )}{" "}
                          {taxDetermination.determination.engineResult.currency}
                        </div>
                        <div className="border-r border-t px-3 py-2 text-muted-foreground">
                          Total Amount
                        </div>
                        <div className="border-t px-3 py-2 text-right">
                          {formatAmount(
                            taxDetermination.determination.engineResult.totalAmount
                          )}{" "}
                          {taxDetermination.determination.engineResult.currency}
                        </div>
                        <div className="border-r border-t px-3 py-2 text-muted-foreground">
                          Deductible VAT
                        </div>
                        <div className="border-t px-3 py-2 text-right">
                          {formatAmount(
                            taxDetermination.determination.engineResult
                              .deductibleVATAmount
                          )}{" "}
                          {taxDetermination.determination.engineResult.currency}
                        </div>
                        <div className="border-r border-t px-3 py-2 text-muted-foreground">
                          Collected VAT
                        </div>
                        <div className="border-t px-3 py-2 text-right">
                          {formatAmount(
                            taxDetermination.determination.engineResult.collectedVATAmount
                          )}{" "}
                          {taxDetermination.determination.engineResult.currency}
                        </div>
                      </div>
                    </div>

                    {taxDetermination.determination.engineResult.engineNotes.length > 0 && (
                      <div className="rounded-md border p-3">
                        <div className="text-sm font-medium">Engine Notes</div>
                        <ul className="mt-2 list-inside list-disc text-sm text-muted-foreground">
                          {taxDetermination.determination.engineResult.engineNotes.map(
                            (note, index) => (
                              <li key={`${note}-${index}`}>{note}</li>
                            )
                          )}
                        </ul>
                      </div>
                    )}

                    {taxDetermination.determination.engineResult.edgeCases.length > 0 && (
                      <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
                        <div className="flex items-center gap-2 text-amber-900">
                          <AlertCircle className="h-4 w-4" />
                          <span className="font-medium">Edge Cases</span>
                        </div>
                        <ul className="mt-2 list-inside list-disc text-sm text-amber-800">
                          {taxDetermination.determination.engineResult.edgeCases.map(
                            (edgeCase, index) => (
                              <li key={`${edgeCase}-${index}`}>{edgeCase}</li>
                            )
                          )}
                        </ul>
                      </div>
                    )}

                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={openTaxCorrectionDialog}
                        disabled={reviewTaxDeterminationMutation.isPending}
                      >
                        Modify
                      </Button>
                      <Button
                        size="sm"
                        onClick={() =>
                          reviewTaxDeterminationMutation.mutate({
                            suggestionId: taxDetermination.id,
                            status: "APPROVED",
                          })
                        }
                        disabled={
                          reviewTaxDeterminationMutation.isPending ||
                          taxDetermination.status === "APPROVED"
                        }
                      >
                        <Check className="mr-1 h-4 w-4" />
                        Approve Tax Result
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          reviewTaxDeterminationMutation.mutate({
                            suggestionId: taxDetermination.id,
                            status: "REJECTED",
                          })
                        }
                        disabled={reviewTaxDeterminationMutation.isPending}
                      >
                        <XCircle className="mr-1 h-4 w-4" />
                        Reject Tax Result
                      </Button>
                      {taxResultApproved ? (
                        <Badge className="bg-green-100 text-green-700">
                          User-approved result
                        </Badge>
                      ) : (
                        <Badge variant="outline">Approval required</Badge>
                      )}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          )}

          {data.status === "APPROVED" && (
            <Card className="mt-4">
              <CardHeader className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Sparkles className="h-4 w-4 text-blue-600" />
                      Accounting Entry Proposal
                    </CardTitle>
                    <p className="text-sm text-muted-foreground">
                      Build a reviewable journal proposal from the approved document. Nothing is
                      posted automatically.
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant={entryProposal ? "outline" : "default"}
                    onClick={() => generateProposalMutation.mutate()}
                    disabled={generateProposalMutation.isPending}
                  >
                    {entryProposal ? "Regenerate" : "Generate"}
                  </Button>
                </div>
                {!currentFiscalYearId && (
                  <p className="text-xs text-amber-700">
                    No fiscal year is selected in the header, so the default company fiscal year
                    will be used for the proposal context.
                  </p>
                )}
              </CardHeader>
              <CardContent className="space-y-4">
                {isLoadingEntryProposal ? (
                  <p className="text-sm text-muted-foreground">Loading proposal...</p>
                ) : !entryProposal ? (
                  <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                    Generate a proposal to see suggested journal, debit and credit lines, and
                    account labels before you move it into bookkeeping.
                  </div>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className={statusBadgeClass(entryProposal.status)}>
                        {entryProposal.status}
                      </Badge>
                      <Badge variant="outline">
                        {Math.round(entryProposal.suggestion.confidence * 100)}% confidence
                      </Badge>
                      <Badge
                        variant="outline"
                        className={
                          entryProposal.suggestion.proposedEntry.isBalanced
                            ? "border-green-200 text-green-700"
                            : "border-red-200 text-red-700"
                        }
                      >
                        {entryProposal.suggestion.proposedEntry.isBalanced
                          ? "Balanced"
                          : "Needs review"}
                      </Badge>
                    </div>

                    <div className="rounded-md border bg-muted/20 p-3 text-sm">
                      <p className="font-medium">{entryProposal.suggestion.description}</p>
                      <p className="mt-1 text-muted-foreground">{entryProposal.suggestion.reason}</p>
                      {entryProposal.summary && (
                        <p className="mt-2 text-muted-foreground">{entryProposal.summary}</p>
                      )}
                      {entryProposal.reviewNotes && (
                        <p className="mt-2 text-xs text-muted-foreground">
                          Review notes: {entryProposal.reviewNotes}
                        </p>
                      )}
                      {entryProposal.reviewedBy && entryProposal.reviewedAt && (
                        <p className="mt-2 text-xs text-muted-foreground">
                          Reviewed by {entryProposal.reviewedBy.firstName}{" "}
                          {entryProposal.reviewedBy.lastName} on{" "}
                          {new Date(entryProposal.reviewedAt).toLocaleString()}
                        </p>
                      )}
                    </div>

                    <div className="grid gap-3 text-sm md:grid-cols-2">
                      <div className="rounded-md border p-3">
                        <div className="text-muted-foreground">Journal</div>
                        <div className="font-medium">
                          {entryProposal.suggestion.proposedEntry.journalCode} -{" "}
                          {entryProposal.suggestion.proposedEntry.journalLabel}
                        </div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-muted-foreground">Entry Date</div>
                        <div className="font-medium">
                          {entryProposal.suggestion.proposedEntry.entryDate}
                        </div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-muted-foreground">Reference</div>
                        <div className="font-medium">
                          {entryProposal.suggestion.proposedEntry.reference ?? "-"}
                        </div>
                      </div>
                      <div className="rounded-md border p-3">
                        <div className="text-muted-foreground">Description</div>
                        <div className="font-medium">
                          {entryProposal.suggestion.proposedEntry.description}
                        </div>
                      </div>
                    </div>

                    <div className="rounded-md border overflow-hidden">
                      <div className="grid grid-cols-[44px_120px_1.2fr_1.2fr_120px_120px] bg-muted/40 px-3 py-2 text-xs font-medium uppercase text-muted-foreground">
                        <div>#</div>
                        <div>Account</div>
                        <div>Account Label</div>
                        <div>Line Label</div>
                        <div className="text-right">Debit</div>
                        <div className="text-right">Credit</div>
                      </div>
                      {entryProposal.suggestion.proposedEntry.lines.map((line) => (
                        <div
                          key={`${entryProposal.id}-${line.lineNumber}`}
                          className="grid grid-cols-[44px_120px_1.2fr_1.2fr_120px_120px] border-t px-3 py-2 text-sm"
                        >
                          <div>{line.lineNumber}</div>
                          <div className="font-mono">{line.accountCode}</div>
                          <div>{line.accountLabel}</div>
                          <div>{line.label}</div>
                          <div className="text-right">{line.debit > 0 ? formatAmount(line.debit) : "-"}</div>
                          <div className="text-right">{line.credit > 0 ? formatAmount(line.credit) : "-"}</div>
                        </div>
                      ))}
                      <div className="grid grid-cols-[44px_120px_1.2fr_1.2fr_120px_120px] border-t bg-muted/20 px-3 py-2 text-sm font-medium">
                        <div />
                        <div />
                        <div />
                        <div className="text-right">Totals</div>
                        <div className="text-right">
                          {formatAmount(entryProposal.suggestion.proposedEntry.totalDebit)}
                        </div>
                        <div className="text-right">
                          {formatAmount(entryProposal.suggestion.proposedEntry.totalCredit)}
                        </div>
                      </div>
                    </div>

                    {entryProposal.suggestion.warnings &&
                      entryProposal.suggestion.warnings.length > 0 && (
                        <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
                          <div className="flex items-center gap-2 text-amber-900">
                            <AlertCircle className="h-4 w-4" />
                            <span className="font-medium">Proposal Warnings</span>
                          </div>
                          <ul className="mt-2 list-inside list-disc text-sm text-amber-800">
                            {entryProposal.suggestion.warnings.map((warning, index) => (
                              <li key={`${warning}-${index}`}>{warning}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={openProposalCorrectionDialog}
                        disabled={reviewProposalMutation.isPending}
                      >
                        Modify
                      </Button>
                      <Button
                        size="sm"
                        onClick={() =>
                          reviewProposalMutation.mutate({
                            suggestionId: entryProposal.id,
                            status: "APPROVED",
                          })
                        }
                        disabled={
                          reviewProposalMutation.isPending ||
                          entryProposal.status === "APPROVED"
                        }
                      >
                        <Check className="mr-1 h-4 w-4" />
                        Approve Proposal
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          reviewProposalMutation.mutate({
                            suggestionId: entryProposal.id,
                            status: "REJECTED",
                          })
                        }
                        disabled={reviewProposalMutation.isPending}
                      >
                        <XCircle className="mr-1 h-4 w-4" />
                        Reject Proposal
                      </Button>
                      {proposalReadyForDraft ? (
                        <Link href={`/entries/new?proposalId=${entryProposal.id}`}>
                          <Button size="sm" variant="outline">
                            Use In Draft Entry
                          </Button>
                        </Link>
                      ) : (
                        <Button size="sm" variant="outline" disabled>
                          Approve before drafting
                        </Button>
                      )}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <Dialog
        open={isTaxCorrectionDialogOpen}
        onOpenChange={(open) => {
          setIsTaxCorrectionDialogOpen(open);
          if (!open) {
            setTaxCorrectionDraft(null);
            setTaxCorrectionNotes("");
          }
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Modify Tax Determination</DialogTitle>
          </DialogHeader>
          {taxCorrectionDraft && taxDetermination && taxCorrectionPreview && (
            <div className="space-y-4 py-2">
              <p className="text-sm text-muted-foreground">
                Save a human correction before approval when the suggested tax treatment needs
                adjustment.
              </p>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Description</Label>
                  <Input
                    value={taxCorrectionDraft.description}
                    onChange={(event) =>
                      setTaxCorrectionDraft((currentDraft) =>
                        currentDraft
                          ? { ...currentDraft, description: event.target.value }
                          : currentDraft
                      )
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>VAT Treatment</Label>
                  <Select
                    value={taxCorrectionDraft.vatTreatment}
                    onValueChange={(value) =>
                      setTaxCorrectionDraft((currentDraft) =>
                        currentDraft
                          ? {
                              ...currentDraft,
                              vatTreatment:
                                value as TaxDeterminationValue["vatTreatment"],
                              engineResult: {
                                ...currentDraft.engineResult,
                                vatTreatment:
                                  value as TaxDeterminationValue["vatTreatment"],
                              },
                            }
                          : currentDraft
                      )
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {VAT_TREATMENT_OPTIONS.map((option) => (
                        <SelectItem key={option} value={option}>
                          {formatTokenLabel(option)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>Reason</Label>
                  <Textarea
                    rows={3}
                    value={taxCorrectionDraft.reason}
                    onChange={(event) =>
                      setTaxCorrectionDraft((currentDraft) =>
                        currentDraft
                          ? { ...currentDraft, reason: event.target.value }
                          : currentDraft
                      )
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Category</Label>
                  <Select
                    value={taxCorrectionDraft.category}
                    onValueChange={(value) =>
                      setTaxCorrectionDraft((currentDraft) =>
                        currentDraft
                          ? {
                              ...currentDraft,
                              category: value as TaxDeterminationValue["category"],
                              engineResult: {
                                ...currentDraft.engineResult,
                                category: value as TaxDeterminationValue["category"],
                              },
                            }
                          : currentDraft
                      )
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TAX_CATEGORY_OPTIONS.map((option) => (
                        <SelectItem key={option} value={option}>
                          {formatTokenLabel(option)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>VAT Applicability</Label>
                  <Select
                    value={taxCorrectionDraft.vatApplicability}
                    onValueChange={(value) =>
                      setTaxCorrectionDraft((currentDraft) =>
                        currentDraft
                          ? {
                              ...currentDraft,
                              vatApplicability:
                                value as TaxDeterminationValue["vatApplicability"],
                              engineResult: {
                                ...currentDraft.engineResult,
                                vatApplicability:
                                  value as TaxDeterminationValue["vatApplicability"],
                              },
                            }
                          : currentDraft
                      )
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {VAT_APPLICABILITY_OPTIONS.map((option) => (
                        <SelectItem key={option} value={option}>
                          {formatTokenLabel(option)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="rounded-md border p-4">
                <div className="mb-3 text-sm font-medium">Deterministic Engine Values</div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Taxable Base</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={taxCorrectionDraft.engineResult.taxableBase}
                      onChange={(event) =>
                        setTaxCorrectionDraft((currentDraft) =>
                          currentDraft
                            ? {
                                ...currentDraft,
                                engineResult: {
                                  ...currentDraft.engineResult,
                                  taxableBase: parseNumberInput(event.target.value),
                                },
                              }
                            : currentDraft
                        )
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>VAT Rate %</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={taxCorrectionDraft.engineResult.vatRatePercent}
                      onChange={(event) =>
                        setTaxCorrectionDraft((currentDraft) =>
                          currentDraft
                            ? {
                                ...currentDraft,
                                engineResult: {
                                  ...currentDraft.engineResult,
                                  vatRatePercent: parseNumberInput(event.target.value),
                                },
                              }
                            : currentDraft
                        )
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>VAT Amount</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={taxCorrectionDraft.engineResult.vatAmount}
                      onChange={(event) =>
                        setTaxCorrectionDraft((currentDraft) =>
                          currentDraft
                            ? {
                                ...currentDraft,
                                engineResult: {
                                  ...currentDraft.engineResult,
                                  vatAmount: parseNumberInput(event.target.value),
                                },
                              }
                            : currentDraft
                        )
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Total Amount</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={taxCorrectionDraft.engineResult.totalAmount}
                      onChange={(event) =>
                        setTaxCorrectionDraft((currentDraft) =>
                          currentDraft
                            ? {
                                ...currentDraft,
                                engineResult: {
                                  ...currentDraft.engineResult,
                                  totalAmount: parseNumberInput(event.target.value),
                                },
                              }
                            : currentDraft
                        )
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Deductible VAT</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={taxCorrectionDraft.engineResult.deductibleVATAmount}
                      onChange={(event) =>
                        setTaxCorrectionDraft((currentDraft) =>
                          currentDraft
                            ? {
                                ...currentDraft,
                                engineResult: {
                                  ...currentDraft.engineResult,
                                  deductibleVATAmount: parseNumberInput(
                                    event.target.value
                                  ),
                                },
                              }
                            : currentDraft
                        )
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Collected VAT</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={taxCorrectionDraft.engineResult.collectedVATAmount}
                      onChange={(event) =>
                        setTaxCorrectionDraft((currentDraft) =>
                          currentDraft
                            ? {
                                ...currentDraft,
                                engineResult: {
                                  ...currentDraft.engineResult,
                                  collectedVATAmount: parseNumberInput(
                                    event.target.value
                                  ),
                                },
                              }
                            : currentDraft
                        )
                      }
                    />
                  </div>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Warnings</Label>
                  <Textarea
                    rows={4}
                    value={toMultilineValue(taxCorrectionDraft.warnings)}
                    onChange={(event) =>
                      setTaxCorrectionDraft((currentDraft) =>
                        currentDraft
                          ? {
                              ...currentDraft,
                              warnings: parseMultilineValue(event.target.value),
                            }
                          : currentDraft
                      )
                    }
                    placeholder="One warning per line"
                  />
                </div>
                <div className="space-y-2">
                  <Label>AI Edge Cases</Label>
                  <Textarea
                    rows={4}
                    value={toMultilineValue(taxCorrectionDraft.edgeCases)}
                    onChange={(event) =>
                      setTaxCorrectionDraft((currentDraft) =>
                        currentDraft
                          ? {
                              ...currentDraft,
                              edgeCases: parseMultilineValue(event.target.value),
                            }
                          : currentDraft
                      )
                    }
                    placeholder="One edge case per line"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Engine Notes</Label>
                  <Textarea
                    rows={4}
                    value={toMultilineValue(
                      taxCorrectionDraft.engineResult.engineNotes
                    )}
                    onChange={(event) =>
                      setTaxCorrectionDraft((currentDraft) =>
                        currentDraft
                          ? {
                              ...currentDraft,
                              engineResult: {
                                ...currentDraft.engineResult,
                                engineNotes: parseMultilineValue(event.target.value),
                              },
                            }
                          : currentDraft
                      )
                    }
                    placeholder="One note per line"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Engine Edge Cases</Label>
                  <Textarea
                    rows={4}
                    value={toMultilineValue(
                      taxCorrectionDraft.engineResult.edgeCases
                    )}
                    onChange={(event) =>
                      setTaxCorrectionDraft((currentDraft) =>
                        currentDraft
                          ? {
                              ...currentDraft,
                              engineResult: {
                                ...currentDraft.engineResult,
                                edgeCases: parseMultilineValue(event.target.value),
                              },
                            }
                          : currentDraft
                      )
                    }
                    placeholder="One edge case per line"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Correction Notes</Label>
                <Textarea
                  rows={3}
                  value={taxCorrectionNotes}
                  onChange={(event) => setTaxCorrectionNotes(event.target.value)}
                  placeholder="Explain why this tax result was modified"
                />
              </div>

              <div className="rounded-md border bg-muted/20 p-3 text-sm">
                <div className="font-medium">Preview</div>
                <p className="mt-1 text-muted-foreground">
                  {formatTokenLabel(taxCorrectionPreview.category)} /{" "}
                  {formatTokenLabel(taxCorrectionPreview.vatApplicability)} /{" "}
                  {formatTokenLabel(taxCorrectionPreview.vatTreatment)}
                </p>
                <p className="mt-1 text-muted-foreground">
                  Taxable base {formatAmount(taxCorrectionPreview.engineResult.taxableBase)}{" "}
                  {taxCorrectionPreview.engineResult.currency}, VAT{" "}
                  {formatAmount(taxCorrectionPreview.engineResult.vatAmount)}{" "}
                  {taxCorrectionPreview.engineResult.currency}, total{" "}
                  {formatAmount(taxCorrectionPreview.engineResult.totalAmount)}{" "}
                  {taxCorrectionPreview.engineResult.currency}
                </p>
              </div>

              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => setIsTaxCorrectionDialogOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  onClick={() =>
                    reviewTaxDeterminationMutation.mutate({
                      suggestionId: taxDetermination.id,
                      status: "CORRECTED",
                      correctedValue: taxCorrectionPreview,
                      notes: taxCorrectionNotes || undefined,
                    })
                  }
                  disabled={reviewTaxDeterminationMutation.isPending}
                >
                  Save Correction
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={isProposalCorrectionDialogOpen}
        onOpenChange={(open) => {
          setIsProposalCorrectionDialogOpen(open);
          if (!open) {
            setProposalCorrectionDraft(null);
            setProposalCorrectionNotes("");
          }
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>Modify Accounting Entry Proposal</DialogTitle>
          </DialogHeader>
          {proposalCorrectionDraft && entryProposal && proposalCorrectionPreview && (
            <div className="space-y-4 py-2">
              <p className="text-sm text-muted-foreground">
                Adjust the proposed journal entry before approval when account selection, labels,
                or amounts need human correction.
              </p>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Suggestion Title</Label>
                  <Input
                    value={proposalCorrectionDraft.description}
                    onChange={(event) =>
                      setProposalCorrectionDraft((currentDraft) =>
                        currentDraft
                          ? { ...currentDraft, description: event.target.value }
                          : currentDraft
                      )
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Entry Date</Label>
                  <Input
                    type="date"
                    value={proposalCorrectionDraft.proposedEntry.entryDate}
                    onChange={(event) =>
                      setProposalCorrectionDraft((currentDraft) =>
                        currentDraft
                          ? {
                              ...currentDraft,
                              proposedEntry: {
                                ...currentDraft.proposedEntry,
                                entryDate: event.target.value,
                              },
                            }
                          : currentDraft
                      )
                    }
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>Reason</Label>
                  <Textarea
                    rows={3}
                    value={proposalCorrectionDraft.reason}
                    onChange={(event) =>
                      setProposalCorrectionDraft((currentDraft) =>
                        currentDraft
                          ? { ...currentDraft, reason: event.target.value }
                          : currentDraft
                      )
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Journal Code</Label>
                  <Input
                    value={proposalCorrectionDraft.proposedEntry.journalCode}
                    onChange={(event) =>
                      setProposalCorrectionDraft((currentDraft) =>
                        currentDraft
                          ? {
                              ...currentDraft,
                              proposedEntry: {
                                ...currentDraft.proposedEntry,
                                journalCode: event.target.value,
                              },
                            }
                          : currentDraft
                      )
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Journal Label</Label>
                  <Input
                    value={proposalCorrectionDraft.proposedEntry.journalLabel}
                    onChange={(event) =>
                      setProposalCorrectionDraft((currentDraft) =>
                        currentDraft
                          ? {
                              ...currentDraft,
                              proposedEntry: {
                                ...currentDraft.proposedEntry,
                                journalLabel: event.target.value,
                              },
                            }
                          : currentDraft
                      )
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Reference</Label>
                  <Input
                    value={proposalCorrectionDraft.proposedEntry.reference ?? ""}
                    onChange={(event) =>
                      setProposalCorrectionDraft((currentDraft) =>
                        currentDraft
                          ? {
                              ...currentDraft,
                              proposedEntry: {
                                ...currentDraft.proposedEntry,
                                reference: event.target.value,
                              },
                            }
                          : currentDraft
                      )
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Entry Description</Label>
                  <Input
                    value={proposalCorrectionDraft.proposedEntry.description}
                    onChange={(event) =>
                      setProposalCorrectionDraft((currentDraft) =>
                        currentDraft
                          ? {
                              ...currentDraft,
                              proposedEntry: {
                                ...currentDraft.proposedEntry,
                                description: event.target.value,
                              },
                            }
                          : currentDraft
                      )
                    }
                  />
                </div>
              </div>

              <div className="rounded-md border overflow-hidden">
                <div className="flex items-center justify-between bg-muted/40 px-3 py-2">
                  <div className="text-xs font-medium uppercase text-muted-foreground">
                    Proposal Lines
                  </div>
                  <Button size="sm" variant="outline" onClick={addProposalDraftLine}>
                    Add Line
                  </Button>
                </div>
                <div className="space-y-3 p-3">
                  {proposalCorrectionDraft.proposedEntry.lines.map((line, index) => (
                    <div key={`proposal-line-edit-${index}`} className="rounded-md border p-3">
                      <div className="mb-3 flex items-center justify-between">
                        <div className="text-sm font-medium">Line {index + 1}</div>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => removeProposalDraftLine(index)}
                          disabled={proposalCorrectionDraft.proposedEntry.lines.length <= 2}
                        >
                          Remove
                        </Button>
                      </div>
                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="space-y-2">
                          <Label>Account Code</Label>
                          <Input
                            value={line.accountCode}
                            onChange={(event) =>
                              updateProposalDraftLine(index, {
                                accountCode: event.target.value,
                              })
                            }
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Account Label</Label>
                          <Input
                            value={line.accountLabel}
                            onChange={(event) =>
                              updateProposalDraftLine(index, {
                                accountLabel: event.target.value,
                              })
                            }
                          />
                        </div>
                        <div className="space-y-2 md:col-span-2">
                          <Label>Line Label</Label>
                          <Input
                            value={line.label}
                            onChange={(event) =>
                              updateProposalDraftLine(index, {
                                label: event.target.value,
                              })
                            }
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Debit</Label>
                          <Input
                            type="number"
                            step="0.01"
                            value={line.debit}
                            onChange={(event) =>
                              updateProposalDraftLine(index, {
                                debit: parseNumberInput(event.target.value),
                              })
                            }
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Credit</Label>
                          <Input
                            type="number"
                            step="0.01"
                            value={line.credit}
                            onChange={(event) =>
                              updateProposalDraftLine(index, {
                                credit: parseNumberInput(event.target.value),
                              })
                            }
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Warnings</Label>
                  <Textarea
                    rows={4}
                    value={toMultilineValue(proposalCorrectionDraft.warnings)}
                    onChange={(event) =>
                      setProposalCorrectionDraft((currentDraft) =>
                        currentDraft
                          ? {
                              ...currentDraft,
                              warnings: parseMultilineValue(event.target.value),
                            }
                          : currentDraft
                      )
                    }
                    placeholder="One warning per line"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Correction Notes</Label>
                  <Textarea
                    rows={4}
                    value={proposalCorrectionNotes}
                    onChange={(event) =>
                      setProposalCorrectionNotes(event.target.value)
                    }
                    placeholder="Explain why this proposal was modified"
                  />
                </div>
              </div>

              <div className="rounded-md border bg-muted/20 p-3 text-sm">
                <div className="font-medium">Preview</div>
                <p className="mt-1 text-muted-foreground">
                  {proposalCorrectionPreview.proposedEntry.journalCode} -{" "}
                  {proposalCorrectionPreview.proposedEntry.journalLabel}
                </p>
                <p className="mt-1 text-muted-foreground">
                  Total debit {formatAmount(proposalCorrectionPreview.proposedEntry.totalDebit)} /
                  total credit {formatAmount(proposalCorrectionPreview.proposedEntry.totalCredit)}{" "}
                  -{" "}
                  {proposalCorrectionPreview.proposedEntry.isBalanced
                    ? "balanced"
                    : "not balanced"}
                </p>
              </div>

              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => setIsProposalCorrectionDialogOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  onClick={() =>
                    reviewProposalMutation.mutate({
                      suggestionId: entryProposal.id,
                      status: "CORRECTED",
                      correctedValue: proposalCorrectionPreview,
                      notes: proposalCorrectionNotes || undefined,
                    })
                  }
                  disabled={reviewProposalMutation.isPending}
                >
                  Save Correction
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={isApproveDialogOpen} onOpenChange={setIsApproveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve Document</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Approving the document confirms that every current suggestion has a human
              decision and the final reviewed values can be used downstream.
            </p>
            <Textarea
              placeholder="Optional approval notes"
              value={approveNotes}
              onChange={(event) => setApproveNotes(event.target.value)}
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIsApproveDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => approveMutation.mutate(approveNotes)}
                disabled={approveMutation.isPending || pendingCount > 0}
              >
                Confirm Approval
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
