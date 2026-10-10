import {
  DeterministicTaxResult,
  TaxSupportSuggestion,
} from "@/server/agents/schemas";

interface ReviewedDocumentData {
  documentType: string | null;
  fields: Record<string, unknown>;
  lineItems: Array<Record<string, unknown>>;
  warnings: string[];
}

interface TaxEngineContext {
  currency: string;
  regime: "ENCAISSEMENT" | "DEBIT" | null;
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

function inferLineItemsSubtotal(lineItems: Array<Record<string, unknown>>) {
  const total = lineItems.reduce((sum, item) => {
    const lineTotal = firstNumber([
      item.line_total,
      item.total,
      item.amount,
      item.net_amount,
      item.taxable_amount,
    ]);

    return sum + (lineTotal ?? 0);
  }, 0);

  return total > 0 ? total : null;
}

function rateFromTreatment(treatment: TaxSupportSuggestion["vatTreatment"]) {
  switch (treatment) {
    case "STANDARD_20":
      return 20;
    case "REDUCED_14":
      return 14;
    case "REDUCED_10":
      return 10;
    case "REDUCED_7":
      return 7;
    default:
      return 0;
  }
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

export function computeDocumentTaxDetermination(
  document: ReviewedDocumentData,
  suggestion: TaxSupportSuggestion,
  context: TaxEngineContext
): DeterministicTaxResult {
  const fields = document.fields;
  const explicitSubtotal =
    firstNumber([
      fields.subtotal,
      fields.total_ht,
      fields.amount_excluding_tax,
      fields.net_amount,
      fields.taxable_amount,
    ]) ?? inferLineItemsSubtotal(document.lineItems);
  const explicitTotal = firstNumber([
    fields.total_amount,
    fields.grand_total,
    fields.amount_due,
    fields.total_ttc,
    fields.total,
  ]);
  const explicitVATAmount = firstNumber([
    fields.vat_amount,
    fields.tax_amount,
    fields.tva_amount,
  ]);
  const explicitVATRate = firstNumber([
    fields.vat_rate,
    fields.tax_rate,
    fields.tva_rate,
  ]);

  const engineNotes: string[] = [];
  const edgeCases = [
    ...(document.warnings ?? []),
    ...(suggestion.edgeCases ?? []),
    ...(suggestion.warnings ?? []),
  ];

  let vatRatePercent = explicitVATRate ?? rateFromTreatment(suggestion.vatTreatment);
  let taxableBase = explicitSubtotal ?? 0;
  let vatAmount = explicitVATAmount ?? 0;
  let totalAmount = explicitTotal ?? 0;
  let computationBasis: DeterministicTaxResult["computationBasis"] = "UNDETERMINED";

  const zeroVatTreatment =
    suggestion.vatTreatment === "EXEMPT" ||
    suggestion.vatTreatment === "OUT_OF_SCOPE" ||
    suggestion.vatTreatment === "ZERO_RATED";
  const reverseChargeTreatment = suggestion.vatTreatment === "REVERSE_CHARGE";

  if (zeroVatTreatment) {
    vatRatePercent = 0;
    vatAmount = 0;
    if (taxableBase === 0 && explicitTotal !== null) {
      taxableBase = explicitTotal;
    }
    if (totalAmount === 0) {
      totalAmount = taxableBase;
    }
    computationBasis = explicitTotal !== null || explicitSubtotal !== null
      ? "DOCUMENT_EXPLICIT"
      : "SUGGESTED_TREATMENT";
    engineNotes.push("VAT treatment was computed as zero based on the approved tax classification.");
  } else if (reverseChargeTreatment) {
    if (explicitVATAmount !== null || explicitSubtotal !== null || explicitTotal !== null) {
      if (explicitSubtotal !== null) {
        taxableBase = explicitSubtotal;
      } else if (explicitTotal !== null && explicitVATAmount !== null) {
        taxableBase = round2(Math.max(explicitTotal - explicitVATAmount, 0));
      } else if (explicitTotal !== null) {
        taxableBase = explicitTotal;
      }
      vatAmount = explicitVATAmount ?? 0;
      totalAmount = explicitTotal ?? round2(taxableBase + vatAmount);
      computationBasis = explicitVATAmount !== null ? "DOCUMENT_EXPLICIT" : "MIXED";
    }

    edgeCases.push("Reverse-charge treatment needs explicit human confirmation for final filing treatment.");
    engineNotes.push("Reverse-charge scenarios are computed conservatively and require review.");
  } else {
    if (explicitVATAmount !== null && explicitSubtotal !== null) {
      taxableBase = explicitSubtotal;
      vatAmount = explicitVATAmount;
      totalAmount = explicitTotal ?? round2(taxableBase + vatAmount);
      computationBasis = explicitVATRate !== null ? "DOCUMENT_EXPLICIT" : "MIXED";
    } else if (explicitVATAmount !== null && explicitTotal !== null) {
      totalAmount = explicitTotal;
      vatAmount = explicitVATAmount;
      taxableBase = round2(Math.max(totalAmount - vatAmount, 0));
      computationBasis = explicitVATRate !== null ? "DOCUMENT_EXPLICIT" : "MIXED";
    } else if (vatRatePercent > 0 && explicitSubtotal !== null) {
      taxableBase = explicitSubtotal;
      vatAmount = round2((taxableBase * vatRatePercent) / 100);
      totalAmount = explicitTotal ?? round2(taxableBase + vatAmount);
      computationBasis = explicitVATRate !== null ? "DOCUMENT_EXPLICIT" : "SUGGESTED_TREATMENT";
    } else if (vatRatePercent > 0 && explicitTotal !== null) {
      totalAmount = explicitTotal;
      taxableBase = round2(totalAmount / (1 + vatRatePercent / 100));
      vatAmount = round2(totalAmount - taxableBase);
      computationBasis = explicitVATRate !== null ? "DOCUMENT_EXPLICIT" : "SUGGESTED_TREATMENT";
    }

    if (explicitVATAmount !== null && explicitVATRate !== null && taxableBase > 0) {
      const expectedVAT = round2((taxableBase * explicitVATRate) / 100);
      if (Math.abs(expectedVAT - explicitVATAmount) > 1) {
        edgeCases.push(
          `Document VAT amount (${round2(explicitVATAmount)}) does not reconcile cleanly with the explicit rate (${explicitVATRate}%).`
        );
      }
    }
  }

  if (
    taxableBase <= 0 &&
    totalAmount <= 0 &&
    suggestion.vatApplicability !== "VAT_OUT_OF_SCOPE"
  ) {
    edgeCases.push("The reviewed document does not expose enough numeric data to compute a reliable tax result.");
  }

  if (context.regime === "ENCAISSEMENT") {
    const normalizedType = normalizeText(document.documentType ?? "");
    if (normalizedType.includes("invoice") || normalizedType.includes("receipt")) {
      edgeCases.push(
        "Company VAT regime is ENCAISSEMENT, so final recognition timing may depend on payment rather than invoice issue date."
      );
    }
  }

  if (suggestion.vatTreatment === "UNKNOWN") {
    edgeCases.push("VAT treatment is still uncertain and needs human confirmation.");
  }

  if (computationBasis === "UNDETERMINED") {
    engineNotes.push("The deterministic engine could not fully derive tax amounts from the approved document.");
  } else if (computationBasis === "DOCUMENT_EXPLICIT") {
    engineNotes.push("The deterministic engine used explicit reviewed document amounts.");
  } else if (computationBasis === "SUGGESTED_TREATMENT") {
    engineNotes.push("The deterministic engine used the approved tax treatment to derive VAT deterministically.");
  } else {
    engineNotes.push("The deterministic engine combined explicit document values with approved treatment hints.");
  }

  let deductibleVATAmount = 0;
  let collectedVATAmount = 0;

  if (suggestion.vatApplicability === "INPUT_VAT_RECOVERABLE") {
    deductibleVATAmount = vatAmount;
  }

  if (suggestion.vatApplicability === "OUTPUT_VAT_COLLECTED") {
    collectedVATAmount = vatAmount;
  }

  return {
    jurisdictionCode: "MA",
    regime: context.regime,
    category: suggestion.category,
    vatApplicability: suggestion.vatApplicability,
    vatTreatment: suggestion.vatTreatment,
    currency: firstString([fields.currency, context.currency]) ?? context.currency,
    taxableBase: round2(Math.max(taxableBase, 0)),
    vatRatePercent: round2(Math.max(vatRatePercent, 0)),
    vatAmount: round2(Math.max(vatAmount, 0)),
    totalAmount: round2(Math.max(totalAmount || taxableBase + vatAmount, 0)),
    deductibleVATAmount: round2(Math.max(deductibleVATAmount, 0)),
    collectedVATAmount: round2(Math.max(collectedVATAmount, 0)),
    computationBasis,
    engineNotes,
    edgeCases,
    requiresHumanReview: edgeCases.length > 0 || computationBasis === "UNDETERMINED",
  };
}
