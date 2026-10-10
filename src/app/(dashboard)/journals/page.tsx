"use client";

import { useState, useEffect, useCallback } from "react";
import { useAppContext } from "@/hooks/useAppContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus } from "lucide-react";

interface Journal {
  id: string;
  code: string;
  label: string;
  type: string;
  defaultCounterpartAccountCode: string | null;
  isSystem: boolean;
  isActive: boolean;
}

const typeLabels: Record<string, string> = {
  PURCHASES: "Achats",
  SALES: "Ventes",
  BANK: "Banque",
  CASH: "Caisse",
  MISCELLANEOUS: "Opérations Diverses",
  OPENING: "À Nouveaux",
  PAYROLL: "Salaires",
  CLOSING: "Clôture",
  OTHER: "Autre",
};

export default function JournalsPage() {
  const { currentCompanyId } = useAppContext();
  const [journals, setJournals] = useState<Journal[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDialog, setShowDialog] = useState(false);
  const [newJournal, setNewJournal] = useState({
    code: "",
    label: "",
    type: "OTHER",
    defaultCounterpartAccountCode: "",
  });

  const loadJournals = useCallback(async () => {
    if (!currentCompanyId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/journals?companyId=${currentCompanyId}`);
      if (res.ok) setJournals(await res.json());
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [currentCompanyId]);

  useEffect(() => { loadJournals(); }, [loadJournals]);

  const handleCreate = async () => {
    if (!currentCompanyId || !newJournal.code || !newJournal.label) {
      toast.error("Code et libellé requis");
      return;
    }
    try {
      const res = await fetch("/api/journals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...newJournal, companyId: currentCompanyId }),
      });
      if (res.ok) {
        toast.success("Journal créé");
        setShowDialog(false);
        setNewJournal({ code: "", label: "", type: "OTHER", defaultCounterpartAccountCode: "" });
        loadJournals();
      } else {
        const err = await res.json();
        toast.error(err.error || "Erreur");
      }
    } catch {
      toast.error("Erreur de connexion");
    }
  };

  if (!currentCompanyId) {
    return <div className="p-6 text-gray-500">Veuillez sélectionner une société.</div>;
  }

  return (
    <div className="p-6 max-w-5xl mx-auto animate-in fade-in duration-500">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-linear-to-r from-primary to-secondary">
          Journaux Comptables
        </h1>
        <Dialog open={showDialog} onOpenChange={setShowDialog}>
          <DialogTrigger>
            <Button><Plus className="h-4 w-4 mr-2" /> Nouveau journal</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Nouveau journal</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Code *</Label>
                <Input value={newJournal.code} onChange={(e) => setNewJournal({ ...newJournal, code: e.target.value.toUpperCase() })} placeholder="BQ2" className="font-mono" maxLength={5} />
              </div>
              <div>
                <Label>Libellé *</Label>
                <Input value={newJournal.label} onChange={(e) => setNewJournal({ ...newJournal, label: e.target.value })} placeholder="Journal de Banque 2" />
              </div>
              <div>
                <Label>Type</Label>
                <Select value={newJournal.type} onValueChange={(v) => v !== null && setNewJournal({ ...newJournal, type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(typeLabels).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Compte contrepartie par défaut</Label>
                <Input value={newJournal.defaultCounterpartAccountCode} onChange={(e) => setNewJournal({ ...newJournal, defaultCounterpartAccountCode: e.target.value })} placeholder="5141" className="font-mono" />
              </div>
              <Button onClick={handleCreate} className="w-full">Créer</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="bg-card/60 backdrop-blur-xl border border-border/50 rounded-xl overflow-hidden shadow-sm transition-all duration-300 hover:shadow-md hover:border-primary/20">
        <table className="w-full">
          <thead className="bg-muted/50 text-xs uppercase text-muted-foreground border-b border-border/50">
            <tr>
              <th className="p-4 text-left font-semibold">Code</th>
              <th className="p-4 text-left font-semibold">Libellé</th>
              <th className="p-4 text-left font-semibold">Type</th>
              <th className="p-4 text-left font-semibold">Compte contrepartie</th>
              <th className="p-4 text-center font-semibold">Système</th>
              <th className="p-4 text-center font-semibold">Actif</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="p-12 text-center text-muted-foreground font-medium animate-pulse">Chargement...</td></tr>
            ) : journals.length === 0 ? (
              <tr><td colSpan={6} className="p-12 text-center text-muted-foreground border-dashed border-border/50">Aucun journal trouvé.</td></tr>
            ) : journals.map((journal) => (
              <tr key={journal.id} className="border-t border-border/50 hover:bg-muted/40 transition-colors">
                <td className="p-4 font-mono font-bold text-primary tracking-wide">{journal.code}</td>
                <td className="p-4 text-sm font-medium">{journal.label}</td>
                <td className="p-4 text-sm">
                  <Badge variant="outline">{typeLabels[journal.type] || journal.type}</Badge>
                </td>
                <td className="p-4 font-mono text-sm text-muted-foreground">
                  {journal.defaultCounterpartAccountCode || "—"}
                </td>
                <td className="p-4 text-center">
                  {journal.isSystem && <Badge variant="secondary" className="bg-muted text-muted-foreground">Système</Badge>}
                </td>
                <td className="p-4 text-center">
                  <span className={`h-2.5 w-2.5 rounded-full inline-block shadow-sm ${journal.isActive ? "bg-emerald-500" : "bg-muted"}`} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
