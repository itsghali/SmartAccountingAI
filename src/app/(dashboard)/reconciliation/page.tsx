"use client";

import { useState, useCallback } from "react";
import { useAppContext } from "@/hooks/useAppContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { formatMAD } from "@/lib/utils/currency";
import { formatDate } from "@/lib/utils/dates";
import { toast } from "sonner";
import { Search, Link2, Unlink, RefreshCw } from "lucide-react";

interface JournalEntryLine {
  id: string;
  lineNumber: number;
  accountCode: string;
  label: string;
  debit: string;
  credit: string;
  tiersName: string | null;
  dueDate: string | null;
  lettrageCode: string | null;
  isLettered: boolean;
  journalEntry: {
    id: string;
    entryNumber: number;
    entryDate: string;
    reference: string | null;
    journal: {
      code: string;
      label: string;
    };
  };
}

interface LettrageGroup {
  id: string;
  companyId: string;
  accountCode: string;
  code: string;
  isPartial: boolean;
  totalDebit: string;
  totalCredit: string;
  remainder: string;
  createdAt: string;
}

// Badge color palette for lettrage codes
const BADGE_COLORS = [
  "bg-blue-100 text-blue-800",
  "bg-green-100 text-green-800",
  "bg-purple-100 text-purple-800",
  "bg-orange-100 text-orange-800",
  "bg-pink-100 text-pink-800",
  "bg-teal-100 text-teal-800",
  "bg-yellow-100 text-yellow-800",
  "bg-indigo-100 text-indigo-800",
];

function getLettrageBadgeColor(code: string): string {
  let hash = 0;
  for (let i = 0; i < code.length; i++) {
    hash = (hash * 31 + code.charCodeAt(i)) % BADGE_COLORS.length;
  }
  return BADGE_COLORS[hash]!;
}

