"use client";

import { useState, useRef } from "react";
import { useAppContext } from "@/hooks/useAppContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Upload,
  Download,
  FileText,
  Building2,
  Landmark,
  Package,
  BookOpen,
  Scale,
  ClipboardList,
  List,
} from "lucide-react";

// ─────────────────────────────────────────
// CSV helpers
// ─────────────────────────────────────────

function downloadCsv(filename: string, content: string) {
  const bom = "\uFEFF"; // UTF-8 BOM for Excel compatibility
  const blob = new Blob([bom + content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function jsonToCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]!);
  const escape = (val: unknown): string => {
    if (val === null || val === undefined) return "";
    const str = String(val);
    if (str.includes(";") || str.includes('"') || str.includes("\n")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };
  const lines = [headers.join(";")];
  for (const row of rows) {
    lines.push(headers.map((h) => escape(row[h])).join(";"));
  }
  return lines.join("\n");
}

// ─────────────────────────────────────────
// Sample CSV generators
// ─────────────────────────────────────────

function getSampleEcritures(): string {
  return [
    "date;journal_code;account_code;label;debit;credit",
    "2026-01-15;VTE;7111;Vente de marchandises;0;15000.00",
    "2026-01-15;VTE;3421;Client Dupont & Fils;15000.00;0",
    "2026-01-20;ACH;6111;Achat de marchandises;8000.00;0",
    "2026-01-20;ACH;4411;Fournisseur Atlas Supply;0;8000.00",
  ].join("\n");
}

function getSamplePlanComptable(): string {
  return [
    "code;label;class_number;account_type;parent_code",
    "3421;Clients;3;ASSET;342",
    "4411;Fournisseurs;4;LIABILITY;441",
    "5141;Banques - comptes courants;5;ASSET;514",
    "7111;Ventes de marchandises;7;REVENUE;711",
    "6111;Achats de marchandises;6;EXPENSE;611",
  ].join("\n");
}

function getSampleReleve(): string {
  return [
    "date;description;debit;credit",
    "2026-01-02;Virement entrant ABC Corp;;50000.00",
    "2026-01-05;Règlement fournisseur XYZ;12500.00;",
    "2026-01-10;Frais bancaires;45.00;",
    "2026-01-15;Encaissement chèque 00142;;8750.00",
  ].join("\n");
}

function getSampleImmobilisations(): string {
  return [
    "code;label;category;acquisition_date;acquisition_value;useful_life_years;amortization_method;asset_account_code;amortization_account_code;dotation_account_code",
    "IMM-001;Ordinateur portable Dell;IT_EQUIPMENT;2026-01-01;12000.00;3;LINEAR;2355;2835;6193",
    "IMM-002;Véhicule Dacia Duster;TRANSPORT;2026-01-15;180000.00;5;LINEAR;2340;2835;6194",
  ].join("\n");
}

// ─────────────────────────────────────────
// Import card component
// ─────────────────────────────────────────

interface ImportCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  acceptedFormats: string;
  columns: string[];
  sampleFn: () => string;
  sampleFilename: string;
}

