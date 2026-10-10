"use client";

import { useState, useEffect, useCallback } from "react";
import { useAppContext } from "@/hooks/useAppContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { formatDate } from "@/lib/utils/dates";
import {
  Plus,
  Lock,
  Unlock,
  CalendarDays,
  Loader2,
} from "lucide-react";

interface FiscalYear {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
  status: "OPEN" | "PROVISIONAL_CLOSE" | "CLOSED";
  isDefault: boolean;
  _count: {
    journalEntries: number;
  };
}

const statusConfig: Record<
  string,
  { label: string; className: string }
> = {
  OPEN: {
    label: "Ouvert",
    className:
      "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  },
  PROVISIONAL_CLOSE: {
    label: "Clôture provisoire",
    className:
      "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-amber-500/15 text-amber-700 dark:text-amber-400",
  },
  CLOSED: {
    label: "Clôturé",
    className:
      "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-destructive/15 text-destructive",
  },
};

export default function FiscalYearsSettingsPage() {
  const { currentCompanyId, refreshFiscalYears } = useAppContext();
  const [fiscalYears, setFiscalYears] = useState<FiscalYear[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // New fiscal year form state
  const [newLabel, setNewLabel] = useState("");
  const [newStartDate, setNewStartDate] = useState("");
  const [newEndDate, setNewEndDate] = useState("");

  const fetchFiscalYears = useCallback(async () => {
    if (!currentCompanyId) return;

    setLoading(true);
    try {
      const res = await fetch(
        `/api/fiscal-years?companyId=${currentCompanyId}`
      );
      if (res.ok) {
        const data = await res.json();
        setFiscalYears(data);
      }
    } catch {
      toast.error("Erreur lors du chargement des exercices");
    } finally {
      setLoading(false);
    }
  }, [currentCompanyId]);

  useEffect(() => {
    fetchFiscalYears();
  }, [fetchFiscalYears]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentCompanyId) return;

    if (!newLabel || !newStartDate || !newEndDate) {
      toast.error("Veuillez remplir tous les champs");
      return;
    }

    setCreating(true);
    try {
      const res = await fetch("/api/fiscal-years", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: currentCompanyId,
          label: newLabel,
          startDate: newStartDate,
          endDate: newEndDate,
          isDefault: fiscalYears.length === 0,
        }),
      });

      if (res.ok) {
        const created: FiscalYear = await res.json();
        toast.success("Exercice comptable créé");
        setNewLabel("");
        setNewStartDate("");
        setNewEndDate("");
        setShowForm(false);
        await Promise.all([
          fetchFiscalYears(),
          refreshFiscalYears(created.id),
        ]);
      } else {
        const err = await res.json();
        toast.error(err.error || "Erreur lors de la création");
      }
    } catch {
      toast.error("Erreur réseau");
    } finally {
      setCreating(false);
    }
  };

  const handleStatusChange = async (
    fyId: string,
    newStatus: "OPEN" | "PROVISIONAL_CLOSE" | "CLOSED"
  ) => {
    const labels: Record<string, string> = {
      OPEN: "rouvrir",
      PROVISIONAL_CLOSE: "clôturer provisoirement",
      CLOSED: "clôturer définitivement",
    };

    if (
      !confirm(
        `Voulez-vous ${labels[newStatus]} cet exercice comptable ?`
      )
    ) {
      return;
    }

    setActionLoading(fyId);
    try {
      const res = await fetch(`/api/fiscal-years/${fyId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });

      if (res.ok) {
        toast.success("Statut mis à jour");
        await Promise.all([fetchFiscalYears(), refreshFiscalYears()]);
      } else {
        const err = await res.json();
        toast.error(err.error || "Erreur lors de la mise à jour");
      }
    } catch {
      toast.error("Erreur réseau");
    } finally {
      setActionLoading(null);
    }
  };

  if (!currentCompanyId) {
    return (
      <div className="p-6 text-gray-500">
        Veuillez sélectionner une société.
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl animate-in fade-in duration-500">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-linear-to-r from-primary to-secondary">
          Exercices Comptables
        </h1>
        <Button onClick={() => setShowForm(!showForm)}>
          <Plus className="h-4 w-4 mr-2" />
          Nouvel Exercice
        </Button>
      </div>

      {/* Create Form */}
      {showForm && (
        <Card className="mb-8 bg-card/60 backdrop-blur-xl border-primary/20 shadow-sm transition-all duration-300">
          <CardHeader>
            <CardTitle className="text-base">Nouvel Exercice Comptable</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="fy-label">Libellé</Label>
                  <Input
                    id="fy-label"
                    value={newLabel}
                    onChange={(e) => setNewLabel(e.target.value)}
                    placeholder="Ex: Exercice 2026"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="fy-start">Date de début</Label>
                  <Input
                    id="fy-start"
                    type="date"
                    value={newStartDate}
                    onChange={(e) => setNewStartDate(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="fy-end">Date de fin</Label>
                  <Input
                    id="fy-end"
                    type="date"
                    value={newEndDate}
                    onChange={(e) => setNewEndDate(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowForm(false)}
                >
                  Annuler
                </Button>
                <Button type="submit" disabled={creating}>
                  {creating && (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  )}
                  Créer
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Fiscal Years List */}
      {loading ? (
        <div className="text-muted-foreground py-8 text-center">Chargement...</div>
      ) : fiscalYears.length === 0 ? (
        <Card className="border-dashed border-border/50 bg-card/30 backdrop-blur-sm shadow-none">
          <CardContent className="py-12 text-center text-muted-foreground">
            <div className="mx-auto mb-4 flex justify-center">
              <div className="rounded-full bg-muted/50 p-4">
                <CalendarDays className="h-10 w-10 text-muted-foreground" />
              </div>
            </div>
            <p className="font-semibold text-foreground mb-1">Aucun exercice comptable.</p>
            <p className="text-sm mt-1">
              Créez votre premier exercice comptable pour commencer.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {fiscalYears.map((fy) => (
            <Card key={fy.id} className="bg-card/60 backdrop-blur-xl border-border/50 shadow-sm transition-all duration-300 hover:shadow-md hover:border-primary/20 group pt-6">
              <CardContent className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <CalendarDays className="h-5 w-5 text-gray-400" />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{fy.label}</span>
                      <span className={statusConfig[fy.status]!.className}>
                        {statusConfig[fy.status]!.label}
                      </span>
                      {fy.isDefault && (
                        <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-blue-100 text-blue-800">
                          Par défaut
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-500">
                      {formatDate(fy.startDate)} — {formatDate(fy.endDate)}
                      <span className="ml-3 text-gray-400">
                        {fy._count.journalEntries} écriture(s)
                      </span>
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {fy.status === "OPEN" && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={actionLoading === fy.id}
                      onClick={() =>
                        handleStatusChange(fy.id, "PROVISIONAL_CLOSE")
                      }
                    >
                      {actionLoading === fy.id ? (
                        <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                      ) : (
                        <Lock className="h-3.5 w-3.5 mr-1" />
                      )}
                      Clôture provisoire
                    </Button>
                  )}
                  {fy.status === "PROVISIONAL_CLOSE" && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={actionLoading === fy.id}
                        onClick={() => handleStatusChange(fy.id, "OPEN")}
                      >
                        {actionLoading === fy.id ? (
                          <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                        ) : (
                          <Unlock className="h-3.5 w-3.5 mr-1" />
                        )}
                        Rouvrir
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={actionLoading === fy.id}
                        onClick={() =>
                          handleStatusChange(fy.id, "CLOSED")
                        }
                      >
                        {actionLoading === fy.id ? (
                          <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                        ) : (
                          <Lock className="h-3.5 w-3.5 mr-1" />
                        )}
                        Clôturer
                      </Button>
                    </>
                  )}
                  {fy.status === "CLOSED" && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={actionLoading === fy.id}
                      onClick={() => handleStatusChange(fy.id, "OPEN")}
                    >
                      {actionLoading === fy.id ? (
                        <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                      ) : (
                        <Unlock className="h-3.5 w-3.5 mr-1" />
                      )}
                      Rouvrir
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
