"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeftRight,
  CheckCircle2,
  Clock,
  Copy,
  FileSearch,
  FileSpreadsheet,
  FileText,
  History,
  Loader2,
  Lock,
  LockOpen,
  Play,
  Scale,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { useAppContext } from "@/hooks/useAppContext";
import { formatMADWithCurrency } from "@/lib/utils/currency";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AIAgentBanner } from "@/components/ui/ai-agent-banner";


type Severity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

interface ConsistencyCheck {
  type: "CONSISTENCY_CHECK";
  title: string;
  description: string;
  area:
    | "GENERAL_LEDGER"
    | "TRIAL_BALANCE"
    | "FINANCIAL_STATEMENTS"
    | "OPEN_ITEMS"
    | "RECONCILIATION"
    | "VAT"
    | "FIXED_ASSETS"
    | "CLOSING_ENTRIES"
    | "REPORTING"
    | "GENERAL";
  status: "PASS" | "WARN" | "FAIL";
  severity: Severity;
  evidence: string[];
  recommendedAction: string;
  metrics?: Record<string, number>;
  confidence: number;
}

interface ReconciliationPrompt {
  type: "RECONCILIATION_PROMPT";
  title: string;
  description: string;
  area: "CUSTOMERS" | "SUPPLIERS" | "BANK" | "VAT" | "FIXED_ASSETS" | "GENERAL";
  priority: Severity;
  accountCode?: string;
  accountLabel?: string;
  targetAmount?: number;
  openItemCount?: number;
  supportingRefs: string[];
  recommendedAction: string;
  confidence: number;
}

interface DraftReport {
  type: "DRAFT_REPORT";
  title: string;
  description: string;
  reportCode:
    | "TRIAL_BALANCE"
    | "BALANCE_SHEET"
    | "INCOME_STATEMENT"
    | "AGED_BALANCE"
    | "CLOSING_CHECKLIST";
  periodLabel: string;
  highlights: string[];
  totals?: Record<string, number>;
  recommendedAction?: string;
  confidence: number;
}

type ClosingSuggestion = ConsistencyCheck | ReconciliationPrompt | DraftReport;

interface ClosingRun {
  id: string;
  status: string;
  createdAt: string;
  completedAt: string | null;
  durationMs: number | null;
  modelVersion: string;
}

interface ClosingReportingResult {
  runId: string;
  modelVersion: string;
  durationMs: number;
  summary: string;
  suggestions: ClosingSuggestion[];
  governance: {
    humanApprovalRequired: true;
    postingRecommendation: "READY_FOR_HUMAN_REVIEW" | "REVIEW_REQUIRED" | "BLOCKED";
    note: string;
  };
  snapshot: {
    fiscalYear: {
      id: string;
      label: string;
      startDate: string;
      endDate: string;
      status: string;
    };
    ledgerState: {
      entries: {
        validatedCount: number;
        draftCount: number;
        closingCount: number;
        draftImbalanceCount: number;
        lastValidatedEntryDate: string | null;
      };
      trialBalance: {
        totalDebit: number;
        totalCredit: number;
        difference: number;
        balanced: boolean;
        topAccounts: Array<{
          accountCode: string;
          accountLabel: string;
          soldeDebit: number;
          soldeCredit: number;
        }>;
      };
      financialStatements: {
        totalActif: number;
        totalPassif: number;
        balanceGap: number;
        resultatExploitation: number;
        resultatCourant: number;
        resultatNet: number;
      };
      compliance: {
        pendingSuggestionCount: number;
        pendingFixedAssetAmortizations: number;
        draftVatDeclarations: number;
        computedVatDeclarations: number;
        taxPackageStatus: string | null;
      };
    };
    openItems: {
      agedBalanceSummary: {
        totalReceivables: number;
        totalPayables: number;
        totalOverdue: number;
        rowsCount: number;
      };
      largestOpenItems: Array<{
        tiersName: string;
        accountCode: string;
        accountType: "client" | "fournisseur";
        totalBalance: number;
        overdueAmount: number;
      }>;
      bankReconciliation: {
        unreconciledLineCount: number;
        unreconciledMovementTotal: number;
        sampleLines: Array<{
          description: string;
          transactionDate: string;
          amount: number;
        }>;
      };
      tiersReconciliation: {
        unletteredCustomerLines: number;
        unletteredSupplierLines: number;
      };
    };
    priorPeriod: {
      label: string;
      totalActif: number;
      totalPassif: number;
      balanceGap: number;
      resultatNet: number;
      totalOverdue: number;
    } | null;
    reportingRequirements: string[];
    governanceConstraint: string;
  };
}

