"use client";

import { useState, useEffect, useCallback } from "react";
import { useAppContext } from "@/hooks/useAppContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Download, Printer, ChevronDown, ChevronRight } from "lucide-react";
import { formatMAD } from "@/lib/utils/currency";
import { formatDate } from "@/lib/utils/dates";
import { toast } from "sonner";

interface LedgerLine {
  id: string;
  date: string;
  journalCode: string;
  entryNumber: number;
  label: string;
  reference: string | null;
  debit: string;
  credit: string;
  runningBalance: string;
}

interface LedgerAccount {
  accountCode: string;
  accountLabel: string;
  lines: LedgerLine[];
  totalDebit: string;
  totalCredit: string;
  solde: string;
}

export default function GeneralLedgerPage() {
  const { currentCompanyId, currentFiscalYearId, fiscalYears } = useAppContext();

  const [accounts, setAccounts] = useState<LedgerAccount[]>([]);
  const [loading, setLoading] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [accountCodeFilter, setAccountCodeFilter] = useState("");
  const [collapsedAccounts, setCollapsedAccounts] = useState<Set<string>>(new Set());

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
      if (accountCodeFilter) params.set("accountCode", accountCodeFilter);

      const res = await fetch(`/api/reports/general-ledger?${params}`);
      if (!res.ok) throw new Error("Erreur lors du chargement");
      const data = await res.json();
      setAccounts(data.accounts || []);
    } catch {
      toast.error("Erreur lors du chargement du grand livre");
    } finally {
      setLoading(false);
    }
  }, [currentCompanyId, currentFiscalYearId, startDate, endDate, accountCodeFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const toggleAccount = (code: string) => {
    setCollapsedAccounts((prev) => {
      const next = new Set(prev);
      if (next.has(code)) {
        next.delete(code);
      } else {
        next.add(code);
      }
      return next;
    });
  };

  const collapseAll = () => {
    setCollapsedAccounts(new Set(accounts.map((a) => a.accountCode)));
  };

  const expandAll = () => {
    setCollapsedAccounts(new Set());
  };

  const handleExportCSV = () => {
    if (accounts.length === 0) return;

    const header = "Compte;Libell\u00e9 Compte;Date;Journal;N\u00b0;Libell\u00e9;D\u00e9bit;Cr\u00e9dit;Solde";
    const rows: string[] = [];

    for (const acc of accounts) {
      for (const line of acc.lines) {
        rows.push(
          `${acc.accountCode};${acc.accountLabel};${line.date.substring(0, 10)};${line.journalCode};${line.entryNumber};${line.label};${line.debit};${line.credit};${line.runningBalance}`
        );
      }
      rows.push(
        `${acc.accountCode};TOTAL ${acc.accountLabel};;;;${acc.totalDebit};${acc.totalCredit};${acc.solde}`
      );
    }

    const csv = [header, ...rows].join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `grand_livre_${startDate}_${endDate}.csv`;
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
        <h1 className="text-2xl font-bold text-gray-900">Grand Livre</h1>
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
            Compte (code)
          </label>
          <Input
            placeholder="Ex: 6111"
            value={accountCodeFilter}
            onChange={(e) => setAccountCodeFilter(e.target.value)}
            className="w-[160px]"
          />
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={expandAll}>
            Tout d\u00e9plier
          </Button>
          <Button variant="outline" size="sm" onClick={collapseAll}>
            Tout replier
          </Button>
        </div>
      </div>

      {/* Summary */}
      <div className="text-sm text-gray-500 mb-2">
        {accounts.length} compte(s)
      </div>

      {/* Accounts with lines */}
      {loading ? (
        <div className="p-8 text-center text-gray-400">Chargement...</div>
      ) : accounts.length === 0 ? (
        <div className="p-8 text-center text-gray-400">
          Aucun mouvement trouv\u00e9 pour la p\u00e9riode s\u00e9lectionn\u00e9e
        </div>
      ) : (
        <div className="space-y-4">
          {accounts.map((acc) => {
            const isCollapsed = collapsedAccounts.has(acc.accountCode);
            const soldeNum = parseFloat(acc.solde);

            return (
              <div
                key={acc.accountCode}
                className="border rounded-lg overflow-hidden print:break-inside-avoid"
              >
                {/* Account header */}
                <button
                  type="button"
                  className="w-full flex items-center gap-2 p-3 bg-blue-50 hover:bg-blue-100 text-left print:bg-white print:border-b"
                  onClick={() => toggleAccount(acc.accountCode)}
                >
                  {isCollapsed ? (
                    <ChevronRight className="h-4 w-4 text-gray-500 print:hidden" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-gray-500 print:hidden" />
                  )}
                  <span className="font-mono font-bold text-blue-700">
                    {acc.accountCode}
                  </span>
                  <span className="font-semibold text-gray-800">
                    {acc.accountLabel}
                  </span>
                  <span className="ml-auto text-sm text-gray-500">
                    {acc.lines.length} ligne(s) | Solde :{" "}
                    <span
                      className={
                        soldeNum >= 0 ? "text-blue-700 font-mono" : "text-red-600 font-mono"
                      }
                    >
                      {soldeNum >= 0 ? "" : "-"}
                      {formatMAD(Math.abs(soldeNum).toString())}
                    </span>
                  </span>
                </button>

                {/* Lines table */}
                {!isCollapsed && (
                  <table className="w-full">
                    <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                      <tr>
                        <th className="p-2 pl-3 text-left">Date</th>
                        <th className="p-2 text-left">Journal</th>
                        <th className="p-2 text-left">N\u00b0</th>
                        <th className="p-2 text-left">Libell\u00e9</th>
                        <th className="p-2 text-right">D\u00e9bit</th>
                        <th className="p-2 text-right">Cr\u00e9dit</th>
                        <th className="p-2 pr-3 text-right">Solde</th>
                      </tr>
                    </thead>
                    <tbody>
                      {acc.lines.map((line) => {
                        const balance = parseFloat(line.runningBalance);
                        return (
                          <tr key={line.id} className="border-t hover:bg-gray-50">
                            <td className="p-2 pl-3 text-sm">
                              {formatDate(line.date)}
                            </td>
                            <td className="p-2 text-sm font-mono text-blue-600">
                              {line.journalCode}
                            </td>
                            <td className="p-2 text-sm font-mono">
                              {line.entryNumber}
                            </td>
                            <td className="p-2 text-sm">{line.label}</td>
                            <td className="p-2 text-right font-mono text-sm">
                              {parseFloat(line.debit) > 0
                                ? formatMAD(line.debit)
                                : ""}
                            </td>
                            <td className="p-2 text-right font-mono text-sm">
                              {parseFloat(line.credit) > 0
                                ? formatMAD(line.credit)
                                : ""}
                            </td>
                            <td
                              className={`p-2 pr-3 text-right font-mono text-sm ${
                                balance < 0 ? "text-red-600" : ""
                              }`}
                            >
                              {balance < 0 ? "-" : ""}
                              {formatMAD(Math.abs(balance).toString())}
                            </td>
                          </tr>
                        );
                      })}
                      {/* Account total row */}
                      <tr className="border-t-2 border-gray-300 bg-gray-50 font-bold">
                        <td className="p-2 pl-3 text-sm" colSpan={4}>
                          Total {acc.accountCode} - {acc.accountLabel}
                        </td>
                        <td className="p-2 text-right font-mono text-sm">
                          {formatMAD(acc.totalDebit)}
                        </td>
                        <td className="p-2 text-right font-mono text-sm">
                          {formatMAD(acc.totalCredit)}
                        </td>
                        <td
                          className={`p-2 pr-3 text-right font-mono text-sm ${
                            soldeNum < 0 ? "text-red-600" : ""
                          }`}
                        >
                          {soldeNum < 0 ? "-" : ""}
                          {formatMAD(Math.abs(soldeNum).toString())}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
