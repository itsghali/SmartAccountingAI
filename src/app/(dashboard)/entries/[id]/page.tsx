"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatMAD } from "@/lib/utils/currency";
import { formatMonth, formatDateLong } from "@/lib/utils/dates";
import { toast } from "sonner";
import {
  ArrowLeft,
  CheckCircle,
  RotateCcw,
  Trash2,
  FileText,
  Calendar,
  Hash,
  User,
  Bookmark,
} from "lucide-react";

interface EntryLine {
  id: string;
  lineNumber: number;
  accountCode: string;
  label: string;
  debit: string;
  credit: string;
  tiersName: string | null;
  tiersReference: string | null;
  account: { code: string; label: string };
}

interface EntryDetail {
  id: string;
  entryNumber: number;
  entryDate: string;
  reference: string | null;
  piece: string | null;
  description: string;
  status: "DRAFT" | "VALIDATED" | "REVERSED";
  totalDebit: string;
  totalCredit: string;
  origin: string;
  sourceModule: string | null;
  isReversal: boolean;
  isReversed: boolean;
  validatedAt: string | null;
  createdAt: string;
  journal: { code: string; label: string; type: string };
  fiscalYear: { label: string };
  createdBy: { firstName: string; lastName: string };
  lines: EntryLine[];
}

const statusConfig = {
  DRAFT: { label: "Brouillon", variant: "secondary" as const, cls: "bg-gray-100 text-gray-700" },
  VALIDATED: { label: "Validée", variant: "default" as const, cls: "bg-green-100 text-green-700" },
  REVERSED: { label: "Contrepassée", variant: "destructive" as const, cls: "bg-red-100 text-red-700" },
};