function formatDateTime(value: string | null) {
  if (!value) {
    return "-";
  }

  return new Date(value).toLocaleString();
}

function severityBadge(value: Severity) {
  const classes: Record<Severity, string> = {
    LOW: "bg-blue-100 text-blue-700 border-blue-200",
    MEDIUM: "bg-yellow-100 text-yellow-700 border-yellow-200",
    HIGH: "bg-orange-100 text-orange-700 border-orange-200",
    CRITICAL: "bg-red-100 text-red-700 border-red-200",
  };

  return (
    <Badge variant="outline" className={classes[value]}>
      {value}
    </Badge>
  );
}

function checkStatusBadge(value: ConsistencyCheck["status"]) {
  const classes: Record<ConsistencyCheck["status"], string> = {
    PASS: "bg-green-100 text-green-700 border-green-200",
    WARN: "bg-yellow-100 text-yellow-700 border-yellow-200",
    FAIL: "bg-red-100 text-red-700 border-red-200",
  };

  return (
    <Badge variant="outline" className={classes[value]}>
      {value}
    </Badge>
  );
}

function runStatusBadge(value: string) {
  const classes =
    value === "COMPLETED"
      ? "bg-green-100 text-green-700 border-green-200"
      : value === "FAILED"
        ? "bg-red-100 text-red-700 border-red-200"
        : "bg-amber-100 text-amber-700 border-amber-200";

  return (
    <Badge variant="outline" className={classes}>
      {value}
    </Badge>
  );
}

function isConsistencyCheck(
  suggestion: ClosingSuggestion
): suggestion is ConsistencyCheck {
  return suggestion.type === "CONSISTENCY_CHECK";
}

function isReconciliationPrompt(
  suggestion: ClosingSuggestion
): suggestion is ReconciliationPrompt {
  return suggestion.type === "RECONCILIATION_PROMPT";
}

function isDraftReport(suggestion: ClosingSuggestion): suggestion is DraftReport {
  return suggestion.type === "DRAFT_REPORT";
}

