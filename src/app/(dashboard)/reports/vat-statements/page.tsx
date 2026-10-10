"use client";

import { useState, useEffect, useCallback } from "react";
import { useAppContext } from "@/hooks/useAppContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Download, Printer, Receipt, TrendingUp, TrendingDown, Scale } from "lucide-react";
import { formatMAD } from "@/lib/utils/currency";
import { formatDate } from "@/lib/utils/dates";
import { toast } from "sonner";

interface MonthlyVAT {
  month: string;
  collected: string;
  deductible: string;
  net: string;
}

interface VATDeclaration {
  id: string;
  regime: string;
  periodType: string;
  periodIndex: number;
  startDate: string;
  endDate: string;
  totalOutputVAT: string;
  totalInputVAT: string;
  previousCredit: string;
  netVAT: string;
  isCredit: boolean;
  status: string;
  submissionDate: string | null;
  paymentDate: string | null;
}

interface VATSummary {
  totalCollected: string;
  totalDeductible: string;
  netBalance: string;
}

const STATUS_LABELS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  DRAFT:     { label: "Brouillon",  variant: "secondary" },
  COMPUTED:  { label: "Calculée",   variant: "outline" },
  VALIDATED: { label: "Validée",    variant: "default" },
  SUBMITTED: { label: "Déposée",    variant: "default" },
  PAID:      { label: "Payée",      variant: "default" },
};

const REGIME_LABELS: Record<string, string> = {
  ENCAISSEMENT: "Encaissement",
  DEBIT: "Débit",
};

const PERIOD_LABELS: Record<string, string> = {
  MONTHLY: "Mensuel",
  QUARTERLY: "Trimestriel",
};

function periodLabel(declaration: VATDeclaration): string {
  if (declaration.periodType === "MONTHLY") {
    const monthNames = [
      "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
      "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
    ];
    return monthNames[(declaration.periodIndex - 1) % 12] ?? `Mois ${declaration.periodIndex}`;
  }
  return `T${declaration.periodIndex}`;
}

function monthLabel(monthStr: string): string {
  const [year, month] = monthStr.split("-");
  const monthNames = [
    "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
    "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
  ];
  return `${monthNames[parseInt(month!, 10) - 1]} ${year}`;
}

