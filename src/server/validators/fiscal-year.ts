import { z } from "zod";

export const createFiscalYearSchema = z
  .object({
    companyId: z.string().min(1, "Company ID is required"),
    label: z.string().min(1, "Label is required").max(100),
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
    isDefault: z.boolean().default(false),
  })
  .refine(
    (data) => data.endDate > data.startDate,
    { message: "End date must be after start date", path: ["endDate"] }
  )
  .refine(
    (data) => {
      const diffMs = data.endDate.getTime() - data.startDate.getTime();
      const diffMonths = diffMs / (1000 * 60 * 60 * 24 * 30.44);
      return diffMonths <= 24;
    },
    { message: "Fiscal year cannot exceed 24 months", path: ["endDate"] }
  );

export const updateFiscalYearSchema = z.object({
  label: z.string().min(1).max(100).optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  status: z.enum(["OPEN", "PROVISIONAL_CLOSE", "CLOSED"]).optional(),
  isDefault: z.boolean().optional(),
});

export type CreateFiscalYearInput = z.infer<typeof createFiscalYearSchema>;
export type UpdateFiscalYearInput = z.infer<typeof updateFiscalYearSchema>;