function ImportCard({
  icon,
  title,
  description,
  acceptedFormats,
  columns,
  sampleFn,
  sampleFilename,
}: ImportCardProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const handleDownloadSample = () => {
    downloadCsv(sampleFilename, sampleFn());
    toast.success(`Modèle "${sampleFilename}" téléchargé`);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setSelectedFile(file);
  };

  const handleImport = () => {
    if (!selectedFile) {
      toast.error("Veuillez sélectionner un fichier");
      return;
    }
    toast.info("Fonctionnalité disponible prochainement");
  };

  return (
    <Card className="bg-card/60 backdrop-blur-md border border-border/50 shadow-sm transition-all duration-300 hover:shadow-md group">
      <CardContent className="pt-6">
        <div className="flex items-start gap-5">
          <div className="shrink-0 p-3 bg-primary/10 rounded-xl text-primary transition-colors group-hover:bg-primary/20">{icon}</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-1.5">
              <h3 className="font-semibold text-foreground text-lg">{title}</h3>
              <Badge variant="secondary" className="text-xs bg-muted text-muted-foreground">{acceptedFormats}</Badge>
            </div>
            <p className="text-sm text-muted-foreground mb-4">{description}</p>

            {/* Format instructions */}
            <div className="bg-muted/40 rounded-lg p-3 mb-4 border border-border/50">
              <p className="text-xs font-medium text-foreground mb-2">Colonnes requises :</p>
              <div className="flex flex-wrap gap-1.5">
                {columns.map((col) => (
                  <code key={col} className="text-[11px] bg-background border border-border/50 px-2 py-0.5 rounded font-mono text-muted-foreground">
                    {col}
                  </code>
                ))}
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3 flex-wrap">
              <Button variant="outline" size="sm" onClick={handleDownloadSample}>
                <Download className="h-3.5 w-3.5 mr-1.5" />
                Télécharger modèle
              </Button>

              <div className="flex items-center gap-2 flex-1 min-w-0">
                <div className="relative flex-1 min-w-0">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,.xlsx,.xls"
                    onChange={handleFileChange}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  />
                  <div className="flex items-center gap-2 border border-dashed border-border/60 bg-muted/20 rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:border-primary/50 hover:bg-primary/5 transition-colors cursor-pointer">
                    <Upload className="h-4 w-4 shrink-0 text-primary/70" />
                    <span className="truncate">
                      {selectedFile ? selectedFile.name : "Choisir un fichier..."}
                    </span>
                  </div>
                </div>
                <Button size="sm" onClick={handleImport} disabled={!selectedFile}>
                  Importer
                </Button>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────
// Export card component
// ─────────────────────────────────────────

interface ExportCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  filename: string;
  onExport: () => Promise<void>;
}

function ExportCard({ icon, title, description, filename, onExport }: ExportCardProps) {
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    try {
      await onExport();
    } finally {
      setExporting(false);
    }
  };

  return (
    <Card className="bg-card/60 backdrop-blur-md border border-border/50 shadow-sm transition-all duration-300 hover:shadow-md group">
      <CardContent className="pt-6">
        <div className="flex items-center gap-5">
          <div className="shrink-0 p-3 bg-emerald-500/10 rounded-xl text-emerald-600 dark:text-emerald-400 transition-colors group-hover:bg-emerald-500/20">{icon}</div>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-foreground text-lg">{title}</h3>
            <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
            <p className="text-xs text-muted-foreground/70 mt-1.5 font-mono bg-muted/50 inline-block px-2 py-0.5 rounded">{filename}</p>
          </div>
          <Button onClick={handleExport} disabled={exporting} className="shrink-0">
            <Download className="h-4 w-4 mr-2" />
            {exporting ? "Export..." : "Exporter"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────
// Main page
// ─────────────────────────────────────────

export default function ImportExportPage() {
  const { currentCompanyId, currentFiscalYearId } = useAppContext();

  // ── Export handlers ──────────────────────

  const exportGrandLivre = async () => {
    if (!currentCompanyId || !currentFiscalYearId) {
      toast.error("Sélectionnez une société et un exercice");
      return;
    }
    try {
      const params = new URLSearchParams({ companyId: currentCompanyId, fiscalYearId: currentFiscalYearId });
      const res = await fetch(`/api/reports/general-ledger?${params}`);
      if (!res.ok) throw new Error("Erreur serveur");
      const data = await res.json();

      // Flatten: one row per line
      const rows: Record<string, unknown>[] = [];
      for (const account of data.accounts ?? []) {
        for (const line of account.lines ?? []) {
          rows.push({
            Compte: account.accountCode,
            Intitulé_compte: account.accountLabel,
            Date: line.date ? new Date(line.date).toLocaleDateString("fr-MA") : "",
            Journal: line.journalCode,
            N_écriture: line.entryNumber,
            Référence: line.reference ?? "",
            Libellé: line.label,
            Débit: line.debit,
            Crédit: line.credit,
            Solde_progressif: line.runningBalance,
          });
        }
      }

      if (rows.length === 0) {
        toast.info("Aucune donnée à exporter");
        return;
      }
      downloadCsv("grand-livre.csv", jsonToCsv(rows));
      toast.success(`Grand Livre exporté — ${rows.length} lignes`);
    } catch {
      toast.error("Erreur lors de l'export du Grand Livre");
    }
  };

  const exportBalance = async () => {
    if (!currentCompanyId || !currentFiscalYearId) {
      toast.error("Sélectionnez une société et un exercice");
      return;
    }
    try {
      const params = new URLSearchParams({ companyId: currentCompanyId, fiscalYearId: currentFiscalYearId });
      const res = await fetch(`/api/reports/trial-balance?${params}`);
      if (!res.ok) throw new Error("Erreur serveur");
      const data = await res.json();

      const rows = (data.accounts ?? []).map((acc: Record<string, unknown>) => ({
        Compte: acc.code,
        Intitulé: acc.label,
        Classe: acc.classNumber,
        Type: acc.accountType,
        Total_débit: acc.totalDebit,
        Total_crédit: acc.totalCredit,
        Solde_débiteur: acc.soldeDebit,
        Solde_créditeur: acc.soldeCredit,
      }));

      if (rows.length === 0) {
        toast.info("Aucune donnée à exporter");
        return;
      }
      downloadCsv("balance.csv", jsonToCsv(rows));
      toast.success(`Balance exportée — ${rows.length} comptes`);
    } catch {
      toast.error("Erreur lors de l'export de la balance");
    }
  };

  const exportEcritures = async () => {
    if (!currentCompanyId || !currentFiscalYearId) {
      toast.error("Sélectionnez une société et un exercice");
      return;
    }
    try {
      const params = new URLSearchParams({
        companyId: currentCompanyId,
        fiscalYearId: currentFiscalYearId,
        limit: "10000",
      });
      const res = await fetch(`/api/entries?${params}`);
      if (!res.ok) throw new Error("Erreur serveur");
      const data = await res.json();

      const rows: Record<string, unknown>[] = [];
      for (const entry of data.entries ?? []) {
        for (const line of entry.lines ?? []) {
          rows.push({
            Date: entry.entryDate ? new Date(entry.entryDate).toLocaleDateString("fr-MA") : "",
            N_écriture: entry.entryNumber,
            Journal: entry.journal?.code ?? "",
            Référence: entry.reference ?? "",
            Description: entry.description ?? "",
            Compte: line.accountCode,
            Intitulé_ligne: line.label,
            Tiers: line.tiersName ?? "",
            Débit: line.debit,
            Crédit: line.credit,
            Statut: entry.status,
          });
        }
      }

      if (rows.length === 0) {
        toast.info("Aucune donnée à exporter");
        return;
      }
      downloadCsv("ecritures.csv", jsonToCsv(rows));
      toast.success(`Écritures exportées — ${rows.length} lignes`);
    } catch {
      toast.error("Erreur lors de l'export des écritures");
    }
  };

  const exportPlanComptable = async () => {
    if (!currentCompanyId) {
      toast.error("Sélectionnez une société");
      return;
    }
    try {
      const params = new URLSearchParams({ companyId: currentCompanyId });
      const res = await fetch(`/api/accounts?${params}`);
      if (!res.ok) throw new Error("Erreur serveur");
      const accounts = await res.json();

      const rows = (accounts ?? []).map((acc: Record<string, unknown>) => ({
        Code: acc.code,
        Intitulé: acc.label,
        Classe: acc.classNumber,
        Type: acc.accountType,
        Code_parent: acc.parentCode ?? "",
        Auxiliaire: acc.isAuxiliary ? "Oui" : "Non",
        Tiers: acc.isTiers ? "Oui" : "Non",
        Analytique: acc.requiresAnalytical ? "Oui" : "Non",
        Taux_TVA: acc.vatRate ?? "",
        Type_TVA: acc.vatType ?? "",
      }));

      if (rows.length === 0) {
        toast.info("Aucun compte à exporter");
        return;
      }
      downloadCsv("plan-comptable.csv", jsonToCsv(rows));
      toast.success(`Plan comptable exporté — ${rows.length} comptes`);
    } catch {
      toast.error("Erreur lors de l'export du plan comptable");
    }
  };

  if (!currentCompanyId) {
    return <div className="p-6 text-muted-foreground">Veuillez sélectionner une société.</div>;
  }

  return (
    <div className="p-6 max-w-5xl mx-auto animate-in fade-in duration-500">
      <div className="mb-8">
        <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-linear-to-r from-primary to-secondary mb-1">Import / Export</h1>
        <p className="text-muted-foreground font-medium">
          Importez ou exportez vos données comptables au format CSV ou Excel.
        </p>
      </div>

      <Tabs defaultValue="import">
        <TabsList className="mb-6">
          <TabsTrigger value="import">
            <Upload className="h-4 w-4 mr-2" />
            Import
          </TabsTrigger>
          <TabsTrigger value="export">
            <Download className="h-4 w-4 mr-2" />
            Export
          </TabsTrigger>
        </TabsList>

        {/* ──── IMPORT TAB ──── */}
        <TabsContent value="import">
          <div className="space-y-4">
            <ImportCard
              icon={<FileText className="h-5 w-5" />}
              title="Écritures comptables"
              description="Importez des écritures depuis un fichier CSV. Chaque ligne correspond à une ligne d'écriture. Les écritures doivent être équilibrées (débit = crédit)."
              acceptedFormats="CSV"
              columns={["date", "journal_code", "account_code", "label", "debit", "credit"]}
              sampleFn={getSampleEcritures}
              sampleFilename="modele-ecritures.csv"
            />

            <ImportCard
              icon={<List className="h-5 w-5" />}
              title="Plan comptable"
              description="Importez ou mettez à jour votre plan comptable depuis un fichier CSV ou Excel. Les comptes existants seront mis à jour, les nouveaux seront créés."
              acceptedFormats="CSV / Excel"
              columns={["code", "label", "class_number", "account_type", "parent_code"]}
              sampleFn={getSamplePlanComptable}
              sampleFilename="modele-plan-comptable.csv"
            />

            <ImportCard
              icon={<Landmark className="h-5 w-5" />}
              title="Relevé bancaire"
              description="Importez un relevé bancaire au format CSV pour faciliter le rapprochement bancaire. Les colonnes doivent inclure la date, la description et les montants."
              acceptedFormats="CSV"
              columns={["date", "description", "debit", "credit"]}
              sampleFn={getSampleReleve}
              sampleFilename="modele-releve-bancaire.csv"
            />

            <ImportCard
              icon={<Building2 className="h-5 w-5" />}
              title="Immobilisations"
              description="Importez votre tableau des immobilisations. Chaque ligne représente un bien. Les comptes associés doivent exister dans le plan comptable."
              acceptedFormats="CSV / Excel"
              columns={[
                "code", "label", "category", "acquisition_date",
                "acquisition_value", "useful_life_years", "amortization_method",
                "asset_account_code", "amortization_account_code", "dotation_account_code",
              ]}
              sampleFn={getSampleImmobilisations}
              sampleFilename="modele-immobilisations.csv"
            />
          </div>

          {/* Notice */}
          <div className="mt-8 p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl shadow-sm">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-amber-500/20 rounded-lg shrink-0">
                <Package className="h-5 w-5 text-amber-600 dark:text-amber-500" />
              </div>
              <div>
                <p className="text-sm font-semibold text-amber-800 dark:text-amber-400">Format de fichier</p>
                <p className="text-sm text-amber-700/80 dark:text-amber-500/80 mt-1">
                  Les fichiers CSV doivent utiliser le point-virgule (;) comme séparateur et l&apos;encodage UTF-8.
                  Les dates doivent être au format <code className="bg-amber-500/20 px-1.5 py-0.5 rounded font-mono text-xs">YYYY-MM-DD</code>.
                  Les montants utilisent le point (.) comme séparateur décimal.
                </p>
              </div>
            </div>
          </div>
        </TabsContent>

        {/* ──── EXPORT TAB ──── */}
        <TabsContent value="export">
          <div className="space-y-4">
            <ExportCard
              icon={<BookOpen className="h-5 w-5" />}
              title="Grand Livre"
              description="Toutes les écritures de l&apos;exercice groupées par compte, avec solde progressif."
              filename="grand-livre.csv"
              onExport={exportGrandLivre}
            />

            <ExportCard
              icon={<Scale className="h-5 w-5" />}
              title="Balance générale"
              description="Tableau récapitulatif des totaux débit/crédit et soldes par compte."
              filename="balance.csv"
              onExport={exportBalance}
            />

            <ExportCard
              icon={<ClipboardList className="h-5 w-5" />}
              title="Écritures comptables"
              description="Toutes les lignes d&apos;écritures de l&apos;exercice en cours avec journal, références et montants."
              filename="ecritures.csv"
              onExport={exportEcritures}
            />

            <ExportCard
              icon={<List className="h-5 w-5" />}
              title="Plan comptable"
              description="Liste complète des comptes actifs avec leur classification et paramètres."
              filename="plan-comptable.csv"
              onExport={exportPlanComptable}
            />
          </div>

          {/* Notice */}
          <div className="mt-8 p-4 bg-primary/5 border border-primary/10 rounded-xl shadow-sm">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-primary/10 rounded-lg shrink-0">
                <Download className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm font-semibold text-primary">Fichiers CSV</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Les exports sont au format CSV (séparateur point-virgule, encodage UTF-8 avec BOM)
                  directement ouvrable dans Excel. L&apos;exercice sélectionné dans la barre de navigation est utilisé
                  pour les exports liés à un exercice comptable.
                </p>
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
