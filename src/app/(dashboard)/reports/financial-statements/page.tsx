"use client";

import { useState, useEffect, useCallback } from "react";
import { useAppContext } from "@/hooks/useAppContext";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Download, Printer } from "lucide-react";
import { formatMAD } from "@/lib/utils/currency";
import { toast } from "sonner";

interface BilanActif {
  immobilisations: { brut: string; amortissement: string; net: string };
  actifCirculant: { debit: string; credit: string; net: string };
  tresorerieActif: { debit: string; credit: string; net: string };
  totalActif: string;
}

interface BilanPassif {
  financementPermanent: { debit: string; credit: string; net: string };
  passifCirculant: { debit: string; credit: string; net: string };
  tresoreriePassif: { debit: string; credit: string; net: string };
  totalPassif: string;
}

interface CPCData {
  produitsExploitation: string;
  chargesExploitation: string;
  resultatExploitation: string;
  produitsFinanciers: string;
  chargesFinancieres: string;
  resultatFinancier: string;
  resultatCourant: string;
  produitsNonCourants: string;
  chargesNonCourantes: string;
  resultatNonCourant: string;
  impotsSurResultats: string;
  resultatNet: string;
}

interface FinancialData {
  bilan: { actif: BilanActif; passif: BilanPassif };
  cpc: CPCData;
}

function AmountCell({ value, bold, highlight }: { value: string; bold?: boolean; highlight?: "positive" | "negative" | "neutral" }) {
  const num = parseFloat(value);
  let colorClass = "text-gray-900";
  if (highlight === "positive") colorClass = num >= 0 ? "text-emerald-700" : "text-red-600";
  if (highlight === "negative") colorClass = num > 0 ? "text-red-600" : "text-gray-900";
  return (
    <td className={`p-3 text-right font-mono text-sm ${bold ? "font-bold" : ""} ${colorClass}`}>
      {formatMAD(value)}
    </td>
  );
}

function SectionRow({ label, bold }: { label: string; bold?: boolean }) {
  return (
    <tr className="bg-gray-100">
      <td colSpan={3} className={`p-3 text-sm uppercase tracking-wide text-gray-700 ${bold ? "font-bold" : "font-semibold"}`}>
        {label}
      </td>
    </tr>
  );
}

function DataRow({ label, value, bold, highlight }: { label: string; value: string; bold?: boolean; highlight?: "positive" | "negative" | "neutral" }) {
  return (
    <tr className={`border-t ${bold ? "bg-gray-50" : "hover:bg-gray-50"}`}>
      <td className={`p-3 text-sm ${bold ? "font-bold" : ""} pl-6`} colSpan={2}>
        {label}
      </td>
      <AmountCell value={value} bold={bold} highlight={highlight} />
    </tr>
  );
}

function TotalRow({ label, value }: { label: string; value: string }) {
  const num = parseFloat(value);
  return (
    <tr className="border-t-2 border-gray-800 bg-gray-200">
      <td className="p-3 text-sm font-bold uppercase" colSpan={2}>
        {label}
      </td>
      <td className={`p-3 text-right font-mono text-sm font-bold ${num >= 0 ? "text-gray-900" : "text-red-600"}`}>
        {formatMAD(value)}
      </td>
    </tr>
  );
}

