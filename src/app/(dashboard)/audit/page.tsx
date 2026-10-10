"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileSearch,
  Loader2,
  Play,
  ShieldAlert,
  ShieldCheck,
  Users,
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

type Severity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

interface AuditAlert {
  type: "ANOMALY_ALERT";
  title: string;
  description: string;
  area:
    | "TRANSACTION_PATTERN"
    | "USER_BEHAVIOR"
    | "DOCUMENT_WORKFLOW"
    | "APPROVAL_TRAIL"
    | "ACCESS_CONTROL"
    | "JOURNAL_CONTROL"
    | "GENERAL";
  severity: Severity;
  relatedEntityType?:
    | "JOURNAL_ENTRY"
    | "DOCUMENT"
    | "USER"
    | "SUGGESTION"
    | "AUDIT_LOG"
    | "GENERAL";
  relatedEntityIds?: string[];
  evidence: string[];
  metrics?: Record<string, number>;
  recommendedInvestigation: string;
  confidence: number;
}

interface SuspiciousBehaviorFlag {
  type: "SUSPICIOUS_BEHAVIOR_FLAG";
  title: string;
  description: string;
  behaviorCategory:
    | "CONCENTRATED_ACTIVITY"
    | "REPROCESSING_SPIKE"
    | "REVIEW_OVERRIDE_PATTERN"
    | "WEEKEND_ACTIVITY"
    | "REVERSAL_PATTERN"
    | "DUPLICATE_REFERENCE_PATTERN"
    | "OTHER";
  severity: Severity;
  actorId?: string;
  actorName?: string;
  evidence: string[];
  recommendedInvestigation: string;
  confidence: number;
}

interface AuditSupportNote {
  type: "AUDIT_SUPPORT_NOTE";
  title: string;
  description: string;
  focusArea:
    | "TRANSACTION_HISTORY"
    | "USER_BEHAVIOR"
    | "DOCUMENT_WORKFLOW"
    | "APPROVAL_TRAIL"
    | "GENERAL";
  highlights: string[];
  recommendedProcedure: string;
  confidence: number;
}

type AuditSuggestion = AuditAlert | SuspiciousBehaviorFlag | AuditSupportNote;

interface AuditRun {
  id: string;
  status: string;
  createdAt: string;
  completedAt: string | null;
  durationMs: number | null;
  modelVersion: string;
}

interface AuditComplianceResult {
  runId: string;
  modelVersion: string;
  durationMs: number;
  summary: string;
  suggestions: AuditSuggestion[];
  governance: {
    readOnlyAccess: true;
    autonomousDecisioningAllowed: false;
    humanInterpretationRequired: true;
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
    transactionHistory: {
      entryCounts: {
        draft: number;
        validated: number;
        reversed: number;
      };
      totals: {
        totalDebit: number;
        totalCredit: number;
        averageEntryAmount: number;
        highValueThreshold: number;
        highValueEntryCount: number;
      };
      anomalySignals: {
        duplicateReferenceCount: number;
        weekendEntryCount: number;
        staleDraftCount: number;
        reversalCount: number;
      };
      journalDistribution: Array<{
        journalCode: string;
        journalLabel: string;
        entryCount: number;
        totalAmount: number;
      }>;
      topTransactions: Array<{
        id: string;
        entryNumber: number;
        journalCode: string;
        status: string;
        description: string;
        amount: number;
        reference: string | null;
        entryDate: string;
        createdById: string;
        createdByName: string;
      }>;
    };
    userBehaviorPatterns: {
      auditLogSummary: {
        totalEvents: number;
        reprocessEvents: number;
        correctionEvents: number;
        bulkReviewEvents: number;
      };
      activeUsers: Array<{
        userId: string;
        name: string;
        entryCreatedCount: number;
        auditEventCount: number;
        documentUploads: number;
        reprocessActions: number;
        reviewActions: number;
        sensitiveActionCount: number;
        latestActivityAt: string | null;
        anomalySignals: string[];
      }>;
    };
    workflowSignals: {
      pendingSuggestions: number;
      correctedSuggestions: number;
      reviewRequiredDocuments: number;
      rejectedDocuments: number;
      approvedDocuments: number;
      failedDocuments: number;
    };
    priorPeriod: {
      label: string;
      reversalCount: number;
      duplicateReferenceCount: number;
      weekendEntryCount: number;
      pendingSuggestions: number;
    } | null;
    auditRules: string[];
    governanceConstraint: string;
  };
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

function formatDateTime(value: string | null) {
  if (!value) {
    return "-";
  }

  return new Date(value).toLocaleString();
}

function isAuditAlert(suggestion: AuditSuggestion): suggestion is AuditAlert {
  return suggestion.type === "ANOMALY_ALERT";
}

function isSuspiciousBehaviorFlag(
  suggestion: AuditSuggestion
): suggestion is SuspiciousBehaviorFlag {
  return suggestion.type === "SUSPICIOUS_BEHAVIOR_FLAG";
}

function isAuditSupportNote(
  suggestion: AuditSuggestion
): suggestion is AuditSupportNote {
  return suggestion.type === "AUDIT_SUPPORT_NOTE";
}

export default function AuditPage() {
  const { currentCompanyId: companyId, currentFiscalYearId } = useAppContext();
  const queryClient = useQueryClient();

  const [rawAnalysisResult, setAnalysisResult] =
    useState<AuditComplianceResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: agentRuns = [], isLoading: isLoadingRuns } = useQuery({
    queryKey: ["audit-compliance-runs", companyId, currentFiscalYearId],
    queryFn: async () => {
      if (!companyId || !currentFiscalYearId) {
        return [];
      }

      const response = await fetch(
        `/api/agent-runs?companyId=${companyId}&fiscalYearId=${currentFiscalYearId}&agentType=AUDIT_COMPLIANCE&limit=10`
      );
      if (!response.ok) {
        return [];
      }

      const payload = await response.json();
      return (payload.runs ?? []) as AuditRun[];
    },
    enabled: !!companyId && !!currentFiscalYearId,
  });

