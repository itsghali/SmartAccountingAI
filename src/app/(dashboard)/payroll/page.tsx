"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  FileSearch,
  Loader2,
  Play,
  ShieldCheck,
  Users,
  AlertTriangle,
} from "lucide-react";
import { useAppContext } from "@/hooks/useAppContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AIAgentBanner } from "@/components/ui/ai-agent-banner";


interface PayrollSuggestion {
  type: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  description: string;
  affectedEmployee?: string;
  suggestedAction: string;
  confidence: number;
}

interface PayrollRun {
  id: string;
  status: string;
  createdAt: string;
  completedAt: string | null;
  durationMs: number | null;
  modelVersion: string;
}

interface PayrollAnalysisResult {
  fiscalYearId: string;
  summary: string;
  suggestions: PayrollSuggestion[];
  runId: string;
  modelVersion: string;
  durationMs: number;
}

function severityBadge(severity: string) {
  const classes: Record<string, string> = {
    CRITICAL: "bg-red-100 text-red-700 border-red-200",
    HIGH: "bg-orange-100 text-orange-700 border-orange-200",
    MEDIUM: "bg-yellow-100 text-yellow-700 border-yellow-200",
    LOW: "bg-blue-100 text-blue-700 border-blue-200",
  };
  return (
    <Badge variant="outline" className={classes[severity] ?? classes.LOW}>
      {severity}
    </Badge>
  );
}

