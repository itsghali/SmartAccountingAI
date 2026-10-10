"use client";

import { useState, useEffect, useCallback } from "react";
import { useAppContext } from "@/hooks/useAppContext";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Download, Printer, AlertTriangle, TrendingUp, TrendingDown } from "lucide-react";
import { formatMAD } from "@/lib/utils/currency";
import { toast } from "sonner";

interface AgedRow {
  tiersName: string;
  accountCode: string;
  accountType: "client" | "fournisseur";
  totalBalance: string;
  current: string;
  days_0_30: string;
  days_31_60: string;
  days_61_90: string;
  days_90_plus: string;
}

interface AgedSummary {
  totalReceivables: string;
  totalPayables: string;
  totalOverdue: string;
}

type AccountFilter = "tous" | "clients" | "fournisseurs";

export default function AgedBalancePage() {
  const { currentCompanyId, currentFiscalYearId } = useAppContext();

  const [rows, setRows] = useState<AgedRow[]>([]);
  const [summary, setSummary] = useState<AgedSummary | null>(null);
  const [asOf, setAsOf] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [accountFilter, setAccountFilter] = useState<AccountFilter>("tous");

  const fetchData = useCallback(async () => {
    if (!currentCompanyId || !currentFiscalYearId) return;

    setLoading(true);
    try {
      const params = new URLSearchParams({
        companyId: currentCompanyId,
        fiscalYearId: currentFiscalYearId,
      });

      const res = await fetch(`/api/reports/aged-balance?${params}`);
      if (!res.ok) throw new Error("Erreur lors du chargement");
      const data = await res.json();
      setRows(data.rows || []);
      setSummary(data.summary || null);
      setAsOf(data.asOf || "");
    } catch {
      toast.error("Erreur lors du chargement de la balance âgée");
    } finally {
      setLoading(false);
    }
  }, [currentCompanyId, currentFiscalYearId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const filteredRows =
    accountFilter === "tous"
      ? rows
      : rows.filter((r) =>
          accountFilter === "clients"
            ? r.accountType === "client"
            : r.accountType === "fournisseur"
        );

  const handleExportCSV = () => {
    if (filteredRows.length === 0) return;

    const header =
      "Tiers;Compte;Type;Total;Non échu;0-30j;31-60j;61-90j;+90j";
    const csvRows = filteredRows.map(
      (r) =>
        `${r.tiersName};${r.accountCode};${r.accountType};${r.totalBalance};${r.current};${r.days_0_30};${r.days_31_60};${r.days_61_90};${r.days_90_plus}`
    );

    const csv = [header, ...csvRows].join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `balance_agee_${new Date().toISOString().substring(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handlePrint = () => {
    window.print();
  };

  // Totals for filtered rows
  function sumCol(col: keyof Pick<AgedRow, "totalBalance" | "current" | "days_0_30" | "days_31_60" | "days_61_90" | "days_90_plus">) {
    return filteredRows.reduce((acc, r) => acc + parseFloat(r[col]), 0);
  }

  if (!currentCompanyId || !currentFiscalYearId) {
    return (
      <div className="p-6 text-gray-500">
        Veuillez sélectionner une société et un exercice comptable.
      </div>
    );
  }

  const overdueAmount = summary ? parseFloat(summary.totalOverdue) : 0;

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Balance Âgée</h1>
          {asOf && (
            <p className="text-sm text-gray-500 mt-1">
              Situation au {new Date(asOf).toLocaleDateString("fr-FR")}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleExportCSV}>
            <Download className="h-4 w-4 mr-2" /> Exporter CSV
          </Button>
          <Button variant="outline" size="sm" onClick={handlePrint}>
            <Printer className="h-4 w-4 mr-2" /> Imprimer
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 bg-blue-50 rounded-lg">
                <TrendingUp className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide">
                  Créances clients
                </p>
                <p className="text-lg font-bold text-gray-900">
                  {formatMAD(summary.totalReceivables)}
                </p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 bg-orange-50 rounded-lg">
                <TrendingDown className="h-5 w-5 text-orange-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide">
                  Dettes fournisseurs
                </p>
                <p className="text-lg font-bold text-gray-900">
                  {formatMAD(summary.totalPayables)}
                </p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 bg-red-50 rounded-lg">
                <AlertTriangle className="h-5 w-5 text-red-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide">
                  Total échu
                </p>
                <p className={`text-lg font-bold ${overdueAmount > 0 ? "text-red-600" : "text-gray-900"}`}>
                  {formatMAD(summary.totalOverdue)}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filter */}
      <div className="flex items-center gap-4 mb-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Type de compte
          </label>
          <Select
            value={accountFilter}
            onValueChange={(v) => v && setAccountFilter(v as AccountFilter)}
          >
            <SelectTrigger className="w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="tous">Tous</SelectItem>
              <SelectItem value="clients">Clients (342x)</SelectItem>
              <SelectItem value="fournisseurs">Fournisseurs (441x)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="mt-5 text-sm text-gray-500">
          {filteredRows.length} tiers
        </div>
      </div>

      {/* Table */}
      <div className="border rounded-lg overflow-x-auto print:border-black">
        <table className="w-full min-w-[900px]">
          <thead className="bg-gray-50 text-xs uppercase text-gray-500">
            <tr>
              <th className="p-3 text-left">Tiers</th>
              <th className="p-3 text-left">Compte</th>
              <th className="p-3 text-left">Type</th>
              <th className="p-3 text-right font-semibold">Total solde</th>
              <th className="p-3 text-right">Non échu</th>
              <th className="p-3 text-right">0 – 30 j</th>
              <th className="p-3 text-right">31 – 60 j</th>
              <th className="p-3 text-right">61 – 90 j</th>
              <th className="p-3 text-right text-red-600">+ 90 j</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={9} className="p-8 text-center text-gray-400">
                  Chargement...
                </td>
              </tr>
            ) : filteredRows.length === 0 ? (
              <tr>
                <td colSpan={9} className="p-8 text-center text-gray-400">
                  Aucune créance ou dette non lettrée trouvée
                </td>
              </tr>
            ) : (
              <>
                {filteredRows.map((row, idx) => {
                  return (
                    <tr key={idx} className="border-t hover:bg-gray-50">
                      <td className="p-3 text-sm font-medium text-gray-900">
                        {row.tiersName}
                      </td>
                      <td className="p-3 font-mono text-sm text-blue-700">
                        {row.accountCode}
                      </td>
                      <td className="p-3">
                        <Badge
                          variant={row.accountType === "client" ? "default" : "secondary"}
                          className="text-xs"
                        >
                          {row.accountType === "client" ? "Client" : "Fournisseur"}
                        </Badge>
                      </td>
                      <td className="p-3 text-right font-mono text-sm font-semibold">
                        {formatMAD(row.totalBalance)}
                      </td>
                      <td className="p-3 text-right font-mono text-sm text-gray-600">
                        {parseFloat(row.current) !== 0 ? formatMAD(row.current) : "—"}
                      </td>
                      <td className="p-3 text-right font-mono text-sm text-yellow-700">
                        {parseFloat(row.days_0_30) !== 0 ? formatMAD(row.days_0_30) : "—"}
                      </td>
                      <td className="p-3 text-right font-mono text-sm text-orange-600">
                        {parseFloat(row.days_31_60) !== 0 ? formatMAD(row.days_31_60) : "—"}
                      </td>
                      <td className="p-3 text-right font-mono text-sm text-orange-700">
                        {parseFloat(row.days_61_90) !== 0 ? formatMAD(row.days_61_90) : "—"}
                      </td>
                      <td className={`p-3 text-right font-mono text-sm font-semibold ${parseFloat(row.days_90_plus) > 0 ? "text-red-600" : "text-gray-400"}`}>
                        {parseFloat(row.days_90_plus) !== 0 ? formatMAD(row.days_90_plus) : "—"}
                      </td>
                    </tr>
                  );
                })}
                {/* Totals row */}
                <tr className="border-t-2 border-gray-800 bg-gray-100 font-bold">
                  <td className="p-3 text-sm" colSpan={3}>
                    TOTAUX
                  </td>
                  <td className="p-3 text-right font-mono text-sm">
                    {formatMAD(sumCol("totalBalance"))}
                  </td>
                  <td className="p-3 text-right font-mono text-sm">
                    {formatMAD(sumCol("current"))}
                  </td>
                  <td className="p-3 text-right font-mono text-sm">
                    {formatMAD(sumCol("days_0_30"))}
                  </td>
                  <td className="p-3 text-right font-mono text-sm">
                    {formatMAD(sumCol("days_31_60"))}
                  </td>
                  <td className="p-3 text-right font-mono text-sm">
                    {formatMAD(sumCol("days_61_90"))}
                  </td>
                  <td className="p-3 text-right font-mono text-sm text-red-600">
                    {formatMAD(sumCol("days_90_plus"))}
                  </td>
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
