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
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">État du Journal</h1>
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
      <div className="flex flex-wrap gap-4 mb-6 items-end">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Journal
          </label>
          <Select value={selectedJournal} onValueChange={(v) => v !== null && setSelectedJournal(v)}>
            <SelectTrigger className="w-[240px]">
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
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Date début
          </label>
          <Input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-[160px]"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Date fin
          </label>
          <Input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="w-[160px]"
          />
        </div>
      </div>

      {/* Summary */}
      <div className="text-sm text-gray-500 mb-4">
        {totalEntries} écriture(s) dans {journalGroups.length} journal(aux)
      </div>

      {/* Content */}
      {loading ? (
        <div className="p-8 text-center text-gray-400">Chargement...</div>
      ) : journalGroups.length === 0 ? (
        <div className="p-8 text-center text-gray-400">
          Aucune écriture trouvée pour la période sélectionnée
        </div>
      ) : (
        <div className="space-y-6">
          {journalGroups.map((group) => (
            <div key={group.journalCode} className="print:break-inside-avoid">
              {/* Journal header */}
              <div className="bg-blue-50 p-3 rounded-t-lg border border-b-0 print:bg-white print:border-b">
                <h2 className="text-lg font-semibold text-gray-800">
                  <span className="font-mono text-blue-700">
                    {group.journalCode}
                  </span>{" "}
                  — {group.journalLabel}
                  <span className="text-sm font-normal text-gray-500 ml-3">
                    ({group.entries.length} écriture(s))
                  </span>
                </h2>
              </div>

              {/* Entries — one card per entry */}
              <div className="space-y-3 mt-3">
                {group.entries.map((entry) => (
                  <div
                    key={entry.id}
                    className="border rounded-lg overflow-hidden shadow-sm"
                  >
                    {/* Entry header */}
                    <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 bg-gray-50 border-b text-sm print:bg-white">
                      <span className="font-mono font-semibold text-gray-800">
                        N° {entry.entryNumber}
                      </span>
                      <span className="text-gray-500">{formatDate(entry.entryDate)}</span>
                      <span className="font-medium text-gray-800 flex-1">
                        {entry.description}
                      </span>
                      {(entry.reference || entry.piece) && (
                        <span className="text-gray-500 text-xs">
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
                      <thead className="text-xs uppercase text-gray-400 bg-white">
                        <tr>
                          <th className="p-2 pl-4 text-left">Compte</th>
                          <th className="p-2 text-left">Libellé du compte</th>
                          <th className="p-2 text-left">Libellé</th>
                          <th className="p-2 text-right">Débit</th>
                          <th className="p-2 pr-4 text-right">Crédit</th>
                        </tr>
                      </thead>
                      <tbody>
                        {entry.lines.map((line) => (
                          <tr
                            key={line.id}
                            className="border-t border-gray-100 hover:bg-gray-50"
                          >
                            <td className="p-2 pl-4 font-mono text-sm font-medium text-blue-700">
                              {line.accountCode}
                            </td>
                            <td className="p-2 text-sm text-gray-600">
                              {line.account.label}
                            </td>
                            <td className="p-2 text-sm">{line.label}</td>
                            <td className="p-2 text-right font-mono text-sm">
                              {parseFloat(line.debit) > 0
                                ? formatMAD(line.debit)
                                : ""}
                            </td>
                            <td className="p-2 pr-4 text-right font-mono text-sm">
                              {parseFloat(line.credit) > 0
                                ? formatMAD(line.credit)
                                : ""}
                            </td>
                          </tr>
                        ))}
                        {/* Entry total */}
                        <tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold text-sm">
                          <td className="p-2 pl-4 text-gray-600" colSpan={3}>
                            Total N° {entry.entryNumber}
                          </td>
                          <td className="p-2 text-right font-mono text-gray-800">
                            {formatMAD(entry.totalDebit)}
                          </td>
                          <td className="p-2 pr-4 text-right font-mono text-gray-800">
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