function formatDateTime(value: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

export default function PayrollPage() {
  const { currentCompanyId: companyId, currentFiscalYearId } = useAppContext();
  const queryClient = useQueryClient();

  const [rawAnalysisResult, setAnalysisResult] = useState<PayrollAnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetch previous PAYROLL_SUPPORT runs
  const { data: agentRuns = [], isLoading: isLoadingRuns } = useQuery({
    queryKey: ["payroll-runs", companyId, currentFiscalYearId],
    queryFn: async () => {
      if (!companyId || !currentFiscalYearId) return [];
      const res = await fetch(`/api/agent-runs?companyId=${companyId}&fiscalYearId=${currentFiscalYearId}&agentType=PAYROLL_SUPPORT&limit=10`);
      if (!res.ok) return [];
      const data = await res.json();
      return (data.runs ?? []) as PayrollRun[];
    },
    enabled: !!companyId && !!currentFiscalYearId,
  });

  // Fetch pending PAYROLL_SUPPORT suggestions
  const { data: pendingSuggestions = [] } = useQuery({
    queryKey: ["payroll-suggestions", companyId, currentFiscalYearId],
    queryFn: async () => {
      if (!companyId || !currentFiscalYearId) return [];
      const res = await fetch(`/api/suggestions?companyId=${companyId}&fiscalYearId=${currentFiscalYearId}&agentType=PAYROLL_SUPPORT&status=PENDING`);
      if (!res.ok) return [];
      const data = await res.json();
      return data.suggestions ?? [];
    },
    enabled: !!companyId && !!currentFiscalYearId,
  });

  const analyzeMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/payroll/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          fiscalYearId: currentFiscalYearId,
          userPrompt:
            "Analysez les données de paie actuelles pour détecter les anomalies, exceptions et schémas inhabituels. Vérifiez : variations de salaire hors plage attendue, indemnités dupliquées ou manquantes, heures supplémentaires anormales, écarts de net à payer par rapport aux périodes précédentes, incohérences dans les cotisations (CNSS, AMO, IGR), données manquantes pour l'exécution de la paie.",
        }),
      });
      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload.error || "L'analyse a échoué");
      }
      return payload as PayrollAnalysisResult;
    },
    onSuccess: (data) => {
      setAnalysisResult(data);
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["payroll-runs"] });
      queryClient.invalidateQueries({ queryKey: ["payroll-suggestions"] });
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : "L'analyse a échoué");
    },
  });

  if (!companyId) {
    return (
      <div className="p-6 max-w-7xl mx-auto animate-in fade-in duration-500">
        <div className="rounded-xl border border-dashed border-border/50 bg-card/30 backdrop-blur-sm p-12 text-center max-w-2xl mx-auto mt-12">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-muted/50 mb-6">
            <ShieldCheck className="h-10 w-10 text-muted-foreground" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">Gestion de Paie</h1>
          <p className="mt-2 text-muted-foreground">
            Sélectionnez une société pour accéder au module de paie.
          </p>
        </div>
      </div>
    );
  }

  if (!currentFiscalYearId) {
    return (
      <div className="p-6 max-w-7xl mx-auto animate-in fade-in duration-500">
        <div className="rounded-xl border border-dashed border-border/50 bg-card/30 backdrop-blur-sm p-12 text-center max-w-2xl mx-auto mt-12">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-muted/50 mb-6">
            <ShieldCheck className="h-10 w-10 text-muted-foreground" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">Gestion de Paie</h1>
          <p className="mt-2 text-muted-foreground">
            Sélectionnez un exercice pour afficher les analyses de paie.
          </p>
        </div>
      </div>
    );
  }

  const analysisResult =
    rawAnalysisResult?.fiscalYearId === currentFiscalYearId
      ? rawAnalysisResult
      : null;
  const criticalCount = analysisResult?.suggestions.filter((s) => s.severity === "CRITICAL").length ?? 0;
  const highCount = analysisResult?.suggestions.filter((s) => s.severity === "HIGH").length ?? 0;
  const totalAlerts = analysisResult?.suggestions.length ?? pendingSuggestions.length;

  return (
    <div className="space-y-8 p-6 max-w-7xl mx-auto animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-linear-to-r from-primary to-secondary mb-1">
            Gestion de Paie
          </h1>
          <p className="text-muted-foreground font-medium">
            Agent 4 — Détection d&apos;anomalies et exceptions de paie
          </p>
        </div>
        <Button
          onClick={() => analyzeMutation.mutate()}
          disabled={analyzeMutation.isPending}
          className="gap-2"
        >
          {analyzeMutation.isPending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Analyse en cours...
            </>
          ) : (
            <>
              <Play className="h-4 w-4" />
              Lancer l&apos;analyse
            </>
          )}
        </Button>
      </div>

      {/* Error */}
      {error && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="flex items-center gap-3 pt-6">
            <AlertCircle className="h-5 w-5 shrink-0 text-red-600" />
            <div>
              <p className="font-medium text-red-900">Erreur</p>
              <p className="text-sm text-red-700">{error}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Summary Cards */}
      <div className="grid gap-6 md:grid-cols-4">
        <Card className="bg-card/60 backdrop-blur-md border border-border/50 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Analyses</CardTitle>
            <div className="p-2 bg-primary/10 rounded-full">
              <FileSearch className="h-4 w-4 text-primary" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold font-mono">{agentRuns.length}</div>
            <p className="text-xs text-muted-foreground mt-1">Exécutions de l&apos;agent</p>
          </CardContent>
        </Card>

        <Card className="bg-card/60 backdrop-blur-md border border-border/50 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Anomalies Critiques</CardTitle>
            <div className="p-2 bg-red-500/10 rounded-full">
              <AlertCircle className="h-4 w-4 text-red-500" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold font-mono text-red-600 dark:text-red-400">{criticalCount || "-"}</div>
            <p className="text-xs text-muted-foreground mt-1">Attention immédiate</p>
          </CardContent>
        </Card>

        <Card className="bg-card/60 backdrop-blur-md border border-border/50 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Anomalies Élevées</CardTitle>
            <div className="p-2 bg-orange-500/10 rounded-full">
              <AlertTriangle className="h-4 w-4 text-orange-500" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold font-mono text-orange-600 dark:text-orange-400">{highCount || "-"}</div>
            <p className="text-xs text-muted-foreground mt-1">À vérifier avant validation</p>
          </CardContent>
        </Card>

        <Card className="bg-card/60 backdrop-blur-md border border-border/50 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Alertes Totales</CardTitle>
            <div className="p-2 bg-blue-500/10 rounded-full">
              <Users className="h-4 w-4 text-blue-500" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold font-mono">{totalAlerts || "-"}</div>
            <p className="text-xs text-muted-foreground mt-1">Suggestions en attente</p>
          </CardContent>
        </Card>
      </div>

      {/* Analysis Results */}
      {analysisResult && (
        <Card className="bg-card/60 backdrop-blur-xl border border-border/50 shadow-sm overflow-hidden">
          <CardHeader className="bg-muted/30 border-b border-border/50">
            <CardTitle>Résultats de l&apos;analyse</CardTitle>
            <p className="text-sm text-muted-foreground">{analysisResult.summary}</p>
            <p className="text-xs text-muted-foreground mt-2 font-mono">
              Modèle : <span className="text-primary">{analysisResult.modelVersion}</span> · Durée : {analysisResult.durationMs}ms
            </p>
          </CardHeader>
          <CardContent className="p-0">
            {analysisResult.suggestions.length === 0 ? (
              <div className="p-8">
                <Card className="border-emerald-200/50 bg-emerald-50/50 dark:bg-emerald-950/20 backdrop-blur-md shadow-sm">
                  <CardContent className="flex items-center gap-4 pt-6">
                    <div className="p-3 bg-emerald-100 dark:bg-emerald-900/50 rounded-full">
                      <CheckCircle2 className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
                    </div>
                    <div>
                      <p className="text-lg font-semibold text-emerald-900 dark:text-emerald-300">Aucune anomalie détectée</p>
                      <p className="text-emerald-700 dark:text-emerald-400">
                        L&apos;analyse n&apos;a pas identifié d&apos;exceptions dans les données de paie.
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </div>
            ) : (
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="font-semibold">Sévérité</TableHead>
                    <TableHead className="font-semibold">Type</TableHead>
                    <TableHead className="font-semibold">Description</TableHead>
                    <TableHead className="font-semibold">Employé</TableHead>
                    <TableHead className="font-semibold">Action suggérée</TableHead>
                    <TableHead className="font-semibold">Confiance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {analysisResult.suggestions.map((s, i) => (
                    <TableRow key={i} className="hover:bg-muted/40 transition-colors border-border/50">
                      <TableCell>{severityBadge(s.severity)}</TableCell>
                      <TableCell className="font-medium">{s.type}</TableCell>
                      <TableCell className="max-w-75 whitespace-normal text-muted-foreground">{s.description}</TableCell>
                      <TableCell className="font-medium">{s.affectedEmployee ?? "-"}</TableCell>
                      <TableCell className="max-w-62.5 whitespace-normal text-sm text-muted-foreground bg-muted/20">
                        {s.suggestedAction}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="bg-background">{Math.round(s.confidence * 100)}%</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {/* Run History */}
      <Card className="bg-card/60 backdrop-blur-xl border border-border/50 shadow-sm overflow-hidden">
        <CardHeader className="flex flex-row items-center justify-between bg-muted/30 border-b border-border/50">
          <div>
            <CardTitle>Historique des analyses</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Exécutions précédentes de l&apos;Agent 4
            </p>
          </div>
          <Badge variant="outline" className="bg-background">{agentRuns.length} exécution(s)</Badge>
        </CardHeader>
        <CardContent className="p-0">
          {isLoadingRuns ? (
            <div className="p-12 text-center text-muted-foreground font-medium animate-pulse">Chargement...</div>
          ) : agentRuns.length === 0 ? (
            <div className="p-16 text-center">
              <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-muted/50 mb-6">
                <Clock className="h-10 w-10 text-muted-foreground" />
              </div>
              <h2 className="text-xl font-medium text-foreground">Aucune analyse effectuée</h2>
              <p className="mt-2 text-muted-foreground">
                Lancez une analyse pour détecter les anomalies de paie.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead className="font-semibold">Date</TableHead>
                  <TableHead className="font-semibold">Statut</TableHead>
                  <TableHead className="font-semibold">Modèle</TableHead>
                  <TableHead className="font-semibold">Durée</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {agentRuns.map((run) => (
                  <TableRow key={run.id} className="hover:bg-muted/40 transition-colors border-border/50">
                    <TableCell className="text-muted-foreground">{formatDateTime(run.createdAt)}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          run.status === "COMPLETED"
                            ? "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800"
                            : run.status === "FAILED"
                              ? "bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800"
                              : "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800"
                        }
                      >
                        {run.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{run.modelVersion}</TableCell>
                    <TableCell className="font-mono text-sm">{run.durationMs ? `${run.durationMs}ms` : "-"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Info Card */}
      {!analysisResult && !analyzeMutation.isPending && (
        <AIAgentBanner 
          title="Assistant de Paie & Conformité"
          description="J'assiste la préparation de la paie en détectant les anomalies et exceptions. J'analyse les variations de salaire, les heures supplémentaires et les écarts de net à payer par rapport aux périodes précédentes. Les calculs finaux restent toujours sous le contrôle du moteur déterministe."
          capabilities={["Détection d'écarts de paie", "Analyse des cotisations", "Vérification des doublons"]}
        />
      )}
    </div>
  );
}