export default function EntryDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [entry, setEntry] = useState<EntryDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);

  const id = params.id as string;

  useEffect(() => {
    if (!id) return;

    const loadEntry = async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/entries/${id}`);
        const data = await response.json();
        if (data.error) {
          toast.error(data.error);
          router.push("/entries");
        } else {
          setEntry(data);
        }
      } catch {
        toast.error("Erreur de chargement");
      } finally {
        setLoading(false);
      }
    };

    void loadEntry();
  }, [id, router]);

  const handleValidate = async () => {
    if (!entry || !confirm("Valider cette écriture ?")) return;
    setActing(true);
    const res = await fetch(`/api/entries/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "validate" }),
    });
    if (res.ok) {
      const updated = await res.json();
      setEntry((prev) => prev ? { ...prev, status: "VALIDATED", validatedAt: updated.validatedAt } : prev);
      toast.success("Écriture validée");
    } else {
      const data = await res.json();
      toast.error(data.error || "Erreur");
    }
    setActing(false);
  };

  const handleReverse = async () => {
    if (!entry || !confirm("Contrepasser cette écriture ? Une nouvelle écriture inverse sera créée.")) return;
    setActing(true);
    const res = await fetch(`/api/entries/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reverse" }),
    });
    if (res.ok) {
      toast.success("Contrepassation créée");
      router.push("/entries");
    } else {
      const data = await res.json();
      toast.error(data.error || "Erreur");
    }
    setActing(false);
  };

  const handleDelete = async () => {
    if (!entry || !confirm("Supprimer ce brouillon ? Cette action est irréversible.")) return;
    setActing(true);
    const res = await fetch(`/api/entries/${id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Brouillon supprimé");
      router.push("/entries");
    } else {
      const data = await res.json();
      toast.error(data.error || "Erreur");
    }
    setActing(false);
  };

  if (loading) {
    return (
      <div className="p-6 text-gray-400 text-center">Chargement de l&apos;écriture...</div>
    );
  }

  if (!entry) return null;

  const totalDebit = parseFloat(entry.totalDebit);
  const totalCredit = parseFloat(entry.totalCredit);
  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01;
  const status = statusConfig[entry.status];
  const pieceRef = entry.piece || entry.reference;

  return (
    <div className="p-6 max-w-7500 mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link href="/entries">
            <Button variant="ghost" size="sm" className="gap-1">
              <ArrowLeft className="h-4 w-4" /> Retour
            </Button>
          </Link>
          <h1 className="text-xl font-bold text-gray-900">
            Écriture {entry.journal.code}-{entry.entryNumber}
          </h1>
          <Badge className={status.cls}>{status.label}</Badge>
          {entry.isReversal && (
            <Badge variant="outline" className="text-orange-600 border-orange-300">
              Contrepassation
            </Badge>
          )}
          {entry.sourceModule === "PRIOR_YEAR_COPY" && (
            <Badge variant="outline" className="text-purple-600 border-purple-300">
              Référence N-1
            </Badge>
          )}
        </div>

        <div className="flex gap-2">
          {entry.status === "DRAFT" && (
            <>
              <Button
                onClick={handleValidate}
                disabled={acting}
                className="bg-green-600 hover:bg-green-700 gap-1"
              >
                <CheckCircle className="h-4 w-4" /> Valider
              </Button>
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={acting}
                className="gap-1"
              >
                <Trash2 className="h-4 w-4" /> Supprimer
              </Button>
            </>
          )}
          {entry.status === "VALIDATED" && !entry.isReversed && (
            <Button
              variant="outline"
              onClick={handleReverse}
              disabled={acting}
              className="gap-1 text-orange-600 border-orange-300 hover:bg-orange-50"
            >
              <RotateCcw className="h-4 w-4" /> Contrepasser
            </Button>
          )}
        </div>
      </div>

      {/* Metadata cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="rounded-lg border bg-gray-50 p-3">
          <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
            <FileText className="h-3.5 w-3.5" /> Journal
          </div>
          <p className="font-semibold text-sm text-blue-700">{entry.journal.code}</p>
          <p className="text-xs text-gray-500">{entry.journal.label}</p>
        </div>
        <div className="rounded-lg border bg-gray-50 p-3">
          <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
            <Calendar className="h-3.5 w-3.5" /> Période
          </div>
          <p className="font-semibold text-sm">{formatMonth(entry.entryDate)}</p>
          <p className="text-xs text-gray-500">{entry.fiscalYear.label}</p>
        </div>
        <div className="rounded-lg border bg-gray-50 p-3">
          <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
            <Bookmark className="h-3.5 w-3.5" /> Pièce / Référence
          </div>
          <p className="font-semibold text-sm">{pieceRef || "—"}</p>
        </div>
        <div className="rounded-lg border bg-gray-50 p-3">
          <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
            <User className="h-3.5 w-3.5" /> Créé par
          </div>
          <p className="font-semibold text-sm">
            {entry.createdBy.firstName} {entry.createdBy.lastName}
          </p>
          <p className="text-xs text-gray-500">{formatDateLong(entry.createdAt)}</p>
        </div>
      </div>

      {/* Description */}
      <div className="mb-6 rounded-lg border bg-white p-4">
        <div className="flex items-center gap-2 mb-1 text-xs text-gray-500 uppercase tracking-wide">
          <Hash className="h-3.5 w-3.5" /> Description
        </div>
        <p className="text-gray-900">{entry.description}</p>
        {entry.validatedAt && (
          <p className="mt-1 text-xs text-green-600">
            Validée le {formatDateLong(entry.validatedAt)}
          </p>
        )}
      </div>

      {/* Lines table */}
      <div className="border rounded-lg overflow-hidden">
        {/* Header */}
        <div className="grid grid-cols-[40px_160px_1fr_140px_140px] bg-gray-50 border-b text-xs font-semibold text-gray-500 uppercase">
          <div className="p-3 text-center">#</div>
          <div className="p-3">Compte</div>
          <div className="p-3">Libellé</div>
          <div className="p-3 text-right">Débit</div>
          <div className="p-3 text-right">Crédit</div>
        </div>

        {/* Rows */}
        {entry.lines.map((line) => (
          <div
            key={line.id}
            className="grid grid-cols-[40px_160px_1fr_140px_140px] border-b hover:bg-gray-50 items-center"
          >
            <div className="p-3 text-center text-xs text-gray-400">{line.lineNumber}</div>
            <div className="p-3">
              <p className="font-mono text-sm font-medium text-blue-700">{line.account.code}</p>
              <p className="text-xs text-gray-400 truncate">{line.account.label}</p>
            </div>
            <div className="p-3">
              <p className="text-sm">{line.label}</p>
              {line.tiersName && (
                <p className="text-xs text-gray-400">{line.tiersName}</p>
              )}
            </div>
            <div className="p-3 text-right font-mono text-sm">
              {parseFloat(line.debit) > 0 ? formatMAD(line.debit) : "—"}
            </div>
            <div className="p-3 text-right font-mono text-sm">
              {parseFloat(line.credit) > 0 ? formatMAD(line.credit) : "—"}
            </div>
          </div>
        ))}

        {/* Totals */}
        <div className="grid grid-cols-[40px_160px_1fr_140px_140px] bg-gray-50 font-semibold">
          <div className="p-3" />
          <div className="p-3" />
          <div className="p-3 text-right text-sm text-gray-600">TOTAUX</div>
          <div className="p-3 text-right font-mono text-sm">{formatMAD(entry.totalDebit)}</div>
          <div className="p-3 text-right font-mono text-sm">{formatMAD(entry.totalCredit)}</div>
        </div>

        {/* Balance indicator */}
        <div
          className={`p-2 text-center text-sm font-medium ${
            isBalanced ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
          }`}
        >
          {isBalanced
            ? "ÉQUILIBRÉ"
            : `DÉSÉQUILIBRÉ — Écart: ${formatMAD(Math.abs(totalDebit - totalCredit))} MAD`}
        </div>
      </div>
    </div>
  );
}
