"use client";

import { useState, useEffect, useCallback } from "react";
import { useAppContext } from "@/hooks/useAppContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Download, Printer } from "lucide-react";
import { formatMAD } from "@/lib/utils/currency";
import { formatDate } from "@/lib/utils/dates";
import { toast } from "sonner";

interface Journal {
  id: string;
  code: string;
  label: string;
}

interface EntryLine {
  id: string;
  lineNumber: number;
  accountCode: string;
  label: string;
  debit: string;
  credit: string;
  account: { code: string; label: string };
}

interface Entry {
  id: string;
  entryNumber: number;
  entryDate: string;
  reference: string | null;
  description: string;
  piece: string | null;
  status: "DRAFT" | "VALIDATED" | "REVERSED";
  totalDebit: string;
  totalCredit: string;
  journal: { code: string; label: string };
  lines: EntryLine[];
  createdBy: { firstName: string; lastName: string };
}

interface JournalGroup {
  journalCode: string;
  journalLabel: string;
  entries: Entry[];
}

const statusConfig = {
  DRAFT: { label: "Brouillon", variant: "secondary" as const },
  VALIDATED: { label: "Validée", variant: "default" as const },
  REVERSED: { label: "Contrepassée", variant: "destructive" as const },
};

export default function JournalReportPage() {
  const { currentCompanyId, currentFiscalYearId, fiscalYears } = useAppContext();

  const [journalGroups, setJournalGroups] = useState<JournalGroup[]>([]);
  const [journals, setJournals] = useState<Journal[]>([]);
  const [loading, setLoading] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [selectedJournal, setSelectedJournal] = useState("all");
  const [totalEntries, setTotalEntries] = useState(0);

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

  // Load journals list
  useEffect(() => {
    if (!currentCompanyId) return;
    fetch(`/api/journals?companyId=${currentCompanyId}`)
      .then((r) => r.json())
      .then(setJournals)
      .catch(() => {});
  }, [currentCompanyId]);

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
      if (selectedJournal !== "all") params.set("journalId", selectedJournal);

      const res = await fetch(`/api/reports/journal?${params}`);
      if (!res.ok) throw new Error("Erreur lors du chargement");
      const data = await res.json();
      setJournalGroups(data.journals || []);
      setTotalEntries(data.totalEntries || 0);
    } catch {
      toast.error("Erreur lors du chargement du journal");
    } finally {
      setLoading(false);
    }
  }, [currentCompanyId, currentFiscalYearId, startDate, endDate, selectedJournal]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleExportCSV = () => {
    if (journalGroups.length === 0) return;

    const header = "Journal;N°;Écriture;Date;Référence;Statut;Compte;Libellé;Débit;Crédit";
    const rows: string[] = [];

    for (const group of journalGroups) {
      for (const entry of group.entries) {
        for (const line of entry.lines) {
          rows.push(
            `${group.journalCode};${entry.entryNumber};${entry.description};${entry.entryDate.substring(0, 10)};${entry.reference || ""};${entry.status};${line.accountCode};${line.label};${line.debit};${line.credit}`
          );
        }
      }
    }

    const csv = [header, ...rows].join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `journal_${startDate}_${endDate}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handlePrint = () => {
    window.print();
  };

  if (!currentCompanyId || !currentFiscalYearId) {
    return (
      <div className="p-6 text-gray-500">
        Veuillez sélectionner une société et un exercice comptable.
      </div>
    );
  }

  return (
    <div className="p-6 max-w-400 mx-auto animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-linear-to-r from-primary to-secondary">État du Journal</h1>
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
      <div className="flex flex-wrap gap-6 mb-8 p-6 bg-card/60 backdrop-blur-md border border-border/50 shadow-sm rounded-xl items-end transition-all duration-300 hover:shadow-md">
        <div>
          <label className="block text-sm font-medium text-muted-foreground mb-1.5">
            Journal
          </label>
          <Select value={selectedJournal} onValueChange={(v) => v !== null && setSelectedJournal(v)}>
            <SelectTrigger className="w-60">
              <SelectValue placeholder="Tous les journaux">
                {selectedJournal === "all"
                  ? "Tous les journaux"
                  : (() => {
                      const j = journals.find((x) => x.id === selectedJournal);
                      return j ? `${j.code} — ${j.label}` : undefined;
                    })()}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous les journaux</SelectItem>
              {journals.map((j) => (
                <SelectItem key={j.id} value={j.id}>
                  {j.code} — {j.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="block text-sm font-medium text-muted-foreground mb-1.5">
            Date début
          </label>
          <Input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-40"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-muted-foreground mb-1.5">
            Date fin
          </label>
          <Input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="w-40"
          />
        </div>
      </div>

      {/* Summary */}
      <div className="text-sm text-gray-500 mb-4">
        {totalEntries} écriture(s) dans {journalGroups.length} journal(aux)
      </div>

      {/* Content */}
      {loading ? (
        <div className="p-12 text-center text-muted-foreground font-medium animate-pulse">Chargement...</div>
      ) : journalGroups.length === 0 ? (
        <div className="p-12 text-center text-muted-foreground bg-card/30 backdrop-blur-sm border border-dashed border-border/50 rounded-xl">
          Aucune écriture trouvée pour la période sélectionnée
        </div>
      ) : (
        <div className="space-y-6">
          {journalGroups.map((group) => (
            <div key={group.journalCode} className="print:break-inside-avoid">
              {/* Journal header */}
              <div className="bg-primary/5 p-4 rounded-xl border border-primary/20 mb-4 print:bg-white print:border-b shadow-sm">
                <h2 className="text-xl font-semibold text-foreground flex items-center">
                  <span className="font-mono text-primary font-bold mr-2">
                    {group.journalCode}
                  </span>
                  <span className="text-muted-foreground mr-3">—</span>
                  {group.journalLabel}
                  <span className="text-sm font-medium text-muted-foreground ml-4 bg-muted px-2.5 py-0.5 rounded-full">
                    {group.entries.length} écriture(s)
                  </span>
                </h2>
              </div>

              {/* Entries — one card per entry */}
              <div className="space-y-4">
                {group.entries.map((entry) => (
                  <div
                    key={entry.id}
                    className="border border-border/50 rounded-xl overflow-hidden shadow-sm bg-card/60 backdrop-blur-xl transition-all duration-300 hover:shadow-md hover:border-primary/20"
                  >
                    {/* Entry header */}
                    <div className="flex flex-wrap items-center gap-4 px-5 py-3 bg-muted/30 border-b border-border/50 text-sm print:bg-white">
                      <span className="font-mono font-bold text-foreground">
                        N° {entry.entryNumber}
                      </span>
                      <span className="text-muted-foreground font-medium">{formatDate(entry.entryDate)}</span>
                      <span className="font-medium text-foreground flex-1">
                        {entry.description}
                      </span>
                      {(entry.reference || entry.piece) && (
                        <span className="text-muted-foreground/80 text-xs px-2 py-1 bg-muted rounded-md border border-border/50">
                          {entry.piece ? `Pièce: ${entry.piece}` : `Réf: ${entry.reference}`}
                        </span>
                      )}
                      <Badge
                        variant={statusConfig[entry.status].variant}
                      >
                        {statusConfig[entry.status].label}
                      </Badge>
                    </div>

                    {/* Entry lines */}
                    <table className="w-full">
                      <thead className="text-xs uppercase text-muted-foreground bg-transparent border-b border-border/50">
                        <tr>
                          <th className="p-3 pl-5 text-left font-semibold">Compte</th>
                          <th className="p-3 text-left font-semibold">Libellé du compte</th>
                          <th className="p-3 text-left font-semibold">Libellé</th>
                          <th className="p-3 text-right font-semibold">Débit</th>
                          <th className="p-3 pr-5 text-right font-semibold">Crédit</th>
                        </tr>
                      </thead>
                      <tbody>
                        {entry.lines.map((line) => (
                          <tr
                            key={line.id}
                            className="border-t border-border/30 hover:bg-muted/40 transition-colors"
                          >
                            <td className="p-3 pl-5 font-mono text-sm font-bold text-primary tracking-wide">
                              {line.accountCode}
                            </td>
                            <td className="p-3 text-sm font-medium text-muted-foreground">
                              {line.account.label}
                            </td>
                            <td className="p-3 text-sm">{line.label}</td>
                            <td className="p-3 text-right font-mono text-sm text-foreground">
                              {parseFloat(line.debit) > 0
                                ? formatMAD(line.debit)
                                : ""}
                            </td>
                            <td className="p-3 pr-5 text-right font-mono text-sm text-foreground">
                              {parseFloat(line.credit) > 0
                                ? formatMAD(line.credit)
                                : ""}
                            </td>
                          </tr>
                        ))}
                        {/* Entry total */}
                        <tr className="border-t-2 border-border/50 bg-muted/20 font-bold text-sm">
                          <td className="p-4 pl-5 text-foreground" colSpan={3}>
                            Total N° {entry.entryNumber}
                          </td>
                          <td className="p-4 text-right font-mono text-foreground">
                            {formatMAD(entry.totalDebit)}
                          </td>
                          <td className="p-4 pr-5 text-right font-mono text-foreground">
                            {formatMAD(entry.totalCredit)}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
