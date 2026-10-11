import { Prisma } from "@prisma/client";
import { prisma } from "@/server/prisma";
import { agentRunner } from "@/server/agents";
import { readPrivateFile } from "@/server/storage";
import {
  isSuggestionStorageUnavailableError,
  persistDocumentSuggestions,
} from "@/server/suggestions/service";
import { extractDocumentWithOCR } from "@/server/ocr-client";

interface ModelConfig {
  provider: "openrouter" | "groq" | "openai" | "ollama";
  model: string;
  temperature: number;
  maxTokens: number;
}

async function persistLegacyDocumentFields(
  documentId: string,
  extractionRunId: string,
  output: Record<string, unknown>
) {
  const fields = output.fields as Record<string, unknown> | undefined;
  const lineItems = output.line_items as Array<Record<string, unknown>> | undefined;
  const financialTables = output.financial_tables as Array<Record<string, unknown>> | undefined;
  const warnings = output.warnings as string[] | undefined;

  if (fields) {
    for (const [fieldName, fieldData] of Object.entries(fields)) {
      const typedField = fieldData as { value?: unknown; confidence?: number } | null;
      await prisma.extractedField.create({
        data: {
          documentId,
          extractionRunId,
          fieldName: `fields.${fieldName}`,
          fieldValue: (typedField?.value ?? null) as Prisma.InputJsonValue,
          confidenceScore: typedField?.confidence ?? null,
          reviewStatus: "PENDING",
        },
      });
    }
  }

  if (lineItems) {
    for (let index = 0; index < lineItems.length; index += 1) {
      for (const [fieldName, fieldData] of Object.entries(lineItems[index]!)) {
        const typedField = fieldData as { value?: unknown; confidence?: number } | null;
        await prisma.extractedField.create({
          data: {
            documentId,
            extractionRunId,
            fieldName: `line_items[${index}].${fieldName}`,
            fieldValue: (typedField?.value ?? null) as Prisma.InputJsonValue,
            confidenceScore: typedField?.confidence ?? null,
            reviewStatus: "PENDING",
          },
        });
      }
    }
  }

  if (financialTables && Array.isArray(financialTables)) {
    for (const table of financialTables) {
      const tableCode = (table.table_code as string) ?? "UNKNOWN";
      const tableName = (table.table_name as string) ?? tableCode;
      const rows = table.rows as Array<Record<string, unknown>> | undefined;

      // Persist table name as a field for display purposes
      await prisma.extractedField.create({
        data: {
          documentId,
          extractionRunId,
          fieldName: `financial_tables.${tableCode}._table_name`,
          fieldValue: tableName as Prisma.InputJsonValue,
          confidenceScore: null,
          reviewStatus: "REVIEWED",
        },
      });

      if (rows && Array.isArray(rows)) {
        for (const row of rows) {
          const rowCode = (row.row_code as string) ?? "UNKNOWN";
          const rowLabel = (row.label as string) ?? rowCode;
          const columns = row.columns as Record<string, unknown> | undefined;

          // Persist row label as a field for display purposes
          await prisma.extractedField.create({
            data: {
              documentId,
              extractionRunId,
              fieldName: `financial_tables.${tableCode}.${rowCode}._label`,
              fieldValue: rowLabel as Prisma.InputJsonValue,
              confidenceScore: null,
              reviewStatus: "REVIEWED",
            },
          });

          if (columns) {
            for (const [colName, colData] of Object.entries(columns)) {
              const typedCol = colData as { value?: unknown; confidence?: number } | null;
              await prisma.extractedField.create({
                data: {
                  documentId,
                  extractionRunId,
                  fieldName: `financial_tables.${tableCode}.${rowCode}.${colName}`,
                  fieldValue: (typedCol?.value ?? null) as Prisma.InputJsonValue,
                  confidenceScore: typedCol?.confidence ?? null,
                  reviewStatus: "PENDING",
                },
              });
            }
          }
        }
      }
    }
  }

  await prisma.extractedField.create({
    data: {
      documentId,
      extractionRunId,
      fieldName: "document_type",
      fieldValue: (output.document_type ?? null) as Prisma.InputJsonValue,
      confidenceScore: (output.document_confidence as number) ?? null,
      reviewStatus: "PENDING",
    },
  });

  if (warnings && warnings.length > 0) {
    await prisma.extractedField.create({
      data: {
        documentId,
        extractionRunId,
        fieldName: "warnings",
        fieldValue: warnings as Prisma.InputJsonValue,
        confidenceScore: null,
        reviewStatus: "REVIEWED",
      },
    });
  }
}

const DOCUMENT_PROCESSING_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes max

function withTimeout<T>(promise: Promise<T>, ms: number, errorMessage: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(errorMessage)), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer));
}

