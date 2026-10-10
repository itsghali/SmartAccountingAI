"use client";

import { useState, useEffect, useCallback } from "react";
import { useAppContext } from "@/hooks/useAppContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Download, Printer, Search } from "lucide-react";
import { formatMAD } from "@/lib/utils/currency";
import { toast } from "sonner";

interface TrialBalanceAccount {
  code: string;
  label: string;
  classNumber: number;
  accountType: string;
  totalDebit: string;
  totalCredit: string;
  soldeDebit: string;
  soldeCredit: string;
}

interface TrialBalanceTotals {
  totalDebit: string;
  totalCredit: string;
  soldeDebit: string;
  soldeCredit: string;
}

export default function TrialBalancePage() {
  const { currentCompanyId, currentFiscalYearId, fiscalYears } = useAppContext();

  const [accounts, setAccounts] = useState<TrialBalanceAccount[]>([]);
  const [totals, setTotals] = useState<TrialBalanceTotals | null>(null);
  const [loading, setLoading] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [searchCode, setSearchCode] = useState("");

  // Initialize dates from fiscal year
  useEffect(() => {
    if (currentFiscalYearId) {
      const fy = fiscalYears.find((f) => f.id === currentFiscalYearId);
      if (fy) {
        setStartDate(fy.startDate.substring(0, 10));
        setEndDate(fy.endDate.substring(0, 10));
      }
    }
  }, [currentFiscalYearId, fiscalYears]);

  const fetchData = useCallback(async () => {
    if (!currentCompanyId || !currentFiscalYearId) return;

    setLoading(true);
    try {
      const params = new URLSearchParams({
        companyId: currentCompanyId,
        fiscalYearId: currentFiscalYearId,
      });
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);
      if (filterStatus !== "all") params.set("status", filterStatus);

      const res = await fetch(`/api/reports/trial-balance?${params}`);
      if (!res.ok) throw new Error("Erreur lors du chargement");
      const data = await res.json();
      setAccounts(data.accounts || []);
      setTotals(data.totals || null);
    } catch {
      toast.error("Erreur lors du chargement de la balance");
    } finally {
      setLoading(false);
    }
  }, [currentCompanyId, currentFiscalYearId, startDate, endDate, filterStatus]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Filter accounts by code search (client-side for fast feedback)
  const filteredAccounts = searchCode
    ? accounts.filter(
        (a) =>
          a.code.startsWith(searchCode) ||
          a.label.toLowerCase().includes(searchCode.toLowerCase())
      )
    : accounts;

  const handleExportCSV = () => {
    if (filteredAccounts.length === 0) return;

    const header = "Code;Libell\u00e9;Mouvement D\u00e9bit;Mouvement Cr\u00e9dit;Solde D\u00e9bit;Solde Cr\u00e9dit";
    const rows = filteredAccounts.map(
      (a) =>
        `${a.code};${a.label};${a.totalDebit};${a.totalCredit};${a.soldeDebit};${a.soldeCredit}`
    );
    if (totals) {
      rows.push(
        `TOTAUX;;${totals.totalDebit};${totals.totalCredit};${totals.soldeDebit};${totals.soldeCredit}`
      );
    }

    const csv = [header, ...rows].join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `balance_generale_${startDate}_${endDate}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handlePrint = () => {
    window.print();
  };

  if (!currentCompanyId || !currentFiscalYearId) {
    return (
      <div className="p-6 text-gray-500">
        Veuillez s\u00e9lectionner une soci\u00e9t\u00e9 et un exercice comptable.
      </div>
    );
  }

  return (
    <div className="p-6 max-w-400 mx-auto animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-linear-to-r from-primary to-secondary">Balance G\u00e9n\u00e9rale</h1>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleExportCSV}>
            <Download className="h-4 w-4 mr-2" /> Exporter CSV
          </Button>
          <Button variant="outline" size="sm" onClick={handlePrint}>
            <Printer className="h-4 w-4 mr-2" /> Imprimer
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-6 mb-8 p-6 bg-card/60 backdrop-blur-md border border-border/50 shadow-sm rounded-xl items-end transition-all duration-300 hover:shadow-md">
        <div>
          <label className="block text-sm font-medium text-muted-foreground mb-1.5">
            Date d\u00e9but
          </label>
          <Input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-40"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-muted-foreground mb-1.5">
            Date fin
          </label>
          <Input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="w-40"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-muted-foreground mb-1.5">
            Statut
          </label>
          <Select value={filterStatus} onValueChange={(v) => v !== null && setFilterStatus(v)}>
            <SelectTrigger className="w-45">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toutes les \u00e9critures</SelectItem>
              <SelectItem value="VALIDATED">Valid\u00e9es uniquement</SelectItem>
              <SelectItem value="DRAFT">Brouillons uniquement</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="block text-sm font-medium text-muted-foreground mb-1.5">
            Recherche compte
          </label>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Code ou libell\u00e9..."
              value={searchCode}
              onChange={(e) => setSearchCode(e.target.value)}
              className="pl-9 w-55"
            />
          </div>
        </div>
      </div>

      {/* Summary */}
      <div className="text-sm text-gray-500 mb-2">
        {filteredAccounts.length} compte(s)
      </div>

      {/* Table */}
      <div className="bg-card/60 backdrop-blur-xl border border-border/50 rounded-xl overflow-hidden shadow-sm print:border-black print:bg-white transition-all duration-300 hover:shadow-md hover:border-primary/20">
        <table className="w-full">
          <thead className="bg-muted/50 text-xs uppercase text-muted-foreground border-b border-border/50 print:bg-white print:text-black print:font-bold">
            <tr>
              <th className="p-4 text-left font-semibold">Code</th>
              <th className="p-4 text-left font-semibold">Libell\u00e9</th>
              <th className="p-4 text-right font-semibold">Mouvement D\u00e9bit</th>
              <th className="p-4 text-right font-semibold">Mouvement Cr\u00e9dit</th>
              <th className="p-4 text-right font-semibold">Solde D\u00e9bit</th>
              <th className="p-4 text-right font-semibold">Solde Cr\u00e9dit</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="p-12 text-center text-muted-foreground font-medium animate-pulse">
                  Chargement...
                </td>
              </tr>
            ) : filteredAccounts.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-12 text-center text-muted-foreground border-dashed border-border/50">
                  Aucun mouvement trouv\u00e9 pour la p\u00e9riode s\u00e9lectionn\u00e9e
                </td>
              </tr>
            ) : (
              <>
                {filteredAccounts.map((acc) => (
                  <tr key={acc.code} className="border-t border-border/50 hover:bg-muted/30 transition-colors">
                    <td className="p-4 font-mono text-sm font-bold text-primary tracking-wide">
                      {acc.code}
                    </td>
                    <td className="p-4 text-sm font-medium">{acc.label}</td>
                    <td className="p-4 text-right font-mono text-sm text-muted-foreground">
                      {formatMAD(acc.totalDebit)}
                    </td>
                    <td className="p-4 text-right font-mono text-sm text-muted-foreground">
                      {formatMAD(acc.totalCredit)}
                    </td>
                    <td className="p-4 text-right font-mono text-sm font-medium text-foreground">
                      {parseFloat(acc.soldeDebit) > 0 ? formatMAD(acc.soldeDebit) : ""}
                    </td>
                    <td className="p-4 text-right font-mono text-sm font-medium text-foreground">
                      {parseFloat(acc.soldeCredit) > 0 ? formatMAD(acc.soldeCredit) : ""}
                    </td>
                  </tr>
                ))}
                {/* Totals row */}
                {totals && (
                  <tr className="border-t-2 border-border bg-muted/30 font-bold print:bg-white">
                    <td className="p-4 text-sm text-foreground" colSpan={2}>
                      TOTAUX
                    </td>
                    <td className="p-4 text-right font-mono text-sm text-foreground">
                      {formatMAD(totals.totalDebit)}
                    </td>
                    <td className="p-4 text-right font-mono text-sm text-foreground">
                      {formatMAD(totals.totalCredit)}
                    </td>
                    <td className="p-4 text-right font-mono text-sm text-primary">
                      {formatMAD(totals.soldeDebit)}
                    </td>
                    <td className="p-4 text-right font-mono text-sm text-primary">
                      {formatMAD(totals.soldeCredit)}
                    </td>
                  </tr>
                )}
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