export default function VatStatementsPage() {
  const { currentCompanyId, currentFiscalYearId, fiscalYears } = useAppContext();

  const [declarations, setDeclarations] = useState<VATDeclaration[]>([]);
  const [monthly, setMonthly] = useState<MonthlyVAT[]>([]);
  const [summary, setSummary] = useState<VATSummary | null>(null);
  const [loading, setLoading] = useState(false);

  const fiscalYear = fiscalYears.find((f) => f.id === currentFiscalYearId);

  const fetchData = useCallback(async () => {
    if (!currentCompanyId || !currentFiscalYearId) return;

    setLoading(true);
    try {
      const params = new URLSearchParams({
        companyId: currentCompanyId,
        fiscalYearId: currentFiscalYearId,
      });

      const res = await fetch(`/api/reports/vat-statements?${params}`);
      if (!res.ok) throw new Error("Erreur lors du chargement");
      const data = await res.json();
      setDeclarations(data.declarations || []);
      setMonthly(data.monthly || []);
      setSummary(data.summary || null);
    } catch {
      toast.error("Erreur lors du chargement des états TVA");
    } finally {
      setLoading(false);
    }
  }, [currentCompanyId, currentFiscalYearId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handlePrint = () => window.print();

  const handleExportCSV = () => {
    if (monthly.length === 0 && declarations.length === 0) return;

    const rows: string[] = ["ÉTAT TVA - MENSUEL", "Mois;TVA collectée;TVA déductible;Solde net"];
    for (const m of monthly) {
      rows.push(`${monthLabel(m.month)};${m.collected};${m.deductible};${m.net}`);
    }

    if (declarations.length > 0) {
      rows.push("", "DÉCLARATIONS TVA", "Période;Régime;Type;Statut;TVA collectée;TVA déductible;Net TVA");
      for (const d of declarations) {
        rows.push(
          `${periodLabel(d)};${REGIME_LABELS[d.regime] ?? d.regime};${PERIOD_LABELS[d.periodType] ?? d.periodType};${STATUS_LABELS[d.status]?.label ?? d.status};${d.totalOutputVAT};${d.totalInputVAT};${d.netVAT}`
        );
      }
    }

    const csv = rows.join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `etats_tva_${fiscalYear?.label ?? "exercice"}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (!currentCompanyId || !currentFiscalYearId) {
    return (
      <div className="p-6 text-gray-500">
        Veuillez sélectionner une société et un exercice comptable.
      </div>
    );
  }

  const netBalance = summary ? parseFloat(summary.netBalance) : 0;

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">États TVA</h1>
          {fiscalYear && (
            <p className="text-sm text-gray-500 mt-1">
              Exercice : {fiscalYear.label}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleExportCSV} disabled={!summary}>
            <Download className="h-4 w-4 mr-2" /> Exporter CSV
          </Button>
          <Button variant="outline" size="sm" onClick={handlePrint}>
            <Printer className="h-4 w-4 mr-2" /> Imprimer
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="p-12 text-center text-gray-400">Chargement...</div>
      ) : (
        <>
          {/* Summary Cards */}
          {summary && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
              <Card>
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="p-2 bg-blue-50 rounded-lg">
                    <TrendingUp className="h-5 w-5 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wide">
                      TVA collectée
                    </p>
                    <p className="text-lg font-bold text-gray-900">
                      {formatMAD(summary.totalCollected)}
                    </p>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="p-2 bg-emerald-50 rounded-lg">
                    <TrendingDown className="h-5 w-5 text-emerald-600" />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wide">
                      TVA déductible
                    </p>
                    <p className="text-lg font-bold text-gray-900">
                      {formatMAD(summary.totalDeductible)}
                    </p>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${netBalance > 0 ? "bg-orange-50" : "bg-emerald-50"}`}>
                    <Scale className={`h-5 w-5 ${netBalance > 0 ? "text-orange-600" : "text-emerald-600"}`} />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wide">
                      Solde net TVA
                    </p>
                    <p className={`text-lg font-bold ${netBalance > 0 ? "text-orange-600" : "text-emerald-700"}`}>
                      {formatMAD(summary.netBalance)}
                    </p>
                    <p className="text-xs text-gray-400">
                      {netBalance > 0 ? "À décaisser" : "Crédit de TVA"}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Monthly table */}
          <div className="mb-8">
            <h2 className="text-lg font-semibold text-gray-800 mb-3">
              Mouvements mensuels (comptes 4455x / 3455x)
            </h2>
            {monthly.length === 0 ? (
              <div className="border rounded-lg p-8 text-center text-gray-400">
                Aucun mouvement TVA enregistré dans les comptes 4455x / 3455x
              </div>
            ) : (
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full">
                  <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                    <tr>
                      <th className="p-3 text-left">Mois</th>
                      <th className="p-3 text-right">TVA collectée</th>
                      <th className="p-3 text-right">TVA déductible</th>
                      <th className="p-3 text-right">Solde net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthly.map((m) => {
                      const net = parseFloat(m.net);
                      return (
                        <tr key={m.month} className="border-t hover:bg-gray-50">
                          <td className="p-3 text-sm font-medium text-gray-900">
                            {monthLabel(m.month)}
                          </td>
                          <td className="p-3 text-right font-mono text-sm text-blue-700">
                            {formatMAD(m.collected)}
                          </td>
                          <td className="p-3 text-right font-mono text-sm text-emerald-700">
                            {formatMAD(m.deductible)}
                          </td>
                          <td className={`p-3 text-right font-mono text-sm font-semibold ${net > 0 ? "text-orange-600" : "text-emerald-700"}`}>
                            {formatMAD(m.net)}
                          </td>
                        </tr>
                      );
                    })}
                    {/* Totals row */}
                    {summary && (
                      <tr className="border-t-2 border-gray-800 bg-gray-100 font-bold">
                        <td className="p-3 text-sm uppercase">Total</td>
                        <td className="p-3 text-right font-mono text-sm text-blue-700">
                          {formatMAD(summary.totalCollected)}
                        </td>
                        <td className="p-3 text-right font-mono text-sm text-emerald-700">
                          {formatMAD(summary.totalDeductible)}
                        </td>
                        <td className={`p-3 text-right font-mono text-sm ${netBalance > 0 ? "text-orange-600" : "text-emerald-700"}`}>
                          {formatMAD(summary.netBalance)}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Declarations list */}
          <div>
            <h2 className="text-lg font-semibold text-gray-800 mb-3 flex items-center gap-2">
              <Receipt className="h-5 w-5 text-gray-600" />
              Déclarations TVA
            </h2>
            {declarations.length === 0 ? (
              <div className="border rounded-lg p-8 text-center text-gray-400">
                Aucune déclaration TVA pour cet exercice
              </div>
            ) : (
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full">
                  <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                    <tr>
                      <th className="p-3 text-left">Période</th>
                      <th className="p-3 text-left">Régime</th>
                      <th className="p-3 text-left">Type</th>
                      <th className="p-3 text-left">Statut</th>
                      <th className="p-3 text-right">TVA collectée</th>
                      <th className="p-3 text-right">TVA déductible</th>
                      <th className="p-3 text-right">Net TVA</th>
                      <th className="p-3 text-left">Date dépôt</th>
                    </tr>
                  </thead>
                  <tbody>
                    {declarations.map((d) => {
                      const statusInfo = STATUS_LABELS[d.status] ?? { label: d.status, variant: "secondary" as const };
                      const net = parseFloat(d.netVAT);
                      return (
                        <tr key={d.id} className="border-t hover:bg-gray-50">
                          <td className="p-3 text-sm font-medium text-gray-900">
                            {periodLabel(d)}
                          </td>
                          <td className="p-3 text-sm text-gray-600">
                            {REGIME_LABELS[d.regime] ?? d.regime}
                          </td>
                          <td className="p-3 text-sm text-gray-600">
                            {PERIOD_LABELS[d.periodType] ?? d.periodType}
                          </td>
                          <td className="p-3">
                            <Badge variant={statusInfo.variant} className="text-xs">
                              {statusInfo.label}
                            </Badge>
                          </td>
                          <td className="p-3 text-right font-mono text-sm text-blue-700">
                            {formatMAD(d.totalOutputVAT)}
                          </td>
                          <td className="p-3 text-right font-mono text-sm text-emerald-700">
                            {formatMAD(d.totalInputVAT)}
                          </td>
                          <td className={`p-3 text-right font-mono text-sm font-semibold ${net > 0 ? "text-orange-600" : "text-emerald-700"}`}>
                            {formatMAD(d.netVAT)}
                            {d.isCredit && (
                              <span className="ml-1 text-xs text-emerald-600">(crédit)</span>
                            )}
                          </td>
                          <td className="p-3 text-sm text-gray-500">
                            {d.submissionDate ? formatDate(d.submissionDate) : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
