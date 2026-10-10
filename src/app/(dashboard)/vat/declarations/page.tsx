"use client";

import { useState, useEffect, useCallback } from "react";
import { useAppContext } from "@/hooks/useAppContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatMAD } from "@/lib/utils/currency";
import { toast } from "sonner";
import { Calculator, CheckCircle, RefreshCcw } from "lucide-react";

interface VATDeclaration {
  id: string;
  periodType: string;
  periodIndex: number;
  startDate: string;
  endDate: string;
  taxableRevenue20: string;
  taxableRevenue14: string;
  taxableRevenue10: string;
  taxableRevenue7: string;
  outputVAT20: string;
  outputVAT14: string;
  outputVAT10: string;
  outputVAT7: string;
  totalOutputVAT: string;
  inputVATAssets: string;
  inputVATExpenses: string;
  totalInputVAT: string;
  previousCredit: string;
  netVAT: string;
  isCredit: boolean;
  status: string;
}

const monthNames = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"
];

const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  DRAFT: { label: "Brouillon", variant: "secondary" },
  COMPUTED: { label: "Calculée", variant: "outline" },
  VALIDATED: { label: "Validée", variant: "default" },
  SUBMITTED: { label: "Soumise", variant: "default" },
  PAID: { label: "Payée", variant: "default" },
};