export default function FinancialStatementsPage() {
  const { currentCompanyId, currentFiscalYearId, fiscalYears } = useAppContext();

  const [data, setData] = useState<FinancialData | null>(null);
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

      const res = await fetch(`/api/reports/financial-statements?${params}`);
      if (!res.ok) throw new Error("Erreur lors du chargement");
      const json = await res.json();
      setData(json);
    } catch {
      toast.error("Erreur lors du chargement des états financiers");
    } finally {
      setLoading(false);
    }
  }, [currentCompanyId, currentFiscalYearId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handlePrint = () => window.print();

  const handleExportCSV = () => {
    if (!data) return;
    const { bilan, cpc } = data;
    const rows = [
      "BILAN ACTIF",
      `Immobilisations brutes;${bilan.actif.immobilisations.brut}`,
      `Amortissements;${bilan.actif.immobilisations.amortissement}`,
      `Actif immobilisé net;${bilan.actif.immobilisations.net}`,
      `Actif circulant;${bilan.actif.actifCirculant.net}`,
      `Trésorerie actif;${bilan.actif.tresorerieActif.net}`,
      `TOTAL ACTIF;${bilan.actif.totalActif}`,
      "",
      "BILAN PASSIF",
      `Financement permanent;${bilan.passif.financementPermanent.net}`,
      `Passif circulant;${bilan.passif.passifCirculant.net}`,
      `Trésorerie passif;${bilan.passif.tresoreriePassif.net}`,
      `TOTAL PASSIF;${bilan.passif.totalPassif}`,
      "",
      "CPC",
      `Produits d'exploitation;${cpc.produitsExploitation}`,
      `Charges d'exploitation;${cpc.chargesExploitation}`,
      `Résultat d'exploitation;${cpc.resultatExploitation}`,
      `Produits financiers;${cpc.produitsFinanciers}`,
      `Charges financières;${cpc.chargesFinancieres}`,
      `Résultat financier;${cpc.resultatFinancier}`,
      `Résultat courant;${cpc.resultatCourant}`,
      `Produits non courants;${cpc.produitsNonCourants}`,
      `Charges non courantes;${cpc.chargesNonCourantes}`,
      `Résultat non courant;${cpc.resultatNonCourant}`,
      `Impôts sur résultats;${cpc.impotsSurResultats}`,
      `RÉSULTAT NET;${cpc.resultatNet}`,
    ];
    const csv = rows.join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `etats_financiers_${fiscalYear?.label ?? "exercice"}.csv`;
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

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">États Financiers</h1>
          {fiscalYear && (
            <p className="text-sm text-gray-500 mt-1">
              Exercice : {fiscalYear.label}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleExportCSV} disabled={!data}>
            <Download className="h-4 w-4 mr-2" /> Exporter CSV
          </Button>
          <Button variant="outline" size="sm" onClick={handlePrint}>
            <Printer className="h-4 w-4 mr-2" /> Imprimer
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="p-12 text-center text-gray-400">Chargement...</div>
      ) : !data ? (
        <div className="p-12 text-center text-gray-400">Aucune donnée disponible</div>
      ) : (
        <Tabs defaultValue="bilan">
          <TabsList className="mb-6">
            <TabsTrigger value="bilan">Bilan</TabsTrigger>
            <TabsTrigger value="cpc">CPC</TabsTrigger>
          </TabsList>

          {/* ── BILAN ── */}
          <TabsContent value="bilan">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* ACTIF */}
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full">
                  <thead className="bg-blue-600 text-white">
                    <tr>
                      <th className="p-3 text-left text-sm font-bold uppercase" colSpan={2}>
                        ACTIF
                      </th>
                      <th className="p-3 text-right text-sm font-bold uppercase">
                        Montant (MAD)
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <SectionRow label="Actif immobilisé (comptes 2x)" />
                    <DataRow label="Immobilisations brutes" value={data.bilan.actif.immobilisations.brut} />
                    <DataRow label="Amortissements et provisions" value={data.bilan.actif.immobilisations.amortissement} />
                    <DataRow label="Actif immobilisé net" value={data.bilan.actif.immobilisations.net} bold />

                    <SectionRow label="Actif circulant (comptes 3x)" />
                    <DataRow label="Stocks, créances et autres" value={data.bilan.actif.actifCirculant.net} bold />

                    <SectionRow label="Trésorerie actif (comptes 51x)" />
                    <DataRow label="Disponibilités et équivalents" value={data.bilan.actif.tresorerieActif.net} bold />

                    <TotalRow label="Total Actif" value={data.bilan.actif.totalActif} />
                  </tbody>
                </table>
              </div>

              {/* PASSIF */}
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full">
                  <thead className="bg-emerald-600 text-white">
                    <tr>
                      <th className="p-3 text-left text-sm font-bold uppercase" colSpan={2}>
                        PASSIF
                      </th>
                      <th className="p-3 text-right text-sm font-bold uppercase">
                        Montant (MAD)
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <SectionRow label="Financement permanent (comptes 1x)" />
                    <DataRow label="Capitaux propres et dettes LT" value={data.bilan.passif.financementPermanent.net} bold />

                    <SectionRow label="Passif circulant (comptes 4x)" />
                    <DataRow label="Dettes fournisseurs et autres" value={data.bilan.passif.passifCirculant.net} bold />

                    <SectionRow label="Trésorerie passif (comptes 55x)" />
                    <DataRow label="Crédits de trésorerie" value={data.bilan.passif.tresoreriePassif.net} bold />

                    <TotalRow label="Total Passif" value={data.bilan.passif.totalPassif} />
                  </tbody>
                </table>
              </div>
            </div>

            {/* Equilibre check */}
            {(() => {
              const diff = Math.abs(
                parseFloat(data.bilan.actif.totalActif) -
                parseFloat(data.bilan.passif.totalPassif)
              );
              return diff > 0.05 ? (
                <p className="mt-4 text-sm text-red-500 text-right">
                  Attention : déséquilibre bilan de {formatMAD(diff)} MAD
                </p>
              ) : (
                <p className="mt-4 text-sm text-emerald-600 text-right">
                  Bilan équilibré
                </p>
              );
            })()}
          </TabsContent>

          {/* ── CPC ── */}
          <TabsContent value="cpc">
            <div className="border rounded-lg overflow-hidden max-w-2xl">
              <table className="w-full">
                <thead className="bg-purple-600 text-white">
                  <tr>
                    <th className="p-3 text-left text-sm font-bold uppercase">
                      Compte de Produits et Charges (CPC)
                    </th>
                    <th className="p-3 text-right text-sm font-bold uppercase">
                      Montant (MAD)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <SectionRow label="Exploitation (comptes 71x / 61x)" />
                  <tr className="border-t hover:bg-gray-50">
                    <td className="p-3 text-sm pl-6">Produits d&apos;exploitation</td>
                    <td className="p-3 text-right font-mono text-sm text-emerald-700">{formatMAD(data.cpc.produitsExploitation)}</td>
                  </tr>
                  <tr className="border-t hover:bg-gray-50">
                    <td className="p-3 text-sm pl-6">Charges d&apos;exploitation</td>
                    <td className="p-3 text-right font-mono text-sm text-red-600">{formatMAD(data.cpc.chargesExploitation)}</td>
                  </tr>
                  <tr className="border-t bg-gray-50">
                    <td className="p-3 text-sm font-bold pl-6">Résultat d&apos;exploitation</td>
                    <td className={`p-3 text-right font-mono text-sm font-bold ${parseFloat(data.cpc.resultatExploitation) >= 0 ? "text-emerald-700" : "text-red-600"}`}>
                      {formatMAD(data.cpc.resultatExploitation)}
                    </td>
                  </tr>

                  <SectionRow label="Financier (comptes 73x / 63x)" />
                  <tr className="border-t hover:bg-gray-50">
                    <td className="p-3 text-sm pl-6">Produits financiers</td>
                    <td className="p-3 text-right font-mono text-sm text-emerald-700">{formatMAD(data.cpc.produitsFinanciers)}</td>
                  </tr>
                  <tr className="border-t hover:bg-gray-50">
                    <td className="p-3 text-sm pl-6">Charges financières</td>
                    <td className="p-3 text-right font-mono text-sm text-red-600">{formatMAD(data.cpc.chargesFinancieres)}</td>
                  </tr>
                  <tr className="border-t bg-gray-50">
                    <td className="p-3 text-sm font-bold pl-6">Résultat financier</td>
                    <td className={`p-3 text-right font-mono text-sm font-bold ${parseFloat(data.cpc.resultatFinancier) >= 0 ? "text-emerald-700" : "text-red-600"}`}>
                      {formatMAD(data.cpc.resultatFinancier)}
                    </td>
                  </tr>

                  <tr className="border-t-2 border-gray-400 bg-gray-100">
                    <td className="p-3 text-sm font-bold uppercase">Résultat courant</td>
                    <td className={`p-3 text-right font-mono text-sm font-bold ${parseFloat(data.cpc.resultatCourant) >= 0 ? "text-emerald-700" : "text-red-600"}`}>
                      {formatMAD(data.cpc.resultatCourant)}
                    </td>
                  </tr>

                  <SectionRow label="Non courant (comptes 75x / 65x)" />
                  <tr className="border-t hover:bg-gray-50">
                    <td className="p-3 text-sm pl-6">Produits non courants</td>
                    <td className="p-3 text-right font-mono text-sm text-emerald-700">{formatMAD(data.cpc.produitsNonCourants)}</td>
                  </tr>
                  <tr className="border-t hover:bg-gray-50">
                    <td className="p-3 text-sm pl-6">Charges non courantes</td>
                    <td className="p-3 text-right font-mono text-sm text-red-600">{formatMAD(data.cpc.chargesNonCourantes)}</td>
                  </tr>
                  <tr className="border-t bg-gray-50">
                    <td className="p-3 text-sm font-bold pl-6">Résultat non courant</td>
                    <td className={`p-3 text-right font-mono text-sm font-bold ${parseFloat(data.cpc.resultatNonCourant) >= 0 ? "text-emerald-700" : "text-red-600"}`}>
                      {formatMAD(data.cpc.resultatNonCourant)}
                    </td>
                  </tr>

                  <SectionRow label="Impôts (comptes 67x)" />
                  <tr className="border-t hover:bg-gray-50">
                    <td className="p-3 text-sm pl-6">Impôts sur résultats</td>
                    <td className="p-3 text-right font-mono text-sm text-red-600">{formatMAD(data.cpc.impotsSurResultats)}</td>
                  </tr>

                  <tr className="border-t-2 border-gray-800 bg-gray-200">
                    <td className="p-3 text-base font-bold uppercase">RÉSULTAT NET</td>
                    <td className={`p-3 text-right font-mono text-base font-bold ${parseFloat(data.cpc.resultatNet) >= 0 ? "text-emerald-700" : "text-red-600"}`}>
                      {formatMAD(data.cpc.resultatNet)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
