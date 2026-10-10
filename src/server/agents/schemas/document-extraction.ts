import { z } from "zod";

const fieldWithConfidence = z.object({
  value: z.unknown().nullable(),
  confidence: z.number().min(0).max(1),
});

const financialTableRowSchema = z.object({
  row_code: z.string(),
  label: z.string().nullish(),
  columns: z.record(z.string(), fieldWithConfidence),
});

const financialTableSchema = z.object({
  table_code: z.string(),
  table_name: z.string().nullish(),
  rows: z.array(financialTableRowSchema),
});

export const documentExtractionOutputPromptSchema = z.object({
  document_type: z.string(),
  document_confidence: z.number().min(0).max(1),
  fields: z.record(z.string(), fieldWithConfidence),
  line_items: z.array(z.record(z.string(), fieldWithConfidence)).optional().default([]),
  financial_tables: z.array(financialTableSchema).optional().default([]),
  warnings: z.array(z.string()).optional().default([]),
});

export const documentExtractionOutputSchema = documentExtractionOutputPromptSchema.transform(
  (output) => ({
    ...output,
    financial_tables: output.financial_tables.map((table) => ({
      ...table,
      table_name:
        typeof table.table_name === "string" && table.table_name.trim().length > 0
          ? table.table_name
          : table.table_code,
      rows: table.rows.map((row) => ({
        ...row,
        label:
          typeof row.label === "string" && row.label.trim().length > 0
            ? row.label
            : row.row_code,
      })),
    })),
  })
);

export const documentExtractionInputSchema = z.object({
  userPrompt: z.string(),
  documentId: z.string(),
  mimeType: z.string(),
  imageMimeType: z.string().optional(),
  imageBase64: z.string().optional(),
  imageBase64Pages: z.array(z.string()).optional(),
});

export type DocumentExtractionOutput = z.infer<typeof documentExtractionOutputSchema>;
export type DocumentExtractionInput = z.infer<typeof documentExtractionInputSchema>;