  const { data: pendingSuggestions = [] } = useQuery({
    queryKey: ["audit-compliance-suggestions", companyId, currentFiscalYearId],
    queryFn: async () => {
      if (!companyId || !currentFiscalYearId) {
        return [];
      }

      const response = await fetch(
        `/api/suggestions?companyId=${companyId}&fiscalYearId=${currentFiscalYearId}&agentType=AUDIT_COMPLIANCE&status=PENDING`
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
      const response = await fetch("/api/audit/compliance", {
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
        throw new Error(payload.error || "Audit analysis failed");
      }

      return payload as AuditComplianceResult;
    },
    onSuccess: (data) => {
      setAnalysisResult(data);
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["audit-compliance-runs"] });
      queryClient.invalidateQueries({
        queryKey: ["audit-compliance-suggestions"],
      });
    },
    onError: (mutationError) => {
      setError(
        mutationError instanceof Error
          ? mutationError.message
          : "Audit analysis failed"
      );
    },
  });

  if (!companyId) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-dashed p-10 text-center">
          <ShieldAlert className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
          <h1 className="text-xl font-semibold">Audit & Compliance</h1>
          <p className="mt-2 text-muted-foreground">
            Selectionnez une societe pour lancer l&apos;analyse d&apos;audit.
          </p>
        </div>
      </div>
    );
  }

  if (!currentFiscalYearId) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-dashed p-10 text-center">
          <ShieldAlert className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
          <h1 className="text-xl font-semibold">Audit & Compliance</h1>
          <p className="mt-2 text-muted-foreground">
            Selectionnez un exercice pour afficher les analyses de cette periode.
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
  const anomalyAlerts = suggestions.filter(isAuditAlert);
  const suspiciousFlags = suggestions.filter(isSuspiciousBehaviorFlag);
  const supportNotes = suggestions.filter(isAuditSupportNote);
  const criticalCount = suggestions.filter(
    (suggestion) =>
      "severity" in suggestion && suggestion.severity === "CRITICAL"
  ).length;

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Audit & Compliance
          </h1>
          <p className="text-muted-foreground">
            Agent 6 - Surfaces d&apos;anomalies, comportements inhabituels et
            support contextuel pour auditeurs
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
              Lancer l&apos;audit
            </>
          )}
        </Button>
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

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Analyses</CardTitle>
            <FileSearch className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{agentRuns.length}</div>
            <p className="text-xs text-muted-foreground">
              Executions de l&apos;agent
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Alertes critiques</CardTitle>
            <AlertTriangle className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {analysisResult ? criticalCount : "-"}
            </div>
            <p className="text-xs text-muted-foreground">
              Anomalies a investiguer en priorite
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Flags de comportement</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {analysisResult
                ? suspiciousFlags.length
                : pendingSuggestions.length || "-"}
            </div>
            <p className="text-xs text-muted-foreground">
              Signaux comportementaux remontes
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Notes d&apos;audit</CardTitle>
            <ShieldCheck className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {analysisResult ? supportNotes.length : "-"}
            </div>
            <p className="text-xs text-muted-foreground">
              Contextes et procedures proposes
            </p>
          </CardContent>
        </Card>
      </div>

      {analysisResult ? (
        <>
          <Card>
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
                  <Badge variant="outline">READ_ONLY</Badge>
                  <p className="text-muted-foreground">
                    {analysisResult.governance.note}
                  </p>
                </div>
              </div>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-lg border p-4">
                <div className="text-sm font-medium">Signaux transactionnels</div>
                <p className="mt-2 text-sm text-muted-foreground">
                  References dupliquees:{" "}
                  <span className="font-medium text-foreground">
                    {
                      analysisResult.snapshot.transactionHistory.anomalySignals
                        .duplicateReferenceCount
                    }
                  </span>
                </p>
                <p className="text-sm text-muted-foreground">
                  Ecritures weekend:{" "}
                  <span className="font-medium text-foreground">
                    {
                      analysisResult.snapshot.transactionHistory.anomalySignals
                        .weekendEntryCount
                    }
                  </span>
                </p>
              </div>

              <div className="rounded-lg border p-4">
                <div className="text-sm font-medium">Montants inhabituels</div>
                <p className="mt-2 text-sm text-muted-foreground">
                  Seuil high-value:{" "}
                  <span className="font-medium text-foreground">
                    {formatMADWithCurrency(
                      analysisResult.snapshot.transactionHistory.totals
                        .highValueThreshold
                    )}
                  </span>
                </p>
                <p className="text-sm text-muted-foreground">
                  Ecritures au-dessus du seuil:{" "}
                  <span className="font-medium text-foreground">
                    {
                      analysisResult.snapshot.transactionHistory.totals
                        .highValueEntryCount
                    }
                  </span>
                </p>
              </div>

              <div className="rounded-lg border p-4">
                <div className="text-sm font-medium">Workflow</div>
                <p className="mt-2 text-sm text-muted-foreground">
                  Suggestions en attente:{" "}
                  <span className="font-medium text-foreground">
                    {
                      analysisResult.snapshot.workflowSignals
                        .pendingSuggestions
                    }
                  </span>
                </p>
                <p className="text-sm text-muted-foreground">
                  Documents review required:{" "}
                  <span className="font-medium text-foreground">
                    {
                      analysisResult.snapshot.workflowSignals
                        .reviewRequiredDocuments
                    }
                  </span>
                </p>
              </div>

              <div className="rounded-lg border p-4">
                <div className="text-sm font-medium">Traces d&apos;audit</div>
                <p className="mt-2 text-sm text-muted-foreground">
                  Evenements:{" "}
                  <span className="font-medium text-foreground">
                    {
                      analysisResult.snapshot.userBehaviorPatterns
                        .auditLogSummary.totalEvents
                    }
                  </span>
                </p>
                <p className="text-sm text-muted-foreground">
                  Reprocess:{" "}
                  <span className="font-medium text-foreground">
                    {
                      analysisResult.snapshot.userBehaviorPatterns
                        .auditLogSummary.reprocessEvents
                    }
                  </span>
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Anomaly alerts</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Signaux transactionnels et workflow a investiguer.
                </p>
              </div>
              <Badge variant="outline">{anomalyAlerts.length} alertes</Badge>
            </CardHeader>
            <CardContent className="p-0">
              {anomalyAlerts.length === 0 ? (
                <div className="p-10 text-center">
                  <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-green-600" />
                  <h2 className="text-lg font-semibold">
                    Aucune alerte structurelle retournee
                  </h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    L&apos;agent n&apos;a pas remonte d&apos;anomalie
                    transactionnelle supplementaire sur cette execution.
                  </p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Severite</TableHead>
                      <TableHead>Zone</TableHead>
                      <TableHead>Alerte</TableHead>
                      <TableHead>Investigation</TableHead>
                      <TableHead>Confiance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {anomalyAlerts.map((alert, index) => (
                      <TableRow key={`${alert.title}-${index}`}>
                        <TableCell>{severityBadge(alert.severity)}</TableCell>
                        <TableCell>{alert.area}</TableCell>
                        <TableCell className="max-w-[360px] whitespace-normal">
                          <p className="font-medium">{alert.title}</p>
                          <p className="text-sm text-muted-foreground">
                            {alert.description}
                          </p>
                          {alert.evidence.length > 0 ? (
                            <p className="mt-2 text-xs text-muted-foreground">
                              {alert.evidence.join(" · ")}
                            </p>
                          ) : null}
                        </TableCell>
                        <TableCell className="max-w-[320px] whitespace-normal text-sm text-muted-foreground">
                          {alert.recommendedInvestigation}
                        </TableCell>
                        <TableCell>{Math.round(alert.confidence * 100)}%</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Suspicious behavior flags</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Concentrations d&apos;activite et comportements inhabituels par
                  acteur.
                </p>
              </div>
              <Badge variant="outline">{suspiciousFlags.length} flags</Badge>
            </CardHeader>
            <CardContent className="p-0">
              {suspiciousFlags.length === 0 ? (
                <div className="p-10 text-center text-sm text-muted-foreground">
                  Aucun flag de comportement n&apos;a ete retourne.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Severite</TableHead>
                      <TableHead>Categorie</TableHead>
                      <TableHead>Acteur</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Investigation</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {suspiciousFlags.map((flag, index) => (
                      <TableRow key={`${flag.title}-${index}`}>
                        <TableCell>{severityBadge(flag.severity)}</TableCell>
                        <TableCell>{flag.behaviorCategory}</TableCell>
                        <TableCell>{flag.actorName ?? "-"}</TableCell>
                        <TableCell className="max-w-[320px] whitespace-normal">
                          <p className="font-medium">{flag.title}</p>
                          <p className="text-sm text-muted-foreground">
                            {flag.description}
                          </p>
                          {flag.evidence.length > 0 ? (
                            <p className="mt-2 text-xs text-muted-foreground">
                              {flag.evidence.join(" · ")}
                            </p>
                          ) : null}
                        </TableCell>
                        <TableCell className="max-w-[300px] whitespace-normal text-sm text-muted-foreground">
                          {flag.recommendedInvestigation}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Audit support notes</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Notes contextuelles et procedures de revue.
                </p>
              </div>
              <Badge variant="outline">{supportNotes.length} notes</Badge>
            </CardHeader>
            <CardContent className="grid gap-4 lg:grid-cols-2">
              {supportNotes.length === 0 ? (
                <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                  Aucune note contextuelle n&apos;a ete retournee.
                </div>
              ) : (
                supportNotes.map((note, index) => (
                  <Card key={`${note.title}-${index}`} className="border">
                    <CardHeader>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <CardTitle className="text-base">
                            {note.title}
                          </CardTitle>
                          <p className="text-sm text-muted-foreground">
                            {note.description}
                          </p>
                        </div>
                        <Badge variant="outline">{note.focusArea}</Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm">
                      {note.highlights.length > 0 ? (
                        <div className="space-y-1">
                          {note.highlights.map((highlight, highlightIndex) => (
                            <p
                              key={`${note.title}-highlight-${highlightIndex}`}
                              className="text-muted-foreground"
                            >
                              - {highlight}
                            </p>
                          ))}
                        </div>
                      ) : null}
                      <p className="text-muted-foreground">
                        Procedure: {note.recommendedProcedure}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Confiance: {Math.round(note.confidence * 100)}%
                      </p>
                    </CardContent>
                  </Card>
                ))
              )}
            </CardContent>
          </Card>
        </>
      ) : (
        <Card className="bg-muted/40">
          <CardContent className="pt-6">
            <div className="flex items-start gap-4">
              <ShieldAlert className="h-8 w-8 shrink-0 text-primary" />
              <div className="space-y-2">
                <h3 className="font-semibold">
                  Agent 6 - Audit, Control & Compliance
                </h3>
                <p className="text-sm text-muted-foreground">
                  Cet agent analyse l&apos;historique transactionnel, les
                  signaux de workflow et les comportements utilisateurs pour
                  aider les auditeurs a cibler leurs investigations.
                </p>
                <p className="text-sm text-muted-foreground">
                  Il reste strictement en lecture seule, ne modifie aucune
                  donnee et ne prend jamais de decision autonome.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Historique des analyses</CardTitle>
            <p className="text-sm text-muted-foreground">
              Executions precedentes de l&apos;Agent 6
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
                Aucune analyse d&apos;audit
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Lancez une analyse pour faire ressortir les premiers signaux
                d&apos;audit.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead>Modele</TableHead>
                  <TableHead>Duree</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {agentRuns.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell>{formatDateTime(run.createdAt)}</TableCell>
                    <TableCell>{runStatusBadge(run.status)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {run.modelVersion}
                    </TableCell>
                    <TableCell>
                      {run.durationMs ? `${run.durationMs}ms` : "-"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