export default function VATDeclarationsPage() {
  const { currentCompanyId, currentFiscalYearId } = useAppContext();
  const [declarations, setDeclarations] = useState<VATDeclaration[]>([]);
  const [selectedDeclaration, setSelectedDeclaration] = useState<VATDeclaration | null>(null);
  const [periodType, setPeriodType] = useState<"MONTHLY" | "QUARTERLY">("MONTHLY");
  const [computing, setComputing] = useState(false);

  const loadDeclarations = useCallback(async () => {
    if (!currentCompanyId || !currentFiscalYearId) return;
    try {
      const res = await fetch(
        `/api/vat?companyId=${currentCompanyId}&fiscalYearId=${currentFiscalYearId}`
      );
      if (res.ok) {
        const data = await res.json();
        setDeclarations(data);
        if (selectedDeclaration) {
          const updated = data.find((d: VATDeclaration) => d.id === selectedDeclaration.id);
          if (updated) setSelectedDeclaration(updated);
        }
      }
    } catch {
      // ignore
    }
  }, [currentCompanyId, currentFiscalYearId, selectedDeclaration]);

  useEffect(() => {
    loadDeclarations();
  }, [loadDeclarations]);

  const computeDeclaration = async (periodIndex: number, silent = false) => {
    if (!currentCompanyId || !currentFiscalYearId) return;
    setComputing(true);
    try {
      const res = await fetch("/api/vat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: currentCompanyId,
          fiscalYearId: currentFiscalYearId,
          periodType,
          periodIndex,
          regime: "DEBIT",
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (!silent) toast.success("Déclaration calculée avec succès");
        setSelectedDeclaration(data);
        loadDeclarations();
      } else {
        const err = await res.json();
        toast.error(err.error || "Erreur de calcul");
      }
    } catch {
      toast.error("Erreur de connexion");
    } finally {
      setComputing(false);
    }
  };

  const computeAllPeriods = async () => {
    setComputing(true);
    try {
      const periodsCount = periodType === "MONTHLY" ? 12 : 4;
      for (let i = 1; i <= periodsCount; i++) {
        // Find if it exists and is validated
        const decl = declarations.find((d) => d.periodIndex === i);
        if (!decl || decl.status === "DRAFT" || decl.status === "COMPUTED") {
          await computeDeclaration(i, true);
        }
      }
      toast.success("Année calculée avec succès");
      loadDeclarations();
    } finally {
      setComputing(false);
    }
  };

  const validateDeclaration = async (id: string) => {
    try {
      const res = await fetch(`/api/vat/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "validate" }),
      });
      if (res.ok) {
        toast.success("Déclaration validée");
        loadDeclarations();
      }
    } catch {
      toast.error("Erreur");
    }
  };

  if (!currentCompanyId || !currentFiscalYearId) {
    return <div className="p-6 text-gray-500">Veuillez sélectionner une société et un exercice.</div>;
  }

  const periods = periodType === "MONTHLY" ? 12 : 4;

  return (
    <div className="p-6 max-w-7xl mx-auto animate-in fade-in duration-500">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-linear-to-r from-primary to-secondary mb-1">Déclarations TVA</h1>
          <p className="text-muted-foreground font-medium">Gestion et calcul des déclarations de TVA.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={computeAllPeriods}
            disabled={computing}
            className="border-gray-300"
          >
            <RefreshCcw className={`h-4 w-4 mr-2 ${computing ? 'animate-spin' : ''}`} /> Calculer l&apos;année
          </Button>
          <Select value={periodType} onValueChange={(v) => v !== null && setPeriodType(v as "MONTHLY" | "QUARTERLY")}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="MONTHLY">Mensuel</SelectItem>
              <SelectItem value="QUARTERLY">Trimestriel</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Period list */}
        <div className="lg:col-span-1">
          <Card className="bg-card/60 backdrop-blur-md border border-border/50 shadow-sm overflow-hidden sticky top-6">
            <CardHeader className="bg-muted/20 border-b border-border/50 pb-4">
              <CardTitle className="text-lg font-semibold text-foreground">Périodes</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {Array.from({ length: periods }, (_, i) => {
                const idx = i + 1;
                const decl = declarations.find(
                  (d) => d.periodType === periodType && d.periodIndex === idx
                );
                const label = periodType === "MONTHLY" ? monthNames[i] : `T${idx}`;

                return (
                  <button
                    key={idx}
                    className={`w-full p-4 text-left border-b border-border/50 transition-colors flex items-center justify-between ${
                      selectedDeclaration?.periodIndex === idx ? "bg-primary/5 border-l-4 border-l-primary" : "hover:bg-muted/40"
                    }`}
                    onClick={() => {
                      if (!decl || decl.status === "DRAFT" || decl.status === "COMPUTED") {
                        computeDeclaration(idx, true);
                      } else {
                        setSelectedDeclaration(decl);
                      }
                    }}
                  >
                    <span className="font-medium text-sm">{label}</span>
                    <div className="flex items-center gap-2">
                      {decl ? (
                        <>
                          <span className={`text-sm font-mono ${decl.isCredit ? "text-green-600" : "text-red-600"}`}>
                            {decl.isCredit ? "-" : ""}{formatMAD(decl.netVAT)}
                          </span>
                          <Badge variant={statusConfig[decl.status]?.variant || "secondary"}>
                            {statusConfig[decl.status]?.label || decl.status}
                          </Badge>
                        </>
                      ) : (
                        <span className="text-xs text-gray-400">Non calculée</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </CardContent>
          </Card>
        </div>

        {/* Declaration detail */}
        <div className="lg:col-span-2">
          {selectedDeclaration ? (
            <Card className="bg-card/60 backdrop-blur-xl border border-border/50 shadow-sm overflow-hidden animate-in slide-in-from-right-4 duration-300">
              <CardHeader className="bg-muted/20 border-b border-border/50 pb-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <CardTitle className="text-xl text-foreground">
                    {periodType === "MONTHLY"
                      ? monthNames[selectedDeclaration.periodIndex - 1]
                      : `Trimestre ${selectedDeclaration.periodIndex}`}
                  </CardTitle>
                  <div className="flex flex-wrap gap-2">
                    {(!selectedDeclaration.status || selectedDeclaration.status === "DRAFT" || selectedDeclaration.status === "COMPUTED") && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => computeDeclaration(selectedDeclaration.periodIndex)}
                        disabled={computing}
                      >
                        <RefreshCcw className="h-4 w-4 mr-1" /> Recalculer
                      </Button>
                    )}
                    {selectedDeclaration.status === "COMPUTED" && (
                      <Button
                        size="sm"
                        onClick={() => validateDeclaration(selectedDeclaration.id)}
                        className="bg-green-600 hover:bg-green-700"
                      >
                        <CheckCircle className="h-4 w-4 mr-1" /> Valider
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-6">
                {/* Output VAT */}
                <div className="mb-8">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="h-6 w-1 bg-primary rounded-full"></div>
                    <h3 className="text-sm font-bold text-foreground uppercase tracking-wider">
                      Chiffre d&apos;affaires &amp; TVA collectée
                    </h3>
                  </div>
                  <div className="rounded-md border border-border/50 overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50">
                        <tr className="border-b border-border/50 text-muted-foreground">
                          <th className="py-3 px-4 text-left font-semibold">Taux</th>
                          <th className="py-3 px-4 text-right font-semibold">Base HT</th>
                          <th className="py-3 px-4 text-right font-semibold">TVA</th>
                        </tr>
                      </thead>
                    <tbody>
                      {[
                        { label: "Ventes à 20%", ht: selectedDeclaration.taxableRevenue20, vat: selectedDeclaration.outputVAT20 },
                        { label: "Ventes à 14%", ht: selectedDeclaration.taxableRevenue14, vat: selectedDeclaration.outputVAT14 },
                        { label: "Ventes à 10%", ht: selectedDeclaration.taxableRevenue10, vat: selectedDeclaration.outputVAT10 },
                        { label: "Ventes à 7%", ht: selectedDeclaration.taxableRevenue7, vat: selectedDeclaration.outputVAT7 },
                      ].map((row) => (
                        <tr key={row.label} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                          <td className="py-3 px-4 text-foreground font-medium">{row.label}</td>
                          <td className="py-3 px-4 text-right font-mono text-muted-foreground">{formatMAD(row.ht)}</td>
                          <td className="py-3 px-4 text-right font-mono text-foreground">{formatMAD(row.vat)}</td>
                        </tr>
                      ))}
                      <tr className="font-bold bg-muted/30">
                        <td className="py-3 px-4 text-foreground">Total TVA collectée</td>
                        <td className="py-3 px-4"></td>
                        <td className="py-3 px-4 text-right font-mono text-primary">{formatMAD(selectedDeclaration.totalOutputVAT)}</td>
                      </tr>
                    </tbody>
                  </table>
                  </div>
                </div>

                {/* Input VAT */}
                <div className="mb-8">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="h-6 w-1 bg-secondary rounded-full"></div>
                    <h3 className="text-sm font-bold text-foreground uppercase tracking-wider">
                      TVA déductible
                    </h3>
                  </div>
                  <div className="rounded-md border border-border/50 overflow-hidden">
                  <table className="w-full text-sm">
                    <tbody>
                      <tr className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                        <td className="py-3 px-4 text-foreground font-medium">Sur immobilisations</td>
                        <td className="py-3 px-4 text-right font-mono text-foreground">{formatMAD(selectedDeclaration.inputVATAssets)}</td>
                      </tr>
                      <tr className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                        <td className="py-3 px-4 text-foreground font-medium">Sur charges</td>
                        <td className="py-3 px-4 text-right font-mono text-foreground">{formatMAD(selectedDeclaration.inputVATExpenses)}</td>
                      </tr>
                      <tr className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                        <td className="py-3 px-4 text-foreground font-medium">Crédit reporté</td>
                        <td className="py-3 px-4 text-right font-mono text-emerald-600">{formatMAD(selectedDeclaration.previousCredit)}</td>
                      </tr>
                      <tr className="font-bold bg-muted/30">
                        <td className="py-3 px-4 text-foreground">Total TVA déductible</td>
                        <td className="py-3 px-4 text-right font-mono text-secondary">{formatMAD(selectedDeclaration.totalInputVAT)}</td>
                      </tr>
                    </tbody>
                  </table>
                  </div>
                </div>

                {/* Net */}
                <div className={`p-6 rounded-xl text-center border shadow-sm ${
                  selectedDeclaration.isCredit 
                    ? "bg-emerald-500/10 border-emerald-500/20" 
                    : "bg-red-500/10 border-red-500/20"
                }`}>
                  <p className={`text-sm font-medium mb-2 ${
                    selectedDeclaration.isCredit ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"
                  }`}>
                    {selectedDeclaration.isCredit ? "Crédit de TVA reportable" : "TVA due à payer"}
                  </p>
                  <p className={`text-4xl font-bold font-mono tracking-tight ${
                    selectedDeclaration.isCredit ? "text-emerald-600 dark:text-emerald-500" : "text-red-600 dark:text-red-500"
                  }`}>
                    {formatMAD(selectedDeclaration.netVAT)} MAD
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card className="bg-card/60 backdrop-blur-md border border-dashed border-border/50 shadow-sm">
              <CardContent className="flex flex-col items-center justify-center h-125 text-muted-foreground gap-4">
                <div className="p-4 bg-muted/50 rounded-full">
                  <Calculator className="h-12 w-12 text-primary/50" />
                </div>
                <p className="text-center font-medium">Sélectionnez une période dans la liste <br />pour voir ou calculer la déclaration TVA</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
