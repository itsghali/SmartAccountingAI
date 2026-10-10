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
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Balance G\u00e9n\u00e9rale</h1>
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
      <div className="flex flex-wrap gap-4 mb-6 items-end">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Date d\u00e9but
          </label>
          <Input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-[160px]"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Date fin
          </label>
          <Input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="w-[160px]"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Statut
          </label>
          <Select value={filterStatus} onValueChange={(v) => v !== null && setFilterStatus(v)}>
            <SelectTrigger className="w-[180px]">
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
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Recherche compte
          </label>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Code ou libell\u00e9..."
              value={searchCode}
              onChange={(e) => setSearchCode(e.target.value)}
              className="pl-9 w-[220px]"
            />
          </div>
        </div>
      </div>

      {/* Summary */}
      <div className="text-sm text-gray-500 mb-2">
        {filteredAccounts.length} compte(s)
      </div>

      {/* Table */}
      <div className="border rounded-lg overflow-hidden print:border-black">
        <table className="w-full">
          <thead className="bg-gray-50 text-xs uppercase text-gray-500 print:bg-white print:text-black print:font-bold">
            <tr>
              <th className="p-3 text-left">Code</th>
              <th className="p-3 text-left">Libell\u00e9</th>
              <th className="p-3 text-right">Mouvement D\u00e9bit</th>
              <th className="p-3 text-right">Mouvement Cr\u00e9dit</th>
              <th className="p-3 text-right">Solde D\u00e9bit</th>
              <th className="p-3 text-right">Solde Cr\u00e9dit</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="p-8 text-center text-gray-400">
                  Chargement...
                </td>
              </tr>
            ) : filteredAccounts.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-8 text-center text-gray-400">
                  Aucun mouvement trouv\u00e9 pour la p\u00e9riode s\u00e9lectionn\u00e9e
                </td>
              </tr>
            ) : (
              <>
                {filteredAccounts.map((acc) => (
                  <tr key={acc.code} className="border-t hover:bg-gray-50">
                    <td className="p-3 font-mono text-sm font-medium text-blue-700">
                      {acc.code}
                    </td>
                    <td className="p-3 text-sm">{acc.label}</td>
                    <td className="p-3 text-right font-mono text-sm">
                      {formatMAD(acc.totalDebit)}
                    </td>
                    <td className="p-3 text-right font-mono text-sm">
                      {formatMAD(acc.totalCredit)}
                    </td>
                    <td className="p-3 text-right font-mono text-sm">
                      {parseFloat(acc.soldeDebit) > 0 ? formatMAD(acc.soldeDebit) : ""}
                    </td>
                    <td className="p-3 text-right font-mono text-sm">
                      {parseFloat(acc.soldeCredit) > 0 ? formatMAD(acc.soldeCredit) : ""}
                    </td>
                  </tr>
                ))}
                {/* Totals row */}
                {totals && (
                  <tr className="border-t-2 border-gray-800 bg-gray-100 font-bold print:bg-white">
                    <td className="p-3 text-sm" colSpan={2}>
                      TOTAUX
                    </td>
                    <td className="p-3 text-right font-mono text-sm">
                      {formatMAD(totals.totalDebit)}
                    </td>
                    <td className="p-3 text-right font-mono text-sm">
                      {formatMAD(totals.totalCredit)}
                    </td>
                    <td className="p-3 text-right font-mono text-sm">
                      {formatMAD(totals.soldeDebit)}
                    </td>
                    <td className="p-3 text-right font-mono text-sm">
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
