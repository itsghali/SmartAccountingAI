import { describe, it, expect } from "vitest";
import { computeDocumentTaxDetermination } from "./document-tax";
import type { TaxSupportSuggestion } from "@/server/agents/schemas";

describe("Document Tax Calculations", () => {
  const defaultContext = { currency: "MAD", regime: "DEBIT" as const };
  
  it("computes explicit standard VAT correctly", () => {
    const document = {
      documentType: "invoice",
      fields: {
        total_ht: "1000",
        vat_amount: "200",
        total_ttc: "1200"
      },
      lineItems: [],
      warnings: []
    };
    
    const suggestion: TaxSupportSuggestion = {
      type: "DOCUMENT_TAX_CLASSIFICATION",
      description: "Test description",
      category: "PURCHASE_GOODS",
      vatApplicability: "INPUT_VAT_RECOVERABLE",
      vatTreatment: "STANDARD_20",
      confidence: 0.9,
      reason: "Test",
      supportingFields: []
    };

    const result = computeDocumentTaxDetermination(document, suggestion, defaultContext);
    
    expect(result.taxableBase).toBe(1000);
    expect(result.vatAmount).toBe(200);
    expect(result.totalAmount).toBe(1200);
    expect(result.deductibleVATAmount).toBe(200);
    expect(result.collectedVATAmount).toBe(0);
    expect(result.computationBasis).toBe("MIXED");
  });

  it("infers VAT from suggested treatment when fields are missing", () => {
    const document = {
      documentType: "invoice",
      fields: {
        total_ht: "1000",
      },
      lineItems: [],
      warnings: []
    };
    
    const suggestion: TaxSupportSuggestion = {
      type: "DOCUMENT_TAX_CLASSIFICATION",
      description: "Test description",
      category: "SALE_SERVICE",
      vatApplicability: "OUTPUT_VAT_COLLECTED",
      vatTreatment: "STANDARD_20",
      confidence: 0.9,
      reason: "Test",
      supportingFields: []
    };

    const result = computeDocumentTaxDetermination(document, suggestion, defaultContext);
    
    expect(result.taxableBase).toBe(1000);
    expect(result.vatAmount).toBe(200); // 20% of 1000
    expect(result.totalAmount).toBe(1200);
    expect(result.deductibleVATAmount).toBe(0);
    expect(result.collectedVATAmount).toBe(200);
    expect(result.computationBasis).toBe("SUGGESTED_TREATMENT");
  });
});
