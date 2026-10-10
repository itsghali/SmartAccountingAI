import { z } from "zod";

export const entryLineSchema = z.object({
  lineNumber: z.number().int().positive(),
  accountCode: z.string().min(1, "Le compte est requis"),
  label: z.string().min(1, "Le libellé est requis"),
  debit: z.number().min(0).default(0),
  credit: z.number().min(0).default(0),
  tiersName: z.string().optional(),
  tiersReference: z.string().optional(),
  dueDate: z.string().optional(),
});

export const createEntrySchema = z.object({
  journalId: z.string().min(1, "Le journal est requis"),
  fiscalYearId: z.string().min(1, "L'exercice est requis"),
  entryDate: z.string().min(1, "La date est requise"),
  reference: z.string().optional(),
  description: z.string().min(1, "La description est requise"),
  piece: z.string().optional(),
  origin: z.enum(["MANUAL", "IMPORT", "TEMPLATE", "AUTO"]).optional(),
  sourceModule: z.string().optional(),
  sourceId: z.string().optional(),
  lines: z.array(entryLineSchema).min(2, "Au moins 2 lignes sont requises"),
});

export const validateEntrySchema = z.object({
  id: z.string().min(1),
});

export type CreateEntryInput = z.infer<typeof createEntrySchema>;
export type EntryLineInput = z.infer<typeof entryLineSchema>;
