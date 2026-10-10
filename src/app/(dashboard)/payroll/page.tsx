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
      <div className="p-6">
        <div className="rounded-lg border border-dashed p-10 text-center">
          <ShieldCheck className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
          <h1 className="text-xl font-semibold">Gestion de Paie</h1>
          <p className="mt-2 text-muted-foreground">
            Sélectionnez une société pour accéder au module de paie.
          </p>
        </div>
      </div>
    );
  }

  if (!currentFiscalYearId) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-dashed p-10 text-center">
          <ShieldCheck className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
          <h1 className="text-xl font-semibold">Gestion de Paie</h1>
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
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Gestion de Paie</h1>
          <p className="text-muted-foreground">
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
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Analyses</CardTitle>
            <FileSearch className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{agentRuns.length}</div>
            <p className="text-xs text-muted-foreground">Exécutions de l&apos;agent</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Anomalies Critiques</CardTitle>
            <AlertCircle className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{criticalCount || "-"}</div>
            <p className="text-xs text-muted-foreground">Attention immédiate</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Anomalies Élevées</CardTitle>
            <AlertTriangle className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{highCount || "-"}</div>
            <p className="text-xs text-muted-foreground">À vérifier avant validation</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Alertes Totales</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalAlerts || "-"}</div>
            <p className="text-xs text-muted-foreground">Suggestions en attente</p>
          </CardContent>
        </Card>
      </div>

      {/* Analysis Results */}
      {analysisResult && (
        <Card>
          <CardHeader>
            <CardTitle>Résultats de l&apos;analyse</CardTitle>
            <p className="text-sm text-muted-foreground">{analysisResult.summary}</p>
            <p className="text-xs text-muted-foreground">
              Modèle : {analysisResult.modelVersion} · Durée : {analysisResult.durationMs}ms
            </p>
          </CardHeader>
          <CardContent>
            {analysisResult.suggestions.length === 0 ? (
              <Card className="border-green-200 bg-green-50">
                <CardContent className="flex items-center gap-3 pt-6">
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                  <div>
                    <p className="font-medium text-green-900">Aucune anomalie détectée</p>
                    <p className="text-sm text-green-700">
                      L&apos;analyse n&apos;a pas identifié d&apos;exceptions dans les données de paie.
                    </p>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Sévérité</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Employé</TableHead>
                    <TableHead>Action suggérée</TableHead>
                    <TableHead>Confiance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {analysisResult.suggestions.map((s, i) => (
                    <TableRow key={i}>
                      <TableCell>{severityBadge(s.severity)}</TableCell>
                      <TableCell className="font-medium">{s.type}</TableCell>
                      <TableCell className="max-w-[300px] whitespace-normal">{s.description}</TableCell>
                      <TableCell>{s.affectedEmployee ?? "-"}</TableCell>
                      <TableCell className="max-w-[250px] whitespace-normal text-xs text-muted-foreground">
                        {s.suggestedAction}
                      </TableCell>
                      <TableCell>{Math.round(s.confidence * 100)}%</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {/* Run History */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Historique des analyses</CardTitle>
            <p className="text-sm text-muted-foreground">
              Exécutions précédentes de l&apos;Agent 4
            </p>
          </div>
          <Badge variant="outline">{agentRuns.length} exécution(s)</Badge>
        </CardHeader>
        <CardContent className="p-0">
          {isLoadingRuns ? (
            <div className="p-6 text-sm text-muted-foreground">Chargement...</div>
          ) : agentRuns.length === 0 ? (
            <div className="p-10 text-center">
              <Clock className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
              <h2 className="text-lg font-semibold">Aucune analyse effectuée</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Lancez une analyse pour détecter les anomalies de paie.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead>Modèle</TableHead>
                  <TableHead>Durée</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {agentRuns.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell>{formatDateTime(run.createdAt)}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          run.status === "COMPLETED"
                            ? "bg-green-100 text-green-700"
                            : run.status === "FAILED"
                              ? "bg-red-100 text-red-700"
                              : "bg-amber-100 text-amber-700"
                        }
                      >
                        {run.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{run.modelVersion}</TableCell>
                    <TableCell>{run.durationMs ? `${run.durationMs}ms` : "-"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Info Card */}
      {!analysisResult && !analyzeMutation.isPending && (
        <Card className="bg-muted/50">
          <CardContent className="pt-6">
            <div className="flex items-start gap-4">
              <Users className="h-8 w-8 shrink-0 text-primary" />
              <div className="space-y-2">
                <h3 className="font-semibold">Agent 4 — Payroll Support</h3>
                <p className="text-sm text-muted-foreground">
                  Cet agent assiste la préparation de la paie en détectant les anomalies
                  et exceptions sans effectuer les calculs finaux. Il analyse :
                </p>
                <ul className="text-sm text-muted-foreground list-disc list-inside space-y-1">
                  <li>Variations de salaire anormales</li>
                  <li>Heures supplémentaires inhabituelles</li>
                  <li>Écarts de net à payer par rapport aux périodes précédentes</li>
                  <li>Incohérences dans les cotisations (CNSS, AMO, IGR)</li>
                  <li>Données manquantes ou duplications</li>
                </ul>
                <p className="text-sm text-muted-foreground mt-2">
                  Les calculs de paie officiels restent sous le contrôle du moteur déterministe.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
