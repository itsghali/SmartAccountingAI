"use client";

import { useState, useEffect, useCallback } from "react";
import { useAppContext } from "@/hooks/useAppContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { formatMAD } from "@/lib/utils/currency";
import { toast } from "sonner";
import { FileText, RefreshCcw, CheckCircle, Pencil, Save, X } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TaxPackageCell {
  id: string;
  tableId: string;
  rowCode: string;
  columnCode: string;
  label: string;
  value: string;
  isManual: boolean;
}

interface TaxPackageTable {
  id: string;
  taxPackageId: string;
  tableCode: string;
  tableName: string;
  cells: TaxPackageCell[];
}

interface TaxPackage {
  id: string;
  companyId: string;
  fiscalYearId: string;
  status: "DRAFT" | "GENERATED" | "REVIEWED" | "SUBMITTED";
  generatedAt: string | null;
  tables: TaxPackageTable[];
}

// ─── Status configuration ─────────────────────────────────────────────────────

const statusConfig: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  DRAFT: { label: "Brouillon", variant: "secondary" },
  GENERATED: { label: "Générée", variant: "outline" },
  REVIEWED: { label: "Révisée", variant: "default" },
  SUBMITTED: { label: "Soumise", variant: "default" },
};

// ─── Inline editable cell ─────────────────────────────────────────────────────

function EditableCell({
  cell,
  onSave,
  disabled,
}: {
  cell: TaxPackageCell;
  onSave: (cellId: string, newValue: string) => Promise<void>;
  disabled: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(cell.value);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      await onSave(cell.id, draft);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    setDraft(cell.value);
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1 justify-end">
        <Input
          type="number"
          step="0.01"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="h-7 w-36 text-right font-mono text-sm"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave();
            if (e.key === "Escape") handleCancel();
          }}
        />
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0"
          onClick={handleSave}
          disabled={saving}
        >
          <Save className="h-3.5 w-3.5 text-green-600" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0"
          onClick={handleCancel}
          disabled={saving}
        >
          <X className="h-3.5 w-3.5 text-red-500" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 justify-end group">
      <span className="font-mono text-sm">{formatMAD(cell.value)}</span>
      {!disabled && (
        <Button
          size="sm"
          variant="ghost"
          className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={() => {
            setDraft(cell.value);
            setEditing(true);
          }}
        >
          <Pencil className="h-3 w-3 text-gray-400" />
        </Button>
      )}
    </div>
  );
}

// ─── Table viewer ─────────────────────────────────────────────────────────────