export async function processDocument(
  documentId: string,
  runId: string,
  tenantId: string,
  userId: string,
  mimeType: string,
  modelConfig: ModelConfig
) {
  try {
    await prisma.documentExtractionRun.update({
      where: { id: runId },
      data: { status: "RUNNING", startedAt: new Date() },
    });

    await withTimeout(
      (async () => {
        const doc = await prisma.document.findUnique({
          where: { id: documentId },
          select: { storagePath: true },
        });
        if (!doc) {
          throw new Error(`Document ${documentId} not found`);
        }

        const fileBytes = await readPrivateFile(doc.storagePath);
        
        // Call the new FastAPI OCR worker
        const ocrResult = await extractDocumentWithOCR(fileBytes, "document");

        let extractedText = "";
        if (ocrResult) {
          if (typeof ocrResult.raw_text === "string") {
            // FastAPI OCR service returns { raw_text, pages }
            extractedText = ocrResult.raw_text;
          } else if (ocrResult.pages && Array.isArray(ocrResult.pages)) {
            // Legacy nested format: pages[].blocks[].lines[].words[]
            for (const page of ocrResult.pages) {
              if (!page.blocks) continue;
              for (const block of page.blocks) {
                if (!block.lines) continue;
                for (const line of block.lines) {
                  if (!line.words) continue;
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  extractedText += line.words.map((w: any) => w.value).join(" ") + "\n";
                }
                extractedText += "\n";
              }
            }
          }
        }

        const result = await agentRunner.run(tenantId, userId, {
          agentType: "DOCUMENT_PROCESSOR",
          userPrompt:
            "Look at this extracted OCR text and intelligently extract everything. First, identify what type of document it is (invoice, receipt, bank statement, payslip, utility bill, liasse fiscale, état de synthèse, etc.). Then extract every visible field you can read, using descriptive snake_case keys that match what the document actually contains. For each field, return { value, confidence }. If the document contains a table (line items, transactions, etc.), extract every row into line_items. If the document is a liasse fiscale or état de synthèse, you MUST extract all financial tables into the financial_tables array with every row, label, and amount. For financial statements, the numeric table cells are the primary target: do not return empty template rows when values are visible, and never replace unreadable numbers with 0 unless the source actually shows 0. Do not force invoice-specific fields onto non-invoice documents — adapt to what you actually see.",
          inputData: {
            documentId,
            mimeType,
            ocrText: extractedText,
            imageBase64: fileBytes.toString("base64"),
            imageMimeType: mimeType,
          },
          modelConfig,
        });

        if (!result.success || !result.output) {
          await prisma.documentExtractionRun.update({
            where: { id: runId },
            data: {
              status: "FAILED",
              errorMessage: result.error || "Extraction failed",
              completedAt: new Date(),
            },
          });

          await prisma.document.update({
            where: { id: documentId },
            data: { status: "FAILED" },
          });

          return;
        }

        const output = result.output as Record<string, unknown>;
        const warnings = output.warnings as string[] | undefined;

        await prisma.documentExtractionRun.update({
          where: { id: runId },
          data: {
            status: "COMPLETED",
            rawOutputJson: output as Prisma.InputJsonValue,
            completedAt: new Date(),
          },
        });

        try {
          await persistDocumentSuggestions({
            companyId: tenantId,
            documentId,
            extractionRunId: runId,
            agentRunId: result.runId,
            output,
          });
        } catch (error) {
          if (!isSuggestionStorageUnavailableError(error)) {
            throw error;
          }

          console.warn(
            "[DocumentProcessor] Suggestion storage unavailable, falling back to legacy extracted fields only."
          );
          await persistLegacyDocumentFields(documentId, runId, output);
        }

        await prisma.document.update({
          where: { id: documentId },
          data: {
            status: "REVIEW_REQUIRED",
            documentType:
              typeof output.document_type === "string" ? output.document_type : null,
          },
        });

        await prisma.auditLog.create({
          data: {
            userId,
            companyId: tenantId,
            action: "DOCUMENT_PROCESSED",
            entityType: "Document",
            entityId: documentId,
            details: {
              runId,
              documentConfidence: output.document_confidence as number | null | undefined,
              warningCount: warnings?.length ?? 0,
            },
          },
        });
      })(),
      DOCUMENT_PROCESSING_TIMEOUT_MS,
      "Document processing timed out after 5 minutes"
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    await prisma.documentExtractionRun.update({
      where: { id: runId },
      data: {
        status: "FAILED",
        errorMessage,
        completedAt: new Date(),
      },
    }).catch(() => {});

    await prisma.document.update({
      where: { id: documentId },
      data: { status: "FAILED" },
    }).catch(() => {});
  }
}
