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
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Journaux Comptables</h1>
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

      <div className="border rounded-lg overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 text-xs uppercase text-gray-500">
            <tr>
              <th className="p-3 text-left">Code</th>
              <th className="p-3 text-left">Libellé</th>
              <th className="p-3 text-left">Type</th>
              <th className="p-3 text-left">Compte contrepartie</th>
              <th className="p-3 text-center">Système</th>
              <th className="p-3 text-center">Actif</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="p-8 text-center text-gray-400">Chargement...</td></tr>
            ) : journals.map((journal) => (
              <tr key={journal.id} className="border-t hover:bg-gray-50">
                <td className="p-3 font-mono font-medium text-blue-700">{journal.code}</td>
                <td className="p-3 text-sm">{journal.label}</td>
                <td className="p-3 text-sm">
                  <Badge variant="outline">{typeLabels[journal.type] || journal.type}</Badge>
                </td>
                <td className="p-3 font-mono text-sm text-gray-500">
                  {journal.defaultCounterpartAccountCode || "—"}
                </td>
                <td className="p-3 text-center">
                  {journal.isSystem && <Badge variant="secondary">Système</Badge>}
                </td>
                <td className="p-3 text-center">
                  <span className={`h-2 w-2 rounded-full inline-block ${journal.isActive ? "bg-green-500" : "bg-gray-300"}`} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
