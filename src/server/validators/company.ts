import { z } from "zod";

export const createCompanySchema = z.object({
  name: z.string().min(1, "Company name is required").max(255),
  legalForm: z.string().max(100).nullish(),
  address: z.string().max(500).nullish(),
  city: z.string().max(100).nullish(),
  phone: z.string().max(50).nullish(),
  email: z.string().email("Invalid email").nullish(),
  ice: z.string().max(50).nullish(),
  rc: z.string().max(50).nullish(),
  patente: z.string().max(50).nullish(),
  cnss: z.string().max(50).nullish(),
  ifNumber: z.string().max(50).nullish(),
  chartType: z.enum(["NORMAL", "SIMPLIFIED"]).default("NORMAL"),
  currency: z.string().length(3, "Currency must be a 3-letter code").default("MAD"),
});

export const updateCompanySchema = createCompanySchema.partial().extend({
  isActive: z.boolean().optional(),
});

export type CreateCompanyInput = z.infer<typeof createCompanySchema>;
export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>;