export default function ReconciliationPage() {
  const { currentCompanyId, currentFiscalYearId } = useAppContext();

  const [accountCodeInput, setAccountCodeInput] = useState("");
  const [loadedAccountCode, setLoadedAccountCode] = useState<string | null>(null);
  const [lines, setLines] = useState<JournalEntryLine[]>([]);
  const [lettrageGroups, setLettrageGroups] = useState<LettrageGroup[]>([]);
  const [selectedLineIds, setSelectedLineIds] = useState<Set<string>>(new Set());
  const [showLettered, setShowLettered] = useState(false);
  const [loading, setLoading] = useState(false);
  const [lettering, setLettering] = useState(false);
  const [unletteringCode, setUnletteringCode] = useState<string | null>(null);

  const loadLines = useCallback(
    async (accountCode: string, withLettered: boolean) => {
      if (!currentCompanyId || !currentFiscalYearId || !accountCode.trim()) return;
      setLoading(true);
      setSelectedLineIds(new Set());
      try {
        const params = new URLSearchParams({
          companyId: currentCompanyId,
          fiscalYearId: currentFiscalYearId,
          accountCode: accountCode.trim(),
          showLettered: String(withLettered),
        });
        const res = await fetch(`/api/reconciliation?${params}`);
        if (res.ok) {
          const data = await res.json();
          setLines(data.lines || []);
          setLettrageGroups(data.lettrageGroups || []);
          setLoadedAccountCode(accountCode.trim());
        } else {
          const err = await res.json();
          toast.error(err.error || "Erreur lors du chargement");
        }
      } catch {
        toast.error("Erreur de connexion");
      } finally {
        setLoading(false);
      }
    },
    [currentCompanyId, currentFiscalYearId]
  );

  const handleCharger = () => {
    if (!accountCodeInput.trim()) {
      toast.error("Veuillez saisir un code de compte");
      return;
    }
    loadLines(accountCodeInput, showLettered);
  };

  const handleToggleShowLettered = (checked: boolean) => {
    setShowLettered(checked);
    if (loadedAccountCode) {
      loadLines(loadedAccountCode, checked);
    }
  };

  const handleToggleLine = (lineId: string) => {
    setSelectedLineIds((prev) => {
      const next = new Set(prev);
      if (next.has(lineId)) {
        next.delete(lineId);
      } else {
        next.add(lineId);
      }
      return next;
    });
  };

  const handleToggleAll = () => {
    const unletteredLines = lines.filter((l) => !l.isLettered);
    if (selectedLineIds.size === unletteredLines.length && unletteredLines.length > 0) {
      setSelectedLineIds(new Set());
    } else {
      setSelectedLineIds(new Set(unletteredLines.map((l) => l.id)));
    }
  };

  const handleLettrer = async () => {
    if (!currentCompanyId || !currentFiscalYearId || !loadedAccountCode) return;
    if (selectedLineIds.size < 2) {
      toast.error("Sélectionnez au moins 2 lignes à lettrer");
      return;
    }
    setLettering(true);
    try {
      const res = await fetch("/api/reconciliation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: currentCompanyId,
          fiscalYearId: currentFiscalYearId,
          accountCode: loadedAccountCode,
          lineIds: Array.from(selectedLineIds),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const msg = data.isPartial
          ? `Lettrage partiel effectué — code ${data.code} (solde: ${formatMAD(data.lettrageGroup.remainder)})`
          : `Lettrage complet effectué — code ${data.code}`;
        toast.success(msg);
        loadLines(loadedAccountCode, showLettered);
      } else {
        const err = await res.json();
        toast.error(err.error || "Erreur lors du lettrage");
      }
    } catch {
      toast.error("Erreur de connexion");
    } finally {
      setLettering(false);
    }
  };

  const handleDelettrer = async (lettrageCode: string) => {
    if (!currentCompanyId || !currentFiscalYearId || !loadedAccountCode) return;
    setUnletteringCode(lettrageCode);
    try {
      const params = new URLSearchParams({
        companyId: currentCompanyId,
        fiscalYearId: currentFiscalYearId,
        accountCode: loadedAccountCode,
        lettrageCode,
      });
      const res = await fetch(`/api/reconciliation?${params}`, { method: "DELETE" });
      if (res.ok) {
        toast.success(`Lettrage ${lettrageCode} annulé`);
        loadLines(loadedAccountCode, showLettered);
      } else {
        const err = await res.json();
        toast.error(err.error || "Erreur lors du délettrage");
      }
    } catch {
      toast.error("Erreur de connexion");
    } finally {
      setUnletteringCode(null);
    }
  };

  // Running balance from selected lines
  const selectedLines = lines.filter((l) => selectedLineIds.has(l.id));
  const selectedDebit = selectedLines.reduce((s, l) => s + parseFloat(l.debit || "0"), 0);
  const selectedCredit = selectedLines.reduce((s, l) => s + parseFloat(l.credit || "0"), 0);
  const selectedDiff = selectedDebit - selectedCredit;

  // Group lettered lines by lettrage code for display
  const letteredByCode = new Map<string, JournalEntryLine[]>();
  const unletteredLines: JournalEntryLine[] = [];

  for (const line of lines) {
    if (line.isLettered && line.lettrageCode) {
      const group = letteredByCode.get(line.lettrageCode) ?? [];
      group.push(line);
      letteredByCode.set(line.lettrageCode, group);
    } else {
      unletteredLines.push(line);
    }
  }

  const unletteredCount = lines.filter((l) => !l.isLettered).length;

  if (!currentCompanyId || !currentFiscalYearId) {
    return <div className="p-6 text-gray-500">Veuillez sélectionner une société et un exercice.</div>;
  }

  return (
    <div className="p-6 max-w-7xl mx-auto animate-in fade-in duration-500">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-linear-to-r from-primary to-secondary">Lettrage</h1>
        {loadedAccountCode && (
          <Button variant="outline" size="sm" onClick={() => loadLines(loadedAccountCode, showLettered)} disabled={loading}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Actualiser
          </Button>
        )}
      </div>

      {/* Account selector */}
      <Card className="mb-8 bg-card/60 backdrop-blur-xl border-border/50 shadow-sm transition-all duration-300 hover:shadow-md">
        <CardContent className="pt-6">
          <div className="flex items-end gap-4">
            <div className="flex-1 max-w-75s">
              <Label htmlFor="accountCode" className="mb-1.5 block text-muted-foreground">Code de compte</Label>
              <Input
                id="accountCode"
                value={accountCodeInput}
                onChange={(e) => setAccountCodeInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCharger()}
                placeholder="ex: 3421, 4411, 5141..."
                className="font-mono bg-background/50"
              />
            </div>
            <Button onClick={handleCharger} disabled={loading} className="shadow-sm">
              <Search className="h-4 w-4 mr-2" />
              {loading ? "Chargement..." : "Charger"}
            </Button>
            {loadedAccountCode && (
              <div className="flex items-center gap-2 ml-4">
                <Switch
                  id="showLettered"
                  checked={showLettered}
                  onCheckedChange={handleToggleShowLettered}
                />
                <Label htmlFor="showLettered" className="cursor-pointer">
                  Afficher lignes lettrées
                </Label>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Running balance bar */}
      {selectedLineIds.size > 0 && (
        <Card className="mb-8 border-primary/20 bg-primary/5 backdrop-blur-md shadow-sm">
          <CardContent className="pt-5 pb-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex gap-8">
                <div>
                  <span className="text-xs text-gray-500 block">Débit sélectionné</span>
                  <span className="font-mono font-semibold text-green-700">{formatMAD(selectedDebit)}</span>
                </div>
                <div>
                  <span className="text-xs text-gray-500 block">Crédit sélectionné</span>
                  <span className="font-mono font-semibold text-red-700">{formatMAD(selectedCredit)}</span>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground block mb-1">Différence</span>
                  <span className={`font-mono font-bold text-lg ${Math.abs(selectedDiff) < 0.005 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>
                    {formatMAD(Math.abs(selectedDiff))}
                    {Math.abs(selectedDiff) < 0.005 && " ✓"}
                  </span>
                </div>
                <div>
                  <span className="text-xs text-gray-500 block">Lignes</span>
                  <span className="font-semibold">{selectedLineIds.size}</span>
                </div>
              </div>
              <Button onClick={handleLettrer} disabled={lettering || selectedLineIds.size < 2}>
                <Link2 className="h-4 w-4 mr-2" />
                {lettering ? "Lettrage..." : "Lettrer la sélection"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {loadedAccountCode ? (
        <>
          {/* Unlettered lines table */}
          <div className="bg-card/60 backdrop-blur-xl border border-border/50 rounded-xl overflow-hidden shadow-sm mb-8 transition-all duration-300 hover:shadow-md hover:border-primary/20">
            <div className="bg-muted/30 px-5 py-3 flex items-center justify-between border-b border-border/50">
              <h2 className="text-sm font-semibold text-foreground">
                Lignes non lettrées
                <span className="ml-2 text-muted-foreground font-normal bg-muted px-2 py-0.5 rounded-full text-xs">
                  {unletteredCount}
                </span>
              </h2>
              {unletteredCount > 0 && (
                <button
                  className="text-xs text-blue-600 hover:underline"
                  onClick={handleToggleAll}
                >
                  {selectedLineIds.size === unletteredCount ? "Tout désélectionner" : "Tout sélectionner"}
                </button>
              )}
            </div>
            <table className="w-full text-sm">
              <thead className="bg-transparent text-xs uppercase text-muted-foreground border-b border-border/50">
                <tr>
                  <th className="p-4 w-12 text-center"></th>
                  <th className="p-4 text-left font-semibold">Date</th>
                  <th className="p-4 text-left font-semibold">Journal</th>
                  <th className="p-4 text-left font-semibold">Référence</th>
                  <th className="p-4 text-left font-semibold">Libellé</th>
                  <th className="p-4 text-right font-semibold">Débit</th>
                  <th className="p-4 text-right font-semibold">Crédit</th>
                  <th className="p-4 text-left font-semibold">Échéance</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={8} className="p-12 text-center text-muted-foreground font-medium animate-pulse">Chargement...</td>
                  </tr>
                ) : unletteredLines.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-12 text-center text-muted-foreground border-dashed border-border/50">
                      Aucune ligne non lettrée pour ce compte
                    </td>
                  </tr>
                ) : (
                  unletteredLines.map((line) => (
                    <tr
                      key={line.id}
                      className={`border-t border-border/30 cursor-pointer transition-colors ${
                        selectedLineIds.has(line.id)
                          ? "bg-primary/10 hover:bg-primary/15"
                          : "hover:bg-muted/40"
                      }`}
                      onClick={() => handleToggleLine(line.id)}
                    >
                      <td className="p-4 text-center" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selectedLineIds.has(line.id)}
                          onCheckedChange={() => handleToggleLine(line.id)}
                        />
                      </td>
                      <td className="p-4 whitespace-nowrap text-muted-foreground">
                        {formatDate(line.journalEntry.entryDate)}
                      </td>
                      <td className="p-4">
                        <span className="font-mono text-xs bg-muted text-muted-foreground font-semibold px-2 py-1 rounded-md border border-border/50">
                          {line.journalEntry.journal.code}
                        </span>
                      </td>
                      <td className="p-4 text-muted-foreground font-mono text-xs">
                        {line.journalEntry.reference || `#${line.journalEntry.entryNumber}`}
                      </td>
                      <td className="p-4 max-w-50 truncate font-medium text-foreground" title={line.label}>
                        {line.label}
                        {line.tiersName && (
                          <span className="ml-2 text-muted-foreground text-xs font-normal">— {line.tiersName}</span>
                        )}
                      </td>
                      <td className="p-4 text-right font-mono text-foreground">
                        {parseFloat(line.debit) > 0 ? (
                          <span className="font-semibold">{formatMAD(line.debit)}</span>
                        ) : (
                          <span className="text-muted-foreground/30">—</span>
                        )}
                      </td>
                      <td className="p-4 text-right font-mono text-foreground">
                        {parseFloat(line.credit) > 0 ? (
                          <span className="font-semibold">{formatMAD(line.credit)}</span>
                        ) : (
                          <span className="text-muted-foreground/30">—</span>
                        )}
                      </td>
                      <td className="p-4 text-muted-foreground text-xs">
                        {line.dueDate ? formatDate(line.dueDate) : "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Lettered groups */}
          {showLettered && letteredByCode.size > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-foreground mb-4">
                Groupes lettrés
                <span className="ml-2 text-muted-foreground font-normal bg-muted px-2 py-0.5 rounded-full text-xs">
                  {letteredByCode.size}
                </span>
              </h2>
              <div className="space-y-4">
                {Array.from(letteredByCode.entries())
                  .sort(([a], [b]) => {
                    if (a.length !== b.length) return a.length - b.length;
                    return a.localeCompare(b);
                  })
                  .map(([code, groupLines]) => {
                    const groupInfo = lettrageGroups.find((g) => g.code === code);
                    const badgeColor = getLettrageBadgeColor(code);
                    return (
                      <div key={code} className="bg-card/60 backdrop-blur-xl border border-border/50 rounded-xl overflow-hidden shadow-sm transition-all duration-300 hover:shadow-md hover:border-primary/20">
                        <div className="bg-muted/30 px-5 py-3 flex items-center justify-between border-b border-border/50">
                          <div className="flex items-center gap-3">
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${badgeColor}`}>
                              {code}
                            </span>
                            {groupInfo?.isPartial && (
                              <Badge variant="secondary" className="text-xs">Partiel</Badge>
                            )}
                            {groupInfo && (
                              <span className="text-xs text-gray-500">
                                D: {formatMAD(groupInfo.totalDebit)} / C: {formatMAD(groupInfo.totalCredit)}
                                {groupInfo.isPartial && ` / Solde: ${formatMAD(groupInfo.remainder)}`}
                              </span>
                            )}
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-red-600 hover:text-red-700 hover:bg-red-50 h-7"
                            onClick={() => handleDelettrer(code)}
                            disabled={unletteringCode === code}
                          >
                            <Unlink className="h-3.5 w-3.5 mr-1" />
                            {unletteringCode === code ? "..." : "Délettrer"}
                          </Button>
                        </div>
                        <table className="w-full text-sm">
                          <tbody>
                            {groupLines.map((line) => (
                              <tr key={line.id} className="border-t hover:bg-gray-50">
                                <td className="p-3 whitespace-nowrap text-xs w-28">
                                  {formatDate(line.journalEntry.entryDate)}
                                </td>
                                <td className="p-3 w-20">
                                  <span className="font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded">
                                    {line.journalEntry.journal.code}
                                  </span>
                                </td>
                                <td className="p-3 text-gray-500 font-mono text-xs w-28">
                                  {line.journalEntry.reference || `#${line.journalEntry.entryNumber}`}
                                </td>
                                <td className="p-3 max-w-50 truncate text-gray-700" title={line.label}>
                                  {line.label}
                                </td>
                                <td className="p-3 text-right font-mono w-28">
                                  {parseFloat(line.debit) > 0 ? formatMAD(line.debit) : <span className="text-gray-300">—</span>}
                                </td>
                                <td className="p-3 text-right font-mono w-28">
                                  {parseFloat(line.credit) > 0 ? formatMAD(line.credit) : <span className="text-gray-300">—</span>}
                                </td>
                                <td className="p-3 text-xs text-gray-400 w-24">
                                  {line.dueDate ? formatDate(line.dueDate) : "—"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="text-center py-20 text-muted-foreground border border-dashed border-border/50 rounded-xl bg-card/30 backdrop-blur-sm max-w-2xl mx-auto mt-12">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-muted/50 mb-6">
            <Link2 className="h-10 w-10 text-muted-foreground" />
          </div>
          <p className="text-xl font-medium text-foreground mb-2">Saisissez un code de compte pour commencer le lettrage</p>
          <p className="text-sm">Exemples: 3421 (clients), 4411 (fournisseurs), 5141 (banque)</p>
        </div>
      )}
    </div>
  );
}
