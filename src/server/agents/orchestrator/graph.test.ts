import { test, describe } from "vitest";
import assert from "node:assert/strict";
import type { DocumentExtractionOutput } from "../schemas";
import { formatPrompt } from "../prompts";
import { AgentType } from "../types";
import {
  hasUsableFinancialTables,
  isFinancialStatementCandidate,
  mergeDocumentExtractionOutputs,
  runDocumentProcessorReliabilityPolicy,
} from "./graph";

function field(value: unknown, confidence = 0.9) {
  return { value, confidence };
}

function createOutput(
  overrides: Partial<DocumentExtractionOutput> = {}
): DocumentExtractionOutput {
  return {
    document_type: "other",
    document_confidence: 0.9,
    fields: {},
    line_items: [],
    financial_tables: [],
    warnings: [],
    ...overrides,
  };
}

describe("graph", () => {
  const tests: Array<{ name: string; run: () => void | Promise<void> }> = [
  {
    name: "formatPrompt expands dotted instruction placeholders",
    run: () => {
      const prompt = formatPrompt(
        AgentType.CLOSING_REPORTING,
        {
          tenant: {
            company: {
              name: "AtlasCompta",
              chartType: "NORMAL",
              currency: "MAD",
            },
            fiscalYear: {
              label: "FY 2025",
              startDate: "2025-01-01",
              endDate: "2025-12-31",
            },
          },
          jurisdiction: {
            regime: "DEBIT",
          },
          patterns: {
            averageMonthlyRevenue: 120000,
          },
        },
        "Prepare the close",
        {
          fiscalYear: {
            label: "FY 2025",
          },
          governanceConstraint: "Human approval required",
        }
      );

      assert.match(prompt, /"FY 2025"/);
      assert.match(prompt, /Human approval required/);
      assert.doesNotMatch(prompt, /\{inputData\.fiscalYear\}/);
    },
  },
  {
    name: "formatPrompt resolves tenant company fields for document processor context",
    run: () => {
      const prompt = formatPrompt(
        AgentType.DOCUMENT_PROCESSOR,
        {
          tenant: {
            company: {
              name: "AtlasCompta",
              currency: "MAD",
            },
          },
        },
        "Extract the document",
        {
          documentId: "doc_123",
          mimeType: "application/pdf",
        }
      );

      assert.match(prompt, /AtlasCompta/);
      assert.match(prompt, /MAD/);
      assert.doesNotMatch(prompt, /\{company\.name\}/);
    },
  },
  {
    name: "financial-statement candidate detection uses document type cues",
    run: () => {
      const output = createOutput({ document_type: "liasse_fiscale" });
      assert.equal(isFinancialStatementCandidate(output), true);
    },
  },
  {
    name: "financial-statement candidate detection uses field and warning cues",
    run: () => {
      const fromField = createOutput({
        fields: {
          statement_title: field("Compte de Produits et Charges"),
        },
      });
      const fromWarning = createOutput({
        warnings: ["Bilan passif partially unreadable on page 2"],
      });

      assert.equal(isFinancialStatementCandidate(fromField), true);
      assert.equal(isFinancialStatementCandidate(fromWarning), true);
    },
  },
  {
    name: "usable financial tables require a non-null extracted cell value",
    run: () => {
      const labelOnly = createOutput({
        financial_tables: [
          {
            table_code: "CPC",
            table_name: "Compte de Produits et Charges",
            rows: [
              {
                row_code: "ca",
                label: "Chiffre d'affaires",
                columns: {
                  MONTANT: field(null),
                },
              },
            ],
          },
        ],
      });
      const zeroValue = createOutput({
        financial_tables: [
          {
            table_code: "CPC",
            table_name: "Compte de Produits et Charges",
            rows: [
              {
                row_code: "ca",
                label: "Chiffre d'affaires",
                columns: {
                  MONTANT: field(0),
                },
              },
            ],
          },
        ],
      });

      assert.equal(hasUsableFinancialTables(labelOnly), false);
      assert.equal(hasUsableFinancialTables(zeroValue), true);
    },
  },
  {
    name: "financial table merge normalizes table, row, and column identifiers",
    run: () => {
      const merged = mergeDocumentExtractionOutputs([
        createOutput({
          document_type: "etat_de_synthese",
          financial_tables: [
            {
              table_code: "unknown_table",
              table_name: "Bilan Actif",
              rows: [
                {
                  row_code: "unknown_row",
                  label: "Total Actif",
                  columns: {
                    MONTANT: field(1000, 0.8),
                  },
                },
              ],
            },
          ],
        }),
        createOutput({
          document_type: "etat_de_synthese",
          financial_tables: [
            {
              table_code: "BILAN_ACTIF",
              table_name: "Bilan Actif",
              rows: [
                {
                  row_code: "TOTAL_ACTIF",
                  label: "Total Actif",
                  columns: {
                    " montant ": field(1200, 0.95),
                  },
                },
              ],
            },
          ],
        }),
      ]);

      assert.equal(merged.financial_tables.length, 1);
      assert.equal(merged.financial_tables[0]!.table_code, "BILAN_ACTIF");
      assert.equal(merged.financial_tables[0]!.rows.length, 1);
      assert.equal(merged.financial_tables[0]!.rows[0]!.row_code, "TOTAL_ACTIF");
      assert.deepEqual(Object.keys(merged.financial_tables[0]!.rows[0]!.columns), ["MONTANT"]);
      assert.equal(merged.financial_tables[0]!.rows[0]!.columns.MONTANT!.value, 1200);
    },
  },
  {
    name: "reliability policy keeps first successful financial extraction without retry",
    run: async () => {
      const calls: boolean[] = [];
      const result = await runDocumentProcessorReliabilityPolicy(async (options) => {
        calls.push(Boolean(options.strictFinancialTableRetry));
        return {
          iterations: 1,
          rawOutput: '{"pass":"initial"}',
          output: createOutput({
            document_type: "etat_de_synthese",
            financial_tables: [
              {
                table_code: "CPC",
                table_name: "Compte de Produits et Charges",
                rows: [
                  {
                    row_code: "CA",
                    label: "Chiffre d'affaires",
                    columns: {
                      MONTANT: field(1500),
                    },
                  },
                ],
              },
            ],
          }),
        };
      });

      assert.deepEqual(calls, [false]);
      assert.equal(result.error, undefined);
      assert.equal(result.confidence?.toNumber(), 0.9);
    },
  },
  {
    name: "reliability policy retries candidate financial statements with unusable tables",
    run: async () => {
      const calls: boolean[] = [];
      const result = await runDocumentProcessorReliabilityPolicy(async (options) => {
        calls.push(Boolean(options.strictFinancialTableRetry));

        if (!options.strictFinancialTableRetry) {
          return {
            iterations: 1,
            rawOutput: '{"pass":"initial"}',
            output: createOutput({
              document_type: "etat_de_synthese",
              financial_tables: [
                {
                  table_code: "CPC",
                  table_name: "Compte de Produits et Charges",
                  rows: [
                    {
                      row_code: "CA",
                      label: "Chiffre d'affaires",
                      columns: {
                        MONTANT: field(null),
                      },
                    },
                  ],
                },
              ],
            }),
          };
        }

        return {
          iterations: 1,
          rawOutput: '{"pass":"retry"}',
          output: createOutput({
            document_type: "etat_de_synthese",
            financial_tables: [
              {
                table_code: "CPC",
                table_name: "Compte de Produits et Charges",
                rows: [
                  {
                    row_code: "CA",
                    label: "Chiffre d'affaires",
                    columns: {
                      MONTANT: field(2200),
                    },
                  },
                ],
              },
            ],
          }),
        };
      });

      assert.deepEqual(calls, [false, true]);
      assert.equal(result.error, undefined);
      assert.equal(
        (result.output as DocumentExtractionOutput).financial_tables[0]!.rows[0]!.columns.MONTANT!
          .value,
        2200
      );
    },
  },
  {
    name: "reliability policy fails when retry still has no usable financial tables",
    run: async () => {
      const calls: boolean[] = [];
      const result = await runDocumentProcessorReliabilityPolicy(async (options) => {
        calls.push(Boolean(options.strictFinancialTableRetry));
        return {
          iterations: 1,
          rawOutput: options.strictFinancialTableRetry ? '{"pass":"retry"}' : '{"pass":"initial"}',
          output: createOutput({
            document_type: "etat_de_synthese",
            financial_tables: [
              {
                table_code: "CPC",
                table_name: "Compte de Produits et Charges",
                rows: [
                  {
                    row_code: "CA",
                    label: "Chiffre d'affaires",
                    columns: {
                      MONTANT: field(null),
                    },
                  },
                ],
              },
            ],
          }),
        };
      });

      assert.deepEqual(calls, [false, true]);
      assert.equal(
        result.error,
        "Financial statement detected but no usable financial tables were extracted after retry."
      );
    },
  },
  {
    name: "reliability policy leaves non-financial documents on the existing success path",
    run: async () => {
      const calls: boolean[] = [];
      const result = await runDocumentProcessorReliabilityPolicy(async (options) => {
        calls.push(Boolean(options.strictFinancialTableRetry));
        return {
          iterations: 1,
          rawOutput: '{"pass":"initial"}',
          output: createOutput({
            document_type: "invoice",
            fields: {
              supplier_name: field("Atlas Fournitures"),
            },
          }),
        };
      });

      assert.deepEqual(calls, [false]);
      assert.equal(result.error, undefined);
      assert.equal((result.output as DocumentExtractionOutput).document_type, "invoice");
    },
  },
];


  for (const t of tests) {
    test(t.name, async () => {
      await t.run();
    });
  }
});