export default function ClosingPage() {
  const { currentCompanyId: companyId, currentFiscalYearId, fiscalYears } = useAppContext();

  // Exercice courant avec son statut réel
  const currentFiscalYear = fiscalYears.find((fy) => fy.id === currentFiscalYearId) ?? null;
  const queryClient = useQueryClient();

  const [rawAnalysisResult, setAnalysisResult] =
    useState<ClosingReportingResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [duplicateResult, setDuplicateResult] = useState<string | null>(null);
  const [duplicateError, setDuplicateError] = useState<string | null>(null);

  const duplicatePriorYearMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/entries/duplicate-prior-year", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, fiscalYearId: currentFiscalYearId }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Erreur lors de la duplication N-1");
      }
      return payload as { message: string; duplicatedCount: number; priorFiscalYearLabel: string };
    },
    onSuccess: (data) => {
      setDuplicateResult(data.message);
      setDuplicateError(null);
    },
    onError: (err) => {
      setDuplicateError(err instanceof Error ? err.message : "Erreur inconnue");
      setDuplicateResult(null);
    },
  });

  const [fyStatusError, setFyStatusError] = useState<string | null>(null);

  const updateFiscalYearStatus = useMutation({
    mutationFn: async (newStatus: "OPEN" | "PROVISIONAL_CLOSE" | "CLOSED") => {
      if (!currentFiscalYearId) throw new Error("Aucun exercice sélectionné");
      const response = await fetch(`/api/fiscal-years/${currentFiscalYearId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Erreur de mise à jour");
      return payload;
    },
    onSuccess: () => {
      setFyStatusError(null);
      queryClient.invalidateQueries({ queryKey: ["closing-reporting-runs"] });
      // Recharge la liste des exercices pour mettre à jour le statut dans l'UI
      window.location.reload();
    },
    onError: (err) => {
      setFyStatusError(err instanceof Error ? err.message : "Erreur inconnue");
    },
  });

  const [loadingRunId, setLoadingRunId] = useState<string | null>(null);

  const loadHistoryRun = async (runId: string) => {
    setLoadingRunId(runId);
    try {
      const params = new URLSearchParams();
      if (currentFiscalYearId) {
        params.set("fiscalYearId", currentFiscalYearId);
      }

      const response = await fetch(`/api/agent-runs/${runId}?${params}`);
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Impossible de charger ce run");
      }

      // structuredOutput = sortie agent (summary, suggestions, governance)
      // inputData        = snapshot sauvegardé (fiscalYear, ledgerState, openItems, priorPeriod…)
      const out = payload.structuredOutput as Omit<ClosingReportingResult, "runId" | "modelVersion" | "durationMs" | "snapshot">;
      const inputData = payload.inputData as ClosingReportingResult["snapshot"] | null;

      setAnalysisResult({
        ...out,
        runId: payload.runId,
        modelVersion: payload.modelVersion,
        durationMs: payload.durationMs,
        // Reconstruit le snapshot depuis inputData si disponible
        snapshot: inputData ?? {
          fiscalYear: { id: "", label: "N/A", startDate: "", endDate: "", status: "" },
          ledgerState: {
            entries: { validatedCount: 0, draftCount: 0, closingCount: 0, draftImbalanceCount: 0, lastValidatedEntryDate: null },
            trialBalance: { totalDebit: 0, totalCredit: 0, difference: 0, balanced: true, topAccounts: [] },
            financialStatements: { totalActif: 0, totalPassif: 0, balanceGap: 0, resultatExploitation: 0, resultatCourant: 0, resultatNet: 0 },
            compliance: { pendingSuggestionCount: 0, pendingFixedAssetAmortizations: 0, draftVatDeclarations: 0, computedVatDeclarations: 0, taxPackageStatus: null },
          },
          openItems: {
            agedBalanceSummary: { totalReceivables: 0, totalPayables: 0, totalOverdue: 0, rowsCount: 0 },
            largestOpenItems: [],
            bankReconciliation: { unreconciledLineCount: 0, unreconciledMovementTotal: 0, sampleLines: [] },
            tiersReconciliation: { unletteredCustomerLines: 0, unletteredSupplierLines: 0 },
          },
          priorPeriod: null,
          reportingRequirements: [],
          governanceConstraint: "",
        },
      });
      setError(null);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur de chargement");
    } finally {
      setLoadingRunId(null);
    }
  };

  const { data: agentRuns = [], isLoading: isLoadingRuns } = useQuery({
    queryKey: ["closing-reporting-runs", companyId, currentFiscalYearId],
    queryFn: async () => {
      if (!companyId || !currentFiscalYearId) {
        return [];
      }

      const response = await fetch(
        `/api/agent-runs?companyId=${companyId}&fiscalYearId=${currentFiscalYearId}&agentType=CLOSING_REPORTING&limit=10`
      );
      if (!response.ok) {
        return [];
      }

      const payload = await response.json();
      return (payload.runs ?? []) as ClosingRun[];
    },
    enabled: !!companyId && !!currentFiscalYearId,
  });

  const { data: pendingSuggestions = [] } = useQuery({
    queryKey: ["closing-reporting-suggestions", companyId, currentFiscalYearId],
    queryFn: async () => {
      if (!companyId || !currentFiscalYearId) {
        return [];
      }

      const response = await fetch(
        `/api/suggestions?companyId=${companyId}&fiscalYearId=${currentFiscalYearId}&agentType=CLOSING_REPORTING&status=PENDING`
      );
      if (!response.ok) {
        return [];
      }

      const payload = await response.json();
      return payload.suggestions ?? [];
    },
    enabled: !!companyId && !!currentFiscalYearId,
  });

  const analyzeMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/closing/reporting", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          companyId,
          fiscalYearId: currentFiscalYearId,
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Closing analysis failed");
      }

      return payload as ClosingReportingResult;
    },
    onSuccess: (data) => {
      setAnalysisResult(data);
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["closing-reporting-runs"] });
      queryClient.invalidateQueries({
        queryKey: ["closing-reporting-suggestions"],
      });
    },
    onError: (mutationError) => {
      setError(
        mutationError instanceof Error
          ? mutationError.message
          : "Closing analysis failed"
      );
    },
  });

  if (!companyId) {
    return (
      <div className="p-6 max-w-7xl mx-auto animate-in fade-in duration-500">
        <div className="rounded-xl border border-dashed border-border/50 bg-card/30 backdrop-blur-sm p-12 text-center max-w-2xl mx-auto mt-12">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-muted/50 mb-6">
            <ShieldCheck className="h-10 w-10 text-muted-foreground" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">Clôture & Reporting</h1>
          <p className="mt-2 text-muted-foreground">
            Sélectionnez une société pour préparer la clôture.
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
          <h1 className="text-2xl font-bold text-foreground">Clôture & Reporting</h1>
          <p className="mt-2 text-muted-foreground">
            Sélectionnez un exercice pour préparer la clôture.
          </p>
        </div>
      </div>
    );
  }

  const analysisResult =
    rawAnalysisResult?.snapshot.fiscalYear.id === currentFiscalYearId
      ? rawAnalysisResult
      : null;
  const suggestions = analysisResult?.suggestions ?? [];
  const consistencyChecks = suggestions.filter(isConsistencyCheck);
  const reconciliationPrompts = suggestions.filter(isReconciliationPrompt);
  const draftReports = suggestions.filter(isDraftReport);
  const blockingChecks = consistencyChecks.filter(
    (check) => check.status === "FAIL" || check.severity === "CRITICAL"
  ).length;
  const warningChecks = consistencyChecks.filter(
    (check) => check.status === "WARN"
  ).length;

  const fyStatus = currentFiscalYear?.status ?? "OPEN";
  const fyLabel = currentFiscalYear?.label ?? "—";

  const statusConfig = {
    OPEN: {
      label: "Ouvert",
      description: "L'exercice est en cours. Les écritures peuvent être saisies et modifiées librement.",
      badgeCls: "bg-green-100 text-green-800 border-green-200",
      bannerCls: "border-green-200 bg-green-50",
      icon: <LockOpen className="h-5 w-5 text-green-600 shrink-0" />,
    },
    PROVISIONAL_CLOSE: {
      label: "Clôture provisoire",
      description: "L'exercice est en révision. Les corrections sont encore possibles avant la clôture définitive.",
      badgeCls: "bg-amber-100 text-amber-800 border-amber-200",
      bannerCls: "border-amber-200 bg-amber-50",
      icon: <TriangleAlert className="h-5 w-5 text-amber-600 shrink-0" />,
    },
    CLOSED: {
      label: "Clôturé définitivement",
      description: "L'exercice est fermé. Aucune écriture ne peut être modifiée.",
      badgeCls: "bg-red-100 text-red-800 border-red-200",
      bannerCls: "border-red-200 bg-red-50",
      icon: <Lock className="h-5 w-5 text-red-600 shrink-0" />,
    },
  } as const;

  const currentStatusCfg = statusConfig[fyStatus as keyof typeof statusConfig] ?? statusConfig.OPEN;

  return (
    <div className="space-y-8 p-6 max-w-7xl mx-auto animate-in fade-in duration-500">
      {/* En-tête */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-linear-to-r from-primary to-secondary mb-1">
            Clôture &amp; Reporting — <span className="text-primary/80">{fyLabel}</span>
          </h1>
          <p className="text-muted-foreground font-medium">
            L&apos;agent analyse et assiste. Les décisions de clôture restent humaines.
          </p>
        </div>
        <Button
          onClick={() => analyzeMutation.mutate()}
          disabled={analyzeMutation.isPending || fyStatus === "CLOSED"}
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
              Lancer l&apos;analyse IA
            </>
          )}
        </Button>
      </div>

      {/* Bandeau statut exercice — workflow humain */}
      <div className={`rounded-xl border p-6 bg-card/60 backdrop-blur-md shadow-sm transition-all duration-300 hover:shadow-md ${currentStatusCfg.bannerCls}`}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            {currentStatusCfg.icon}
            <div>
              <div className="flex items-center gap-2 font-semibold">
                Statut de l&apos;exercice :
                <Badge variant="outline" className={currentStatusCfg.badgeCls}>
                  {currentStatusCfg.label}
                </Badge>
              </div>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {currentStatusCfg.description}
              </p>
              {fyStatusError && (
                <p className="mt-1 text-sm text-red-600">{fyStatusError}</p>
              )}
            </div>
          </div>

          {/* Boutons de transition — décision exclusivement humaine */}
          <div className="flex flex-wrap gap-2 shrink-0">
            {fyStatus === "OPEN" && (
              <Button
                variant="outline"
                className="gap-2 border-amber-300 text-amber-700 hover:bg-amber-50"
                disabled={updateFiscalYearStatus.isPending}
                onClick={() => {
                  if (confirm(`Passer "${fyLabel}" en clôture provisoire ?\n\nLes corrections restent possibles. L'exercice ne sera pas encore fermé définitivement.`)) {
                    updateFiscalYearStatus.mutate("PROVISIONAL_CLOSE");
                  }
                }}
              >
                {updateFiscalYearStatus.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <TriangleAlert className="h-4 w-4" />
                )}
                Passer en clôture provisoire
              </Button>
            )}

            {fyStatus === "PROVISIONAL_CLOSE" && (
              <>
                <Button
                  variant="outline"
                  className="gap-2 border-green-300 text-green-700 hover:bg-green-50"
                  disabled={updateFiscalYearStatus.isPending}
                  onClick={() => {
                    if (confirm(`Rouvrir "${fyLabel}" ?\n\nL'exercice repassera en statut OUVERT et les écritures seront à nouveau modifiables.`)) {
                      updateFiscalYearStatus.mutate("OPEN");
                    }
                  }}
                >
                  <LockOpen className="h-4 w-4" />
                  Rouvrir l&apos;exercice
                </Button>
                <Button
                  className="gap-2 bg-red-600 hover:bg-red-700 text-white"
                  disabled={updateFiscalYearStatus.isPending || (blockingChecks > 0)}
                  title={blockingChecks > 0 ? `${blockingChecks} blocage(s) détecté(s) — résolvez-les avant la clôture définitive` : undefined}
                  onClick={() => {
                    if (confirm(`⚠️ CLÔTURE DÉFINITIVE de "${fyLabel}"\n\nCette action est irréversible. Aucune écriture ne pourra plus être modifiée.\n\nConfirmer ?`)) {
                      updateFiscalYearStatus.mutate("CLOSED");
                    }
                  }}
                >
                  {updateFiscalYearStatus.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Lock className="h-4 w-4" />
                  )}
                  Clôturer définitivement
                </Button>
              </>
            )}

            {fyStatus === "CLOSED" && (
              <span className="text-sm text-muted-foreground italic">
                Exercice fermé — lecture seule
              </span>
            )}
          </div>
        </div>
      </div>

      {error ? (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="flex items-center gap-3 pt-6">
            <AlertCircle className="h-5 w-5 shrink-0 text-red-600" />
            <div>
              <p className="font-medium text-red-900">Erreur</p>
              <p className="text-sm text-red-700">{error}</p>
            </div>
          </CardContent>
        </Card>
      ) : null}

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
            <CardTitle className="text-sm font-medium">Blocages</CardTitle>
            <div className="p-2 bg-red-500/10 rounded-full">
              <AlertTriangle className="h-4 w-4 text-red-500" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold font-mono text-red-600 dark:text-red-400">
              {analysisResult ? blockingChecks : "-"}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Checks à traiter avant clôture</p>
          </CardContent>
        </Card>

        <Card className="bg-card/60 backdrop-blur-md border border-border/50 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Rapprochements</CardTitle>
            <div className="p-2 bg-orange-500/10 rounded-full">
              <ArrowLeftRight className="h-4 w-4 text-orange-500" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold font-mono text-orange-600 dark:text-orange-400">
              {analysisResult
                ? reconciliationPrompts.length
                : pendingSuggestions.length || "-"}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Prompts de suivi ouverts</p>
          </CardContent>
        </Card>

        <Card className="bg-card/60 backdrop-blur-md border border-border/50 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Brouillons de rapports</CardTitle>
            <div className="p-2 bg-blue-500/10 rounded-full">
              <FileSpreadsheet className="h-4 w-4 text-blue-500" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold font-mono text-blue-600 dark:text-blue-400">
              {analysisResult ? draftReports.length : "-"}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Sorties prégénérées pour revue</p>
          </CardContent>
        </Card>
      </div>

      {analysisResult ? (
        <>
          <Card className="bg-card/60 backdrop-blur-xl border border-border/50 shadow-sm overflow-hidden">
            <CardHeader>
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-1">
                  <CardTitle>Derniere analyse</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    {analysisResult.summary}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Modele : {analysisResult.modelVersion} · Duree :{" "}
                    {analysisResult.durationMs}ms
                  </p>
                </div>
                <div className="space-y-2 rounded-lg border bg-muted/40 p-4 text-sm">
                  <div className="flex items-center gap-2 font-medium">
                    <ShieldCheck className="h-4 w-4 text-primary" />
                    Gouvernance
                  </div>
                  <Badge variant="outline">
                    {analysisResult.governance.postingRecommendation}
                  </Badge>
                  <p className="text-muted-foreground">
                    {analysisResult.governance.note}
                  </p>
                </div>
              </div>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-lg border p-4">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Scale className="h-4 w-4 text-muted-foreground" />
                  Balance
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  Ecart balance:{" "}
                  <span className="font-medium text-foreground">
                    {formatMADWithCurrency(
                      analysisResult.snapshot.ledgerState.trialBalance.difference
                    )}
                  </span>
                </p>
                <p className="text-sm text-muted-foreground">
                  Ecart bilan:{" "}
                  <span className="font-medium text-foreground">
                    {formatMADWithCurrency(
                      analysisResult.snapshot.ledgerState.financialStatements
                        .balanceGap
                    )}
                  </span>
                </p>
              </div>

              <div className="rounded-lg border p-4">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <ArrowLeftRight className="h-4 w-4 text-muted-foreground" />
                  Open Items
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  Clients/Fournisseurs en retard:{" "}
                  <span className="font-medium text-foreground">
                    {formatMADWithCurrency(
                      analysisResult.snapshot.openItems.agedBalanceSummary
                        .totalOverdue
                    )}
                  </span>
                </p>
                <p className="text-sm text-muted-foreground">
                  Lignes bancaires non rapprochees:{" "}
                  <span className="font-medium text-foreground">
                    {
                      analysisResult.snapshot.openItems.bankReconciliation
                        .unreconciledLineCount
                    }
                  </span>
                </p>
              </div>

              <div className="rounded-lg border p-4">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  Ecritures
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  Brouillons:{" "}
                  <span className="font-medium text-foreground">
                    {analysisResult.snapshot.ledgerState.entries.draftCount}
                  </span>
                </p>
                <p className="text-sm text-muted-foreground">
                  Brouillons desequilibres:{" "}
                  <span className="font-medium text-foreground">
                    {
                      analysisResult.snapshot.ledgerState.entries
                        .draftImbalanceCount
                    }
                  </span>
                </p>
              </div>

              <div className="rounded-lg border p-4">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  Conformite
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  Suggestions en attente:{" "}
                  <span className="font-medium text-foreground">
                    {
                      analysisResult.snapshot.ledgerState.compliance
                        .pendingSuggestionCount
                    }
                  </span>
                </p>
                <p className="text-sm text-muted-foreground">
                  TVA en brouillon:{" "}
                  <span className="font-medium text-foreground">
                    {
                      analysisResult.snapshot.ledgerState.compliance
                        .draftVatDeclarations
                    }
                  </span>
                </p>
              </div>
            </CardContent>
          </Card>

          {analysisResult.snapshot.priorPeriod && (
            <Card className="bg-card/60 backdrop-blur-xl border border-border/50 shadow-sm overflow-hidden">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <History className="h-5 w-5 text-muted-foreground" />
                  Comparaison {analysisResult.snapshot.priorPeriod.label} / {analysisResult.snapshot.fiscalYear.label}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead className="font-semibold">Indicateur</TableHead>
                      <TableHead className="text-right font-semibold">{analysisResult.snapshot.fiscalYear.label}</TableHead>
                      <TableHead className="text-right font-semibold">{analysisResult.snapshot.priorPeriod.label}</TableHead>
                      <TableHead className="text-right font-semibold">Variation</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[
                      {
                        label: "Total Actif",
                        current: analysisResult.snapshot.ledgerState.financialStatements.totalActif,
                        prior: analysisResult.snapshot.priorPeriod.totalActif,
                      },
                      {
                        label: "Total Passif",
                        current: analysisResult.snapshot.ledgerState.financialStatements.totalPassif,
                        prior: analysisResult.snapshot.priorPeriod.totalPassif,
                      },
                      {
                        label: "Résultat net",
                        current: analysisResult.snapshot.ledgerState.financialStatements.resultatNet,
                        prior: analysisResult.snapshot.priorPeriod.resultatNet,
                      },
                      {
                        label: "Écart bilan",
                        current: analysisResult.snapshot.ledgerState.financialStatements.balanceGap,
                        prior: analysisResult.snapshot.priorPeriod.balanceGap,
                      },
                      {
                        label: "Encours en retard",
                        current: analysisResult.snapshot.openItems.agedBalanceSummary.totalOverdue,
                        prior: analysisResult.snapshot.priorPeriod.totalOverdue,
                      },
                    ].map((row) => {
                      const variation = row.current - row.prior;
                      const variationPct = row.prior !== 0 ? (variation / Math.abs(row.prior)) * 100 : null;
                      const isPositive = variation >= 0;
                      return (
                        <TableRow key={row.label} className="border-border/50 hover:bg-muted/40 transition-colors">
                          <TableCell className="font-medium">{row.label}</TableCell>
                          <TableCell className="text-right font-mono">{formatMADWithCurrency(row.current)}</TableCell>
                          <TableCell className="text-right text-muted-foreground font-mono">{formatMADWithCurrency(row.prior)}</TableCell>
                          <TableCell className="text-right font-mono">
                            <span className={variation === 0 ? "text-muted-foreground" : isPositive ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}>
                              {variation >= 0 ? "+" : ""}{formatMADWithCurrency(variation)}
                              {variationPct !== null ? (
                                <span className="ml-1 text-xs">({variationPct >= 0 ? "+" : ""}{variationPct.toFixed(1)}%)</span>
                              ) : null}
                            </span>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Checks de coherence</CardTitle>
                <p className="text-sm text-muted-foreground">
                  {blockingChecks} blocage(s) et {warningChecks} point(s)
                  d&apos;attention
                </p>
              </div>
              <Badge variant="outline">{consistencyChecks.length} checks</Badge>
            </CardHeader>
            <CardContent className="p-0">
              {consistencyChecks.length === 0 ? (
                <div className="p-10 text-center">
                  <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-green-600" />
                  <h2 className="text-lg font-semibold">
                    Aucun check structurel remonte
                  </h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    L&apos;agent n&apos;a pas identifie de point de coherence
                    supplementaire sur cette execution.
                  </p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Statut</TableHead>
                      <TableHead>Zone</TableHead>
                      <TableHead>Check</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>Confiance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {consistencyChecks.map((check, index) => (
                      <TableRow key={`${check.title}-${index}`}>
                        <TableCell className="space-y-2">
                          {checkStatusBadge(check.status)}
                          {severityBadge(check.severity)}
                        </TableCell>
                        <TableCell>{check.area}</TableCell>
                        <TableCell className="max-w-90 whitespace-normal">
                          <p className="font-medium">{check.title}</p>
                          <p className="text-sm text-muted-foreground">
                            {check.description}
                          </p>
                          {check.evidence.length > 0 ? (
                            <p className="mt-2 text-xs text-muted-foreground">
                              {check.evidence.join(" · ")}
                            </p>
                          ) : null}
                        </TableCell>
                        <TableCell className="max-w-[320px] whitespace-normal text-sm text-muted-foreground">
                          {check.recommendedAction}
                        </TableCell>
                        <TableCell>{Math.round(check.confidence * 100)}%</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card className="bg-card/60 backdrop-blur-xl border border-border/50 shadow-sm overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Prompts de rapprochement</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Actions proposees pour accelerer la cloture sans poster quoi
                  que ce soit.
                </p>
              </div>
              <Badge variant="outline">
                {reconciliationPrompts.length} prompt(s)
              </Badge>
            </CardHeader>
            <CardContent className="p-0">
              {reconciliationPrompts.length === 0 ? (
                <div className="p-10 text-center text-sm text-muted-foreground">
                  Aucun prompt de rapprochement n&apos;a ete genere sur cette
                  execution.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Priorite</TableHead>
                      <TableHead>Zone</TableHead>
                      <TableHead>Prompt</TableHead>
                      <TableHead>Montant / Volume</TableHead>
                      <TableHead>Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {reconciliationPrompts.map((prompt, index) => (
                      <TableRow key={`${prompt.title}-${index}`}>
                        <TableCell>{severityBadge(prompt.priority)}</TableCell>
                        <TableCell>{prompt.area}</TableCell>
                        <TableCell className="max-w-85 whitespace-normal">
                          <p className="font-medium">{prompt.title}</p>
                          <p className="text-sm text-muted-foreground">
                            {prompt.description}
                          </p>
                          {prompt.accountCode ? (
                            <p className="mt-2 text-xs text-muted-foreground">
                              {prompt.accountCode}
                              {prompt.accountLabel
                                ? ` - ${prompt.accountLabel}`
                                : ""}
                            </p>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {typeof prompt.targetAmount === "number"
                            ? formatMADWithCurrency(prompt.targetAmount)
                            : "-"}
                          {typeof prompt.openItemCount === "number"
                            ? ` · ${prompt.openItemCount} item(s)`
                            : ""}
                        </TableCell>
                        <TableCell className="max-w-75 whitespace-normal text-sm text-muted-foreground">
                          {prompt.recommendedAction}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card className="bg-card/60 backdrop-blur-xl border border-border/50 shadow-sm overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Brouillons de reporting</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Rapports et checklist pregeneres pour revue humaine.
                </p>
              </div>
              <Badge variant="outline">{draftReports.length} brouillon(s)</Badge>
            </CardHeader>
            <CardContent className="grid gap-4 lg:grid-cols-2">
              {draftReports.length === 0 ? (
                <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                  Aucun brouillon de rapport n&apos;a ete retourne.
                </div>
              ) : (
                draftReports.map((report, index) => (
                  <Card key={`${report.title}-${index}`} className="border">
                    <CardHeader>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <CardTitle className="text-base">
                            {report.title}
                          </CardTitle>
                          <p className="text-sm text-muted-foreground">
                            {report.description}
                          </p>
                        </div>
                        <Badge variant="outline">{report.reportCode}</Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm">
                      <p className="text-muted-foreground">
                        Periode: {report.periodLabel}
                      </p>
                      {report.highlights.length > 0 ? (
                        <div className="space-y-1">
                          {report.highlights.map((highlight, highlightIndex) => (
                            <p
                              key={`${report.title}-highlight-${highlightIndex}`}
                              className="text-muted-foreground"
                            >
                              - {highlight}
                            </p>
                          ))}
                        </div>
                      ) : null}
                      {report.totals ? (
                        <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
                          {Object.entries(report.totals).map(([key, value]) => (
                            <p key={`${report.title}-${key}`}>
                              {key}: {formatMADWithCurrency(value)}
                            </p>
                          ))}
                        </div>
                      ) : null}
                      {report.recommendedAction ? (
                        <p className="text-muted-foreground">
                          Action: {report.recommendedAction}
                        </p>
                      ) : null}
                    </CardContent>
                  </Card>
                ))
              )}
            </CardContent>
          </Card>
        </>
      ) : (
        <AIAgentBanner 
          title="Assistant de Clôture & Reporting"
          description="Je prépare la clôture comptable en analysant le grand livre, les soldes ouverts et les signaux de reporting. Je vous propose des vérifications de cohérence, des écritures d'inventaire et des rapports préliminaires pour faciliter votre travail de clôture, sans jamais prendre de décision seul."
          capabilities={["Contrôles de cohérence", "Préparation de clôture", "Brouillons de rapports"]}
        />
      )}

      {/* Duplication N-1 */}
      <Card className="bg-card/60 backdrop-blur-xl border border-border/50 shadow-sm">
        <CardHeader>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Copy className="h-5 w-5 text-muted-foreground" />
                Duplication des écritures N-1
              </CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Copie toutes les écritures validées de l&apos;exercice précédent (N-1) vers
                l&apos;exercice courant, pour disposer des données comparatives lors de la
                clôture. Les écritures copiées sont étiquetées &quot;[N-1]&quot; et peuvent
                être utilisées dans les rapports.
              </p>
            </div>
            <Button
              variant="outline"
              onClick={() => duplicatePriorYearMutation.mutate()}
              disabled={duplicatePriorYearMutation.isPending || !currentFiscalYearId}
              className="gap-2 shrink-0"
            >
              {duplicatePriorYearMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Duplication en cours...
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4" />
                  Dupliquer N-1
                </>
              )}
            </Button>
          </div>
        </CardHeader>
        {(duplicateResult || duplicateError) && (
          <CardContent>
            {duplicateResult && (
              <div className="flex items-center gap-3 rounded-lg border border-green-200 bg-green-50 p-4">
                <CheckCircle2 className="h-5 w-5 shrink-0 text-green-600" />
                <p className="text-sm text-green-800">{duplicateResult}</p>
              </div>
            )}
            {duplicateError && (
              <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-4">
                <AlertCircle className="h-5 w-5 shrink-0 text-red-600" />
                <p className="text-sm text-red-800">{duplicateError}</p>
              </div>
            )}
          </CardContent>
        )}
      </Card>

      <Card className="bg-card/60 backdrop-blur-xl border border-border/50 shadow-sm overflow-hidden">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Historique des analyses</CardTitle>
            <p className="text-sm text-muted-foreground">
              Executions precedentes de l&apos;Agent 5
            </p>
          </div>
          <Badge variant="outline">{agentRuns.length} execution(s)</Badge>
        </CardHeader>
        <CardContent className="p-0">
          {isLoadingRuns ? (
            <div className="p-6 text-sm text-muted-foreground">Chargement...</div>
          ) : agentRuns.length === 0 ? (
            <div className="p-10 text-center">
              <Clock className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
              <h2 className="text-lg font-semibold">
                Aucune analyse de cloture
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Lancez une preparation pour generer vos premiers checks et
                brouillons de reporting.
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
                  <TableHead className="text-center font-semibold">Résultat</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {agentRuns.map((run) => {
                  const isActive = analysisResult?.runId === run.id;
                  const isLoading = loadingRunId === run.id;
                  return (
                    <TableRow
                      key={run.id}
                      className={isActive ? "bg-blue-50/60" : undefined}
                    >
                      <TableCell>{formatDateTime(run.createdAt)}</TableCell>
                      <TableCell>{runStatusBadge(run.status)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {run.modelVersion}
                      </TableCell>
                      <TableCell>
                        {run.durationMs ? `${run.durationMs}ms` : "-"}
                      </TableCell>
                      <TableCell className="text-center">
                        {run.status === "COMPLETED" ? (
                          isActive ? (
                            <Badge
                              variant="outline"
                              className="bg-blue-100 text-blue-700 border-blue-200 gap-1"
                            >
                              <History className="h-3 w-3" />
                              Affiché
                            </Badge>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 gap-1 text-xs"
                              disabled={!!loadingRunId}
                              onClick={() => loadHistoryRun(run.id)}
                            >
                              {isLoading ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <History className="h-3 w-3" />
                              )}
                              Charger
                            </Button>
                          )
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
