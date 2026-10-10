"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useAppContext } from "@/hooks/useAppContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatMAD } from "@/lib/utils/currency";
import { formatDate } from "@/lib/utils/dates";
import { toast } from "sonner";
import { Plus, Calculator, Eye } from "lucide-react";

interface FixedAsset {
  id: string;
  code: string;
  label: string;
  category: string;
  acquisitionDate: string;
  acquisitionValue: string;
  cumulativeAmortization: string;
  netBookValue: string;
  status: string;
  amortizationMethod: string;
  usefulLifeYears: number;
  assetAccount: { code: string; label: string };
}

const categoryLabels: Record<string, string> = {
  INTANGIBLE: "Incorporelles",
  LAND: "Terrains",
  BUILDINGS: "Constructions",
  EQUIPMENT: "Matériel et outillage",
  TRANSPORT: "Matériel de transport",
  IT_EQUIPMENT: "Matériel informatique",
  FURNITURE: "Mobilier",
  OTHER_TANGIBLE: "Autres corporelles",
  FINANCIAL: "Financières",
  STARTUP_COSTS: "Non-valeurs",
};

const statusLabels: Record<string, { label: string; variant: "default" | "secondary" | "destructive" }> = {
  ACTIVE: { label: "Actif", variant: "default" },
  FULLY_AMORTIZED: { label: "Amorti", variant: "secondary" },
  DISPOSED: { label: "Cédé", variant: "destructive" },
  SCRAPPED: { label: "Mis au rebut", variant: "destructive" },
};

