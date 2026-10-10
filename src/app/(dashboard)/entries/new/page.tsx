"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { EntryGrid, EntryLine } from "@/components/entries/EntryGrid";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAppContext } from "@/hooks/useAppContext";
import { toast } from "sonner";
import { Save, CheckCircle, FileText, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface Journal {
  id: string;
  code: string;
  label: string;
  type: string;
}

interface ProposalLine {
  lineNumber: number;
  accountCode: string;
  accountLabel: string;
  label: string;
  debit: number;
  credit: number;
}

interface ProposalSuggestionValue {
  proposedEntry: {
    journalCode: string;
    journalLabel: string;
    entryDate: string;
    reference?: string;
    description: string;
    lines: ProposalLine[];
  };
}

interface ProposalSuggestionResponse {
  id: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CORRECTED";
  agentType: string;
  value: ProposalSuggestionValue;
  finalValue: ProposalSuggestionValue | null;
  document: {
    id: string;
    originalFilename: string;
    status: string;
  } | null;
}

let lineCounter = 0;

export default function NewEntryPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { currentCompanyId, currentFiscalYearId } = useAppContext();
  const [journals, setJournals] = useState<Journal[]>([]);
  const [journalId, setJournalId] = useState("");
  const [entryDate, setEntryDate] = useState(new Date().toISOString().slice(0, 7));
  const [piece, setPiece] = useState("");
  const [description, setDescription] = useState("");
  const [proposalSource, setProposalSource] = useState<ProposalSuggestionResponse | null>(null);
  const [lines, setLines] = useState<EntryLine[]>([
    { id: `new-${++lineCounter}`, lineNumber: 1, accountCode: "", label: "", debit: 0, credit: 0 },
    { id: `new-${++lineCounter}`, lineNumber: 2, accountCode: "", label: "", debit: 0, credit: 0 },
  ]);
  const [saving, setSaving] = useState(false);
  const hasAppliedProposal = useRef(false);
  const proposalId = searchParams.get("proposalId");

  useEffect(() => {
    if (!currentCompanyId) return;
    fetch(`/api/journals?companyId=${currentCompanyId}`)
      .then((r) => r.json())
      .then(setJournals)
      .catch(() => {});
  }, [currentCompanyId]);

  useEffect(() => {
    hasAppliedProposal.current = false;

    if (!proposalId) {
      setProposalSource(null);
      return;
    }

    fetch(`/api/suggestions/${proposalId}`)
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error || "Impossible de charger la proposition");
        }
        return payload.suggestion as ProposalSuggestionResponse;
      })
      .then((suggestion) => {
        if (suggestion.agentType !== "ACCOUNTING_ENTRY_PREPARER") {
          throw new Error("Cette suggestion ne correspond pas a une proposition d'ecriture.");
        }

        if (suggestion.status !== "APPROVED" && suggestion.status !== "CORRECTED") {
          throw new Error("La proposition doit etre approuvee avant de pouvoir pre-remplir une ecriture.");
        }

        setProposalSource(suggestion);
      })
      .catch((error) => {
        toast.error(error instanceof Error ? error.message : "Chargement de la proposition impossible");
      });
  }, [proposalId]);

  useEffect(() => {
    if (!proposalSource || journals.length === 0 || hasAppliedProposal.current) {
      return;
    }

    const proposal = proposalSource.finalValue ?? proposalSource.value;
    const matchingJournal = journals.find(
      (journal) => journal.code === proposal.proposedEntry.journalCode
    );

    setJournalId(matchingJournal?.id ?? "");
    // Convertir la date en format mois YYYY-MM
    setEntryDate(proposal.proposedEntry.entryDate.slice(0, 7));
    // Pièce : nom du document ou référence de la proposition
    setPiece(
      proposalSource.document?.originalFilename ??
      proposal.proposedEntry.reference ??
      ""
    );
    setDescription(proposal.proposedEntry.description);
    setLines(
      proposal.proposedEntry.lines.map((line) => ({
        id: `proposal-${proposalSource.id}-${line.lineNumber}`,
        lineNumber: line.lineNumber,
        accountCode: line.accountCode,
        label: line.label,
        debit: line.debit,
        credit: line.credit,
      }))
    );
    hasAppliedProposal.current = true;
  }, [journals, proposalSource]);

  const handleSave = useCallback(
    async (validate: boolean = false) => {
      if (!currentCompanyId || !currentFiscalYearId || !journalId) {
        toast.error("Veuillez sélectionner un journal");
        return;
      }

      if (!description.trim()) {
        toast.error("La description est requise");
        return;
      }

      const validLines = lines.filter((l) => l.accountCode && (l.debit > 0 || l.credit > 0));
      if (validLines.length < 2) {
        toast.error("Au moins 2 lignes valides sont requises");
        return;
      }

      setSaving(true);
      try {
        // Convertir le mois (YYYY-MM) en dernier jour du mois pour le stockage
        const [year, month] = entryDate.split("-").map(Number);
        const lastDayOfMonth = new Date(year!, month!, 0).getDate();
        const fullEntryDate = `${entryDate}-${String(lastDayOfMonth).padStart(2, "0")}`;

        const res = await fetch("/api/entries", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            journalId,
            fiscalYearId: currentFiscalYearId,
            entryDate: fullEntryDate,
            reference: piece || undefined,
            description,
            piece: piece || undefined,
            origin: proposalSource ? "AUTO" : undefined,
            sourceModule: proposalSource ? "DOCUMENT_ENTRY_PROPOSAL" : undefined,
            sourceId: proposalSource?.id,
            lines: validLines.map((l, i) => ({
              lineNumber: i + 1,
              accountCode: l.accountCode,
              label: l.label,
              debit: l.debit,
              credit: l.credit,
            })),
          }),
        });

        if (!res.ok) {
          const data = await res.json();
          toast.error(data.error || "Erreur lors de la sauvegarde");
          return;
        }

        const entry = await res.json();

        if (validate) {
          await fetch(`/api/entries/${entry.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "validate" }),
          });
          toast.success("Écriture validée avec succès");
        } else {
          toast.success("Brouillon enregistré");
        }

        router.push("/entries");
      } catch {
        toast.error("Erreur de connexion");
      } finally {
        setSaving(false);
      }
    },
    [
      currentCompanyId,
      currentFiscalYearId,
      journalId,
      entryDate,
      description,
      piece,
      lines,
      proposalSource,
      router,
    ]
  );

  useEffect(() => {
    function handleKeyboard(e: KeyboardEvent) {
      if (e.ctrlKey && e.key === "s") {
        e.preventDefault();
        handleSave(false);
      }
      if (e.ctrlKey && e.key === "Enter") {
        e.preventDefault();
        handleSave(true);
      }
    }
    window.addEventListener("keydown", handleKeyboard);
    return () => window.removeEventListener("keydown", handleKeyboard);
  }, [handleSave]);

  if (!currentCompanyId || !currentFiscalYearId) {
    return (
      <div className="p-6">
        <p className="text-gray-500">
          Veuillez sélectionner une société et un exercice comptable.
        </p>
      </div>
    );
  }

  const selectedJournal = journals.find((j) => j.id === journalId);

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Nouvelle Écriture Comptable</h1>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => handleSave(false)}
            disabled={saving}
          >
            <Save className="h-4 w-4 mr-2" />
            Enregistrer brouillon
            <span className="ml-2 text-xs text-gray-400">Ctrl+S</span>
          </Button>
          <Button
            onClick={() => handleSave(true)}
            disabled={saving}
            className="bg-green-600 hover:bg-green-700"
          >
            <CheckCircle className="h-4 w-4 mr-2" />
            Valider
            <span className="ml-2 text-xs text-green-200">Ctrl+Enter</span>
          </Button>
        </div>
      </div>

      {proposalSource && (
        <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="flex items-center gap-2 text-blue-900">
                <Sparkles className="h-4 w-4" />
                <span className="font-medium">Pré-remplie depuis une proposition approuvée</span>
                <Badge className="bg-blue-100 text-blue-700">{proposalSource.status}</Badge>
              </div>
              <p className="mt-1 text-sm text-blue-800">
                Cette écriture reprend la proposition IA validée pour{" "}
                {proposalSource.document?.originalFilename ?? "le document source"}.
              </p>
            </div>
            {proposalSource.document && (
              <Link href={`/documents/${proposalSource.document.id}`}>
                <Button variant="outline">Voir le document</Button>
              </Link>
            )}
          </div>
        </div>
      )}

      {/* Header fields */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6 p-4 bg-gray-50 rounded-lg">
        <div>
          <Label>Journal *</Label>
          <Select value={journalId} onValueChange={(v) => v !== null && setJournalId(v)}>
            <SelectTrigger>
              <SelectValue placeholder="Sélectionner...">
                {selectedJournal ? `${selectedJournal.code} — ${selectedJournal.label}` : undefined}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {journals.map((j) => (
                <SelectItem key={j.id} value={j.id}>
                  {j.code} — {j.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Période *</Label>
          <Input
            type="month"
            value={entryDate}
            onChange={(e) => setEntryDate(e.target.value)}
          />
        </div>
        <div className="col-span-2">
          <Label>Pièce / Référence</Label>
          <Input
            value={piece}
            onChange={(e) => setPiece(e.target.value)}
            placeholder="N° facture, pièce justificative..."
          />
        </div>
        <div className="col-span-2 md:col-span-4">
          <Label>Description *</Label>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description de l'écriture"
          />
        </div>
      </div>

      {/* Entry Grid */}
      <EntryGrid
        companyId={currentCompanyId}
        lines={lines}
        onChange={setLines}
      />

      <div className="mt-4 text-sm text-gray-500">
        <FileText className="h-4 w-4 inline mr-1" />
        Raccourcis: <kbd className="px-1 bg-gray-100 rounded">Tab</kbd> navigation,{" "}
        <kbd className="px-1 bg-gray-100 rounded">Enter</kbd> nouvelle ligne,{" "}
        <kbd className="px-1 bg-gray-100 rounded">+</kbd> équilibrage auto,{" "}
        <kbd className="px-1 bg-gray-100 rounded">F4</kbd> recherche compte
      </div>
    </div>
  );
}
