"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useAppContext } from "@/hooks/useAppContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Eye, RotateCcw, Trash2 } from "lucide-react";
import { formatMAD } from "@/lib/utils/currency";
import { formatMonth } from "@/lib/utils/dates";
import { toast } from "sonner";

interface Journal {
  id: string;
  code: string;
  label: string;
}

interface Entry {
  id: string;
  entryNumber: number;
  entryDate: string;
  reference: string | null;
  piece: string | null;
  description: string;
  status: "DRAFT" | "VALIDATED" | "REVERSED";
  totalDebit: string;
  totalCredit: string;
  journal: { code: string; label: string };
  createdBy: { firstName: string; lastName: string };
}

const statusConfig = {
  DRAFT: { label: "Brouillon", variant: "secondary" as const },
  VALIDATED: { label: "Validée", variant: "default" as const },
  REVERSED: { label: "Contrepassée", variant: "destructive" as const },
};

export default function EntriesPage() {
  const { currentCompanyId, currentFiscalYearId } = useAppContext();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [journals, setJournals] = useState<Journal[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filterJournal, setFilterJournal] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (!currentCompanyId) return;
    fetch(`/api/journals?companyId=${currentCompanyId}`)
      .then((r) => r.json())
      .then(setJournals)
      .catch(() => {});
  }, [currentCompanyId]);

  useEffect(() => {
    if (!currentCompanyId || !currentFiscalYearId) return;

    const loadEntries = async () => {
      setLoading(true);
      const params = new URLSearchParams({
        companyId: currentCompanyId,
        fiscalYearId: currentFiscalYearId,
        page: page.toString(),
        limit: "50",
      });
      if (filterJournal !== "all") params.set("journalId", filterJournal);
      if (filterStatus !== "all") params.set("status", filterStatus);

      try {
        const response = await fetch(`/api/entries?${params}`);
        const data = await response.json();
        setEntries(data.entries || []);
        setTotal(data.total || 0);
      } catch {
        setEntries([]);
        setTotal(0);
      } finally {
        setLoading(false);
      }
    };

    void loadEntries();
  }, [currentCompanyId, currentFiscalYearId, filterJournal, filterStatus, page]);

  const handleDelete = async (id: string) => {
    if (!confirm("Supprimer ce brouillon ?")) return;
    const res = await fetch(`/api/entries/${id}`, { method: "DELETE" });
    if (res.ok) {
      setEntries((prev) => prev.filter((e) => e.id !== id));
      toast.success("Brouillon supprimé");
    } else {
      toast.error("Erreur lors de la suppression");
    }
  };

  const handleReverse = async (id: string) => {
    if (!confirm("Contrepasser cette écriture ?")) return;
    const res = await fetch(`/api/entries/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reverse" }),
    });
    if (res.ok) {
      toast.success("Écriture contrepassée");
      // Refresh
      setPage(1);
    } else {
      const data = await res.json();
      toast.error(data.error || "Erreur");
    }
  };

  if (!currentCompanyId || !currentFiscalYearId) {
    return (
      <div className="p-6 text-gray-500">
        Veuillez sélectionner une société et un exercice comptable.
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-linear-to-r from-primary to-secondary">
          Écritures Comptables
        </h1>
        <Link href="/entries/new">
          <Button>
            <Plus className="h-4 w-4 mr-2" /> Nouvelle Écriture
          </Button>
        </Link>
      </div>

      {/* Filters */}
      <div className="flex gap-4 mb-4">
        <Select value={filterJournal} onValueChange={(v) => v !== null && setFilterJournal(v)}>
          <SelectTrigger className="w-50">
            <SelectValue placeholder="Tous les journaux">
              {filterJournal === "all"
                ? "Tous les journaux"
                : (() => {
                    const j = journals.find((x) => x.id === filterJournal);
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

        <Select value={filterStatus} onValueChange={(v) => v !== null && setFilterStatus(v)}>
          <SelectTrigger className="w-45">
            <SelectValue placeholder="Tous les statuts" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous les statuts</SelectItem>
            <SelectItem value="DRAFT">Brouillon</SelectItem>
            <SelectItem value="VALIDATED">Validée</SelectItem>
            <SelectItem value="REVERSED">Contrepassée</SelectItem>
          </SelectContent>
        </Select>

        <div className="text-sm font-medium text-muted-foreground self-center ml-auto">
          {total} écriture(s)
        </div>
      </div>

      {/* Table */}
      <div className="bg-card/60 backdrop-blur-md border border-border/50 shadow-sm rounded-xl overflow-hidden transition-all duration-300 hover:shadow-md">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase text-muted-foreground font-semibold border-b border-border/50">
            <tr>
              <th className="p-3 text-left">Journal</th>
              <th className="p-3 text-left">N°</th>
              <th className="p-3 text-left">Période</th>
              <th className="p-3 text-left">Description</th>
              <th className="p-3 text-left">Pièce / Référence</th>
              <th className="p-3 text-right">Débit</th>
              <th className="p-3 text-right">Crédit</th>
              <th className="p-3 text-center">Statut</th>
              <th className="p-3 text-center">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={9} className="p-8 text-center text-gray-400">
                  Chargement...
                </td>
              </tr>
            ) : entries.length === 0 ? (
              <tr>
                <td colSpan={9} className="p-8 text-center text-gray-400">
                  Aucune écriture trouvée
                </td>
              </tr>
            ) : (
              entries.map((entry) => (
                <tr key={entry.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                  <td className="p-3 font-mono text-sm font-semibold text-primary">
                    {entry.journal.code}
                  </td>
                  <td className="p-3 font-mono text-sm">{entry.entryNumber}</td>
                  <td className="p-3 text-sm font-mono text-muted-foreground">{formatMonth(entry.entryDate)}</td>
                  <td className="p-3 text-sm font-medium">{entry.description}</td>
                  <td className="p-3 text-sm text-muted-foreground">{entry.piece || entry.reference || "—"}</td>
                  <td className="p-3 text-right font-mono text-sm font-medium">
                    {formatMAD(entry.totalDebit)}
                  </td>
                  <td className="p-3 text-right font-mono text-sm">
                    {formatMAD(entry.totalCredit)}
                  </td>
                  <td className="p-3 text-center">
                    <Badge variant={statusConfig[entry.status].variant}>
                      {statusConfig[entry.status].label}
                    </Badge>
                  </td>
                  <td className="p-3">
                    <div className="flex justify-center gap-1">
                      <Link href={`/entries/${entry.id}`}>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                      </Link>
                      {entry.status === "VALIDATED" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-orange-500"
                          onClick={() => handleReverse(entry.id)}
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {entry.status === "DRAFT" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-red-500"
                          onClick={() => handleDelete(entry.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between mt-4 bg-card/40 backdrop-blur-sm p-4 rounded-xl border border-border/50">
        <Button 
          variant="outline" 
          disabled={page <= 1}
          onClick={() => setPage(p => p - 1)}
          className="hover:bg-primary hover:text-primary-foreground transition-colors"
        >
          Précédent
        </Button>
        <div className="text-sm font-medium text-muted-foreground">
          Page <span className="text-foreground">{page}</span> sur <span className="text-foreground">{Math.max(1, Math.ceil(total / 50))}</span>
        </div>
        <Button 
          variant="outline" 
          disabled={page >= Math.ceil(total / 50)}
          onClick={() => setPage(p => p + 1)}
          className="hover:bg-primary hover:text-primary-foreground transition-colors"
        >
          Suivant
        </Button>
      </div>
    </div>
  );
}