function TaxTableView({
  table,
  onCellSave,
  readOnly,
}: {
  table: TaxPackageTable;
  onCellSave: (cellId: string, value: string) => Promise<void>;
  readOnly: boolean;
}) {
  // Group cells by rowCode
  const rowMap = new Map<string, { label: string; cells: TaxPackageCell[] }>();
  for (const cell of table.cells) {
    let row = rowMap.get(cell.rowCode);
    if (!row) {
      row = { label: cell.label, cells: [] };
      rowMap.set(cell.rowCode, row);
    }
    row.cells.push(cell);
  }

  // Gather all unique column codes in order
  const columnCodes = Array.from(
    new Set(table.cells.map((c) => c.columnCode))
  );

  const colHeaderLabel: Record<string, string> = {
    MONTANT: "Montant (MAD)",
    BRUT: "Valeur brute",
    AMORT: "Amort. & prov.",
    NET: "Valeur nette",
  };

  // Identify result rows (net / total rows) for visual emphasis
  const resultRows = new Set([
    "RES_EXPL",
    "RES_FIN",
    "RES_COURANT",
    "RES_NON_COURANT",
    "RES_NET",
    "TOTAL_ACTIF",
    "TOTAL_PASSIF",
    "IMMOB_NET",
  ]);

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[55%]">Libellé</TableHead>
          {columnCodes.map((col) => (
            <TableHead key={col} className="text-right">
              {colHeaderLabel[col] ?? col}
            </TableHead>
          ))}
          <TableHead className="w-8" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {Array.from(rowMap.entries()).map(([rowCode, row]) => {
          const isResult = resultRows.has(rowCode);
          return (
            <TableRow
              key={rowCode}
              className={isResult ? "bg-gray-50 font-semibold" : ""}
            >
              <TableCell
                className={`${isResult ? "font-semibold" : ""} text-sm`}
              >
                {row.label}
              </TableCell>
              {columnCodes.map((col) => {
                const cell = row.cells.find((c) => c.columnCode === col);
                if (!cell) {
                  return <TableCell key={col} />;
                }
                return (
                  <TableCell key={col} className="text-right">
                    {cell.isManual && !readOnly ? (
                      <EditableCell
                        cell={cell}
                        onSave={onCellSave}
                        disabled={readOnly}
                      />
                    ) : (
                      <span
                        className={`font-mono text-sm ${
                          parseFloat(cell.value) < 0
                            ? "text-red-600"
                            : isResult
                            ? "text-blue-700"
                            : ""
                        }`}
                      >
                        {formatMAD(cell.value)}
                      </span>
                    )}
                  </TableCell>
                );
              })}
              <TableCell />
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function TaxPackagePage() {
  const { currentCompanyId, currentFiscalYearId } = useAppContext();
  const [taxPackage, setTaxPackage] = useState<TaxPackage | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [validating, setValidating] = useState(false);
  const [activeTab, setActiveTab] = useState<string>("CPC");

  // ── Fetch ──
  const loadTaxPackage = useCallback(async () => {
    if (!currentCompanyId || !currentFiscalYearId) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/tax-package?companyId=${currentCompanyId}&fiscalYearId=${currentFiscalYearId}`
      );
      if (res.ok) {
        const data = await res.json();
        setTaxPackage(data);
        if (data?.tables?.length) {
          setActiveTab(data.tables[0].tableCode);
        }
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [currentCompanyId, currentFiscalYearId]);

  useEffect(() => {
    loadTaxPackage();
  }, [loadTaxPackage]);

  // ── Generate ──
  const handleGenerate = async () => {
    if (!currentCompanyId || !currentFiscalYearId) return;
    setGenerating(true);
    try {
      const res = await fetch("/api/tax-package", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: currentCompanyId,
          fiscalYearId: currentFiscalYearId,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setTaxPackage(data);
        if (data?.tables?.length) {
          setActiveTab(data.tables[0].tableCode);
        }
        toast.success("Liasse fiscale générée avec succès");
      } else {
        const err = await res.json();
        toast.error(err.error || "Erreur lors de la génération");
      }
    } catch {
      toast.error("Erreur de connexion");
    } finally {
      setGenerating(false);
    }
  };

  // ── Validate (mark as REVIEWED) ──
  const handleValidate = async () => {
    if (!currentCompanyId || !currentFiscalYearId) return;
    setValidating(true);
    try {
      const res = await fetch("/api/tax-package", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: currentCompanyId,
          fiscalYearId: currentFiscalYearId,
          action: "review",
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setTaxPackage(data);
        toast.success("Liasse fiscale validée");
      } else {
        const err = await res.json();
        toast.error(err.error || "Erreur");
      }
    } catch {
      toast.error("Erreur de connexion");
    } finally {
      setValidating(false);
    }
  };

  // ── Save manual cell ──
  const handleCellSave = async (cellId: string, value: string) => {
    try {
      const res = await fetch("/api/tax-package", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: currentCompanyId,
          fiscalYearId: currentFiscalYearId,
          action: "updateCell",
          cellId,
          value: parseFloat(value) || 0,
        }),
      });
      if (res.ok) {
        toast.success("Valeur mise à jour");
        // Refresh data
        await loadTaxPackage();
      } else {
        const err = await res.json();
        toast.error(err.error || "Erreur de mise à jour");
      }
    } catch {
      toast.error("Erreur de connexion");
    }
  };

  // ── Guard ──
  if (!currentCompanyId || !currentFiscalYearId) {
    return (
      <div className="p-6 text-gray-500">
        Veuillez sélectionner une société et un exercice fiscal.
      </div>
    );
  }

  const isReadOnly =
    taxPackage?.status === "REVIEWED" || taxPackage?.status === "SUBMITTED";

  return (
    <div className="p-6 max-w-[1200px] mx-auto">
      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <FileText className="h-6 w-6 text-blue-600" />
          <h1 className="text-2xl font-bold text-gray-900">Liasse Fiscale</h1>
          {taxPackage && (
            <Badge variant={statusConfig[taxPackage.status]?.variant ?? "secondary"}>
              {statusConfig[taxPackage.status]?.label ?? taxPackage.status}
            </Badge>
          )}
        </div>
        <div className="flex gap-2">
          {taxPackage?.status === "GENERATED" && (
            <Button
              variant="outline"
              onClick={handleValidate}
              disabled={validating}
              className="border-green-500 text-green-700 hover:bg-green-50"
            >
              <CheckCircle className="h-4 w-4 mr-2" />
              {validating ? "Validation..." : "Valider"}
            </Button>
          )}
          <Button onClick={handleGenerate} disabled={generating}>
            <RefreshCcw
              className={`h-4 w-4 mr-2 ${generating ? "animate-spin" : ""}`}
            />
            {generating
              ? "Génération..."
              : taxPackage
              ? "Régénérer la liasse"
              : "Générer la liasse"}
          </Button>
        </div>
      </div>

      {/* ── Generated date info ── */}
      {taxPackage?.generatedAt && (
        <p className="text-sm text-gray-400 mb-4">
          Dernière génération :{" "}
          {new Date(taxPackage.generatedAt).toLocaleString("fr-MA")}
        </p>
      )}

      {/* ── Main content ── */}
      {loading ? (
        <Card>
          <CardContent className="flex items-center justify-center h-48 text-gray-400">
            Chargement...
          </CardContent>
        </Card>
      ) : !taxPackage ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center h-64 text-gray-400 gap-4">
            <FileText className="h-12 w-12 text-gray-300" />
            <p className="text-center">
              Aucune liasse fiscale pour cet exercice.
              <br />
              Cliquez sur &quot;Générer la liasse&quot; pour démarrer.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(String(v))}
        >
          <TabsList className="mb-4">
            {taxPackage.tables.map((table) => (
              <TabsTrigger key={table.tableCode} value={table.tableCode}>
                {table.tableName}
              </TabsTrigger>
            ))}
          </TabsList>

          {taxPackage.tables.map((table) => (
            <TabsContent key={table.tableCode} value={table.tableCode}>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base font-semibold text-gray-700">
                    {table.tableName}
                  </CardTitle>
                  {!isReadOnly && table.cells.some((c) => c.isManual) && (
                    <p className="text-xs text-gray-400">
                      Les cellules en surbrillance sont éditables — survolez
                      pour modifier.
                    </p>
                  )}
                </CardHeader>
                <CardContent className="p-0">
                  <TaxTableView
                    table={table}
                    onCellSave={handleCellSave}
                    readOnly={isReadOnly}
                  />
                </CardContent>
              </Card>
            </TabsContent>
          ))}
        </Tabs>
      )}
    </div>
  );
}
