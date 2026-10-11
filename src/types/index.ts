import { UserRole } from "@prisma/client";

declare module "next-auth" {
  interface User {
    role?: UserRole;
    organizationId?: string;
  }

  interface Session {
    user: {
      id: string;
      email: string;
      name: string;
      role: UserRole;
      organizationId: string;
      jti?: string;
    };
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    id?: string;
    role?: UserRole;
    organizationId?: string;
    jti?: string;
    iat?: number;
  }
}

export interface CompanySummary {
  id: string;
  name: string;
  legalForm: string | null;
}

export interface FiscalYearSummary {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
  status: string;
  isDefault: boolean;
}

export interface AppContextType {
  currentCompanyId: string | null;
  currentFiscalYearId: string | null;
  setCompany: (id: string) => void;
  setFiscalYear: (id: string) => void;
  refreshFiscalYears: (preferredFiscalYearId?: string) => Promise<void>;
  companies: CompanySummary[];
  fiscalYears: FiscalYearSummary[];
  isLoading: boolean;
}
