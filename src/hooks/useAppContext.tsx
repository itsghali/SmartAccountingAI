"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import type {
  AppContextType,
  CompanySummary,
  FiscalYearSummary,
} from "@/types";

const AppContext = createContext<AppContextType | undefined>(undefined);

type CompanyDetailResponse = {
  fiscalYears?: FiscalYearSummary[];
};

function getCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(
    new RegExp("(?:^|; )" + name.replace(/([.$?*|{}()[\]\\/+^])/g, "\\$1") + "=([^;]*)")
  );
  return match ? decodeURIComponent(match[1]!) : null;
}

function setCookie(name: string, value: string, days = 365) {
  const expires = new Date(Date.now() + days * 864e5).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)};expires=${expires};path=/;SameSite=Lax`;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [currentCompanyId, setCurrentCompanyId] = useState<string | null>(null);
  const [currentFiscalYearId, setCurrentFiscalYearId] = useState<string | null>(null);
  const [companies, setCompanies] = useState<CompanySummary[]>([]);
  const [fiscalYears, setFiscalYears] = useState<FiscalYearSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refreshFiscalYears = useCallback(
    async (preferredFiscalYearId?: string) => {
      if (!currentCompanyId) {
        setFiscalYears([]);
        setCurrentFiscalYearId(null);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      try {
        const res = await fetch(`/api/companies/${currentCompanyId}`);
        if (!res.ok) return;

        const data = (await res.json()) as CompanyDetailResponse;
        const mapped: FiscalYearSummary[] = (data.fiscalYears ?? []).map(
          (fy) => ({
            id: fy.id,
            label: fy.label,
            startDate: fy.startDate,
            endDate: fy.endDate,
            status: fy.status,
            isDefault: fy.isDefault,
          })
        );
        setFiscalYears(mapped);

        const savedFyId = getCookie("atlas_fiscal_year_id");
        const selectedFy =
          mapped.find((fy) => fy.id === preferredFiscalYearId) ??
          mapped.find((fy) => fy.id === savedFyId) ??
          mapped.find((fy) => fy.isDefault) ??
          mapped[0];

        setCurrentFiscalYearId(selectedFy?.id ?? null);
        if (selectedFy) {
          setCookie("atlas_fiscal_year_id", selectedFy.id);
        }
      } catch {
        setFiscalYears([]);
        setCurrentFiscalYearId(null);
      } finally {
        setIsLoading(false);
      }
    },
    [currentCompanyId]
  );

  // Load companies on mount
  useEffect(() => {
    async function fetchCompanies() {
      try {
        const res = await fetch("/api/companies?active=true");
        if (!res.ok) return;
        const data = (await res.json()) as CompanySummary[];
        const mapped: CompanySummary[] = data.map((c) => ({
          id: c.id,
          name: c.name,
          legalForm: c.legalForm,
        }));
        setCompanies(mapped);

        // Restore company from cookie or default to first
        const savedCompanyId = getCookie("atlas_company_id");
        const validSaved = mapped.find((c) => c.id === savedCompanyId);
        const initialCompanyId = validSaved ? savedCompanyId! : mapped[0]?.id ?? null;
        setCurrentCompanyId(initialCompanyId);
      } catch {
        // Silently fail - user will see empty state
      }
    }
    fetchCompanies();
  }, []);

  // Load fiscal years when company changes
  useEffect(() => {
    refreshFiscalYears();
  }, [refreshFiscalYears]);

  const setCompany = useCallback((id: string) => {
    setCookie("atlas_company_id", id);
    setCurrentCompanyId(id);
    // Reset fiscal year - will be re-fetched by the effect
    setCurrentFiscalYearId(null);
  }, []);

  const setFiscalYear = useCallback((id: string) => {
    setCookie("atlas_fiscal_year_id", id);
    setCurrentFiscalYearId(id);
  }, []);

  return (
    <AppContext.Provider
      value={{
        currentCompanyId,
        currentFiscalYearId,
        setCompany,
        setFiscalYear,
        refreshFiscalYears,
        companies,
        fiscalYears,
        isLoading,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext(): AppContextType {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error("useAppContext must be used within an AppProvider");
  }
  return context;
}