export default function FixedAssetsPage() {
  const { currentCompanyId, currentFiscalYearId } = useAppContext();
  const [assets, setAssets] = useState<FixedAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [generating, setGenerating] = useState(false);

  // New asset form state
  const [newAsset, setNewAsset] = useState({
    code: "", label: "", category: "EQUIPMENT",
    assetAccountCode: "", amortizationAccountCode: "", dotationAccountCode: "",
    acquisitionDate: "", commissioningDate: "",
    acquisitionValue: 0, residualValue: 0,
    usefulLifeYears: 5, amortizationMethod: "LINEAR",
    supplier: "", invoiceReference: "",
  });

  const loadAssets = useCallback(async () => {
    if (!currentCompanyId || !currentFiscalYearId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        companyId: currentCompanyId,
        fiscalYearId: currentFiscalYearId,
      });
      if (filterCategory !== "all") params.set("category", filterCategory);
      if (filterStatus !== "all") params.set("status", filterStatus);

      const res = await fetch(`/api/fixed-assets?${params}`);
      if (res.ok) setAssets(await res.json());
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [currentCompanyId, currentFiscalYearId, filterCategory, filterStatus]);

  useEffect(() => { loadAssets(); }, [loadAssets]);

  const handleCreateAsset = async () => {
    if (!currentCompanyId) return;
    try {
      const res = await fetch("/api/fixed-assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...newAsset, companyId: currentCompanyId }),
      });
      if (res.ok) {
        toast.success("Immobilisation créée");
        setShowNewDialog(false);
        loadAssets();
      } else {
        const err = await res.json();
        toast.error(err.error || "Erreur");
      }
    } catch {
      toast.error("Erreur de connexion");
    }
  };

  const handleGenerateAmortization = async () => {
    if (!currentCompanyId || !currentFiscalYearId) return;
    setGenerating(true);
    try {
      const res = await fetch("/api/fixed-assets/amortization", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId: currentCompanyId, fiscalYearId: currentFiscalYearId }),
      });
      if (res.ok) {
        const data = await res.json();
        toast.success(data.message);
        loadAssets();
      } else {
        const err = await res.json();
        toast.error(err.error || "Erreur");
      }
    } catch {
      toast.error("Erreur");
    } finally {
      setGenerating(false);
    }
  };

  // Summary stats
  const totalAcquisition = assets.reduce((s, a) => s + parseFloat(a.acquisitionValue), 0);
  const totalNBV = assets.reduce((s, a) => s + parseFloat(a.netBookValue), 0);
  const totalAmort = assets.reduce((s, a) => s + parseFloat(a.cumulativeAmortization), 0);

  if (!currentCompanyId || !currentFiscalYearId) {
    return <div className="p-6 text-gray-500">Veuillez sélectionner une société et un exercice.</div>;
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Immobilisations</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleGenerateAmortization} disabled={generating}>
            <Calculator className="h-4 w-4 mr-2" />
            {generating ? "Génération..." : "Générer amortissements"}
          </Button>
          <Dialog open={showNewDialog} onOpenChange={setShowNewDialog}>
            <DialogTrigger>
              <Button><Plus className="h-4 w-4 mr-2" /> Nouvelle immobilisation</Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Nouvelle immobilisation</DialogTitle>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Code *</Label>
                  <Input value={newAsset.code} onChange={(e) => setNewAsset({ ...newAsset, code: e.target.value })} placeholder="IMM-001" />
                </div>
                <div>
                  <Label>Libellé *</Label>
                  <Input value={newAsset.label} onChange={(e) => setNewAsset({ ...newAsset, label: e.target.value })} />
                </div>
                <div>
                  <Label>Catégorie</Label>
                  <Select value={newAsset.category} onValueChange={(v) => v !== null && setNewAsset({ ...newAsset, category: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(categoryLabels).map(([k, v]) => (
                        <SelectItem key={k} value={k}>{v}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Méthode</Label>
                  <Select value={newAsset.amortizationMethod} onValueChange={(v) => v !== null && setNewAsset({ ...newAsset, amortizationMethod: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="LINEAR">Linéaire</SelectItem>
                      <SelectItem value="DEGRESSIVE">Dégressif</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Compte immob. *</Label>
                  <Input value={newAsset.assetAccountCode} onChange={(e) => setNewAsset({ ...newAsset, assetAccountCode: e.target.value })} placeholder="2340" className="font-mono" />
                </div>
                <div>
                  <Label>Compte amort. *</Label>
                  <Input value={newAsset.amortizationAccountCode} onChange={(e) => setNewAsset({ ...newAsset, amortizationAccountCode: e.target.value })} placeholder="2834" className="font-mono" />
                </div>
                <div>
                  <Label>Compte dotation *</Label>
                  <Input value={newAsset.dotationAccountCode} onChange={(e) => setNewAsset({ ...newAsset, dotationAccountCode: e.target.value })} placeholder="6193" className="font-mono" />
                </div>
                <div>
                  <Label>Durée (années)</Label>
                  <Input type="number" value={newAsset.usefulLifeYears} onChange={(e) => setNewAsset({ ...newAsset, usefulLifeYears: parseInt(e.target.value) || 0 })} />
                </div>
                <div>
                  <Label>Date acquisition *</Label>
                  <Input type="date" value={newAsset.acquisitionDate} onChange={(e) => setNewAsset({ ...newAsset, acquisitionDate: e.target.value })} />
                </div>
                <div>
                  <Label>Date mise en service *</Label>
                  <Input type="date" value={newAsset.commissioningDate} onChange={(e) => setNewAsset({ ...newAsset, commissioningDate: e.target.value })} />
                </div>
                <div>
                  <Label>Valeur d&apos;acquisition *</Label>
                  <Input type="number" step="0.01" value={newAsset.acquisitionValue || ""} onChange={(e) => setNewAsset({ ...newAsset, acquisitionValue: parseFloat(e.target.value) || 0 })} />
                </div>
                <div>
                  <Label>Valeur résiduelle</Label>
                  <Input type="number" step="0.01" value={newAsset.residualValue || ""} onChange={(e) => setNewAsset({ ...newAsset, residualValue: parseFloat(e.target.value) || 0 })} />
                </div>
                <div>
                  <Label>Fournisseur</Label>
                  <Input value={newAsset.supplier} onChange={(e) => setNewAsset({ ...newAsset, supplier: e.target.value })} />
                </div>
                <div>
                  <Label>N° facture</Label>
                  <Input value={newAsset.invoiceReference} onChange={(e) => setNewAsset({ ...newAsset, invoiceReference: e.target.value })} />
                </div>
              </div>
              <Button onClick={handleCreateAsset} className="w-full mt-4">Créer l&apos;immobilisation</Button>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-gray-500">Valeur brute totale</p>
            <p className="text-2xl font-bold font-mono">{formatMAD(totalAcquisition)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-gray-500">Amortissements cumulés</p>
            <p className="text-2xl font-bold font-mono text-orange-600">{formatMAD(totalAmort)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm text-gray-500">Valeur nette comptable</p>
            <p className="text-2xl font-bold font-mono text-blue-600">{formatMAD(totalNBV)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex gap-4 mb-4">
        <Select value={filterCategory} onValueChange={(v) => v !== null && setFilterCategory(v)}>
          <SelectTrigger className="w-[200px]"><SelectValue placeholder="Toutes catégories" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Toutes catégories</SelectItem>
            {Object.entries(categoryLabels).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={(v) => v !== null && setFilterStatus(v)}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Tous statuts" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous statuts</SelectItem>
            <SelectItem value="ACTIVE">Actif</SelectItem>
            <SelectItem value="FULLY_AMORTIZED">Amorti</SelectItem>
            <SelectItem value="DISPOSED">Cédé</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="border rounded-lg overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 text-xs uppercase text-gray-500">
            <tr>
              <th className="p-3 text-left">Code</th>
              <th className="p-3 text-left">Libellé</th>
              <th className="p-3 text-left">Catégorie</th>
              <th className="p-3 text-left">Date acq.</th>
              <th className="p-3 text-right">Valeur brute</th>
              <th className="p-3 text-right">Amort. cumulés</th>
              <th className="p-3 text-right">VNC</th>
              <th className="p-3 text-center">Statut</th>
              <th className="p-3 text-center">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="p-8 text-center text-gray-400">Chargement...</td></tr>
            ) : assets.length === 0 ? (
              <tr><td colSpan={9} className="p-8 text-center text-gray-400">Aucune immobilisation</td></tr>
            ) : assets.map((asset) => (
              <tr key={asset.id} className="border-t hover:bg-gray-50">
                <td className="p-3 font-mono text-sm font-medium">{asset.code}</td>
                <td className="p-3 text-sm">{asset.label}</td>
                <td className="p-3 text-sm text-gray-500">{categoryLabels[asset.category] || asset.category}</td>
                <td className="p-3 text-sm">{formatDate(asset.acquisitionDate)}</td>
                <td className="p-3 text-right font-mono text-sm">{formatMAD(asset.acquisitionValue)}</td>
                <td className="p-3 text-right font-mono text-sm text-orange-600">{formatMAD(asset.cumulativeAmortization)}</td>
                <td className="p-3 text-right font-mono text-sm font-medium">{formatMAD(asset.netBookValue)}</td>
                <td className="p-3 text-center">
                  <Badge variant={statusLabels[asset.status]?.variant || "secondary"}>
                    {statusLabels[asset.status]?.label || asset.status}
                  </Badge>
                </td>
                <td className="p-3 text-center">
                  <Link href={`/fixed-assets/${asset.id}`}>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                      <Eye className="h-3.5 w-3.5" />
                    </Button>
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
