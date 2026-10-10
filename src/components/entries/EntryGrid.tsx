"use client";

import { useCallback, useRef } from "react";
import { AccountSearch } from "./AccountSearch";
import { CurrencyInput } from "@/components/shared/CurrencyInput";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Trash2, Plus } from "lucide-react";
import { formatMAD } from "@/lib/utils/currency";

export interface EntryLine {
  id: string;
  lineNumber: number;
  accountCode: string;
  label: string;
  debit: number;
  credit: number;
  tiersName?: string;
  tiersReference?: string;
}

interface EntryGridProps {
  companyId: string;
  lines: EntryLine[];
  onChange: (lines: EntryLine[]) => void;
  readOnly?: boolean;
}

let lineIdCounter = 0;
function newLineId() {
  return `line-${++lineIdCounter}-${Date.now()}`;
}

export function EntryGrid({ companyId, lines, onChange, readOnly = false }: EntryGridProps) {
  const gridRef = useRef<HTMLDivElement>(null);

  const updateLine = useCallback(
    (index: number, updates: Partial<EntryLine>) => {
      const newLines = [...lines];
      newLines[index] = { ...newLines[index]!, ...updates } as EntryLine;
      onChange(newLines);
    },
    [lines, onChange]
  );

  const addLine = useCallback(() => {
    const newLine: EntryLine = {
      id: newLineId(),
      lineNumber: lines.length + 1,
      accountCode: "",
      label: "",
      debit: 0,
      credit: 0,
    };
    onChange([...lines, newLine]);
  }, [lines, onChange]);

  const removeLine = useCallback(
    (index: number) => {
      if (lines.length <= 2) return; // Minimum 2 lines
      const newLines = lines.filter((_, i) => i !== index).map((l, i) => ({ ...l, lineNumber: i + 1 }));
      onChange(newLines);
    },
    [lines, onChange]
  );

  const handleAutoBalance = useCallback(
    (index: number, field: "debit" | "credit") => {
      const totalDebit = lines.reduce((s, l, i) => s + (i !== index ? l.debit : 0), 0);
      const totalCredit = lines.reduce((s, l, i) => s + (i !== index ? l.credit : 0), 0);
      const diff = Math.round((totalDebit - totalCredit) * 100) / 100;

      if (field === "credit" && diff > 0) {
        updateLine(index, { credit: diff, debit: 0 });
      } else if (field === "debit" && diff < 0) {
        updateLine(index, { debit: Math.abs(diff), credit: 0 });
      }
    },
    [lines, updateLine]
  );

  const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
  const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01;

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, index: number, field: string) => {
      if (e.key === "Enter" && index === lines.length - 1) {
        e.preventDefault();
        addLine();
      }
      // "+" key auto-balances
      if (e.key === "+" && (field === "debit" || field === "credit")) {
        e.preventDefault();
        handleAutoBalance(index, field);
      }
    },
    [lines.length, addLine, handleAutoBalance]
  );

  return (
    <div ref={gridRef} className="border rounded-lg overflow-hidden">
      {/* Header */}
      <div className="grid grid-cols-[40px_1fr_180px_2fr_140px_140px_40px] bg-gray-50 border-b text-xs font-semibold text-gray-600 uppercase">
        <div className="p-2 text-center">#</div>
        <div className="p-2">Compte</div>
        <div className="p-2" />
        <div className="p-2">Libellé</div>
        <div className="p-2 text-right">Débit</div>
        <div className="p-2 text-right">Crédit</div>
        <div className="p-2" />
      </div>

      {/* Lines */}
      {lines.map((line, index) => (
        <div
          key={line.id}
          className="grid grid-cols-[40px_1fr_180px_2fr_140px_140px_40px] border-b hover:bg-blue-50/30 items-center"
        >
          <div className="p-2 text-center text-xs text-gray-400">{line.lineNumber}</div>
          <div className="p-1">
            <AccountSearch
              companyId={companyId}
              value={line.accountCode}
              onChange={(code, label) => {
                updateLine(index, {
                  accountCode: code,
                  label: label || line.label,
                });
              }}
              onKeyDown={(e) => handleKeyDown(e, index, "account")}
            />
          </div>
          <div className="p-1 text-xs text-gray-500 truncate">
            {line.accountCode && !readOnly && (
              <span className="text-gray-400">
                {lines[index]?.accountCode ? "" : ""}
              </span>
            )}
          </div>
          <div className="p-1">
            <Input
              value={line.label}
              onChange={(e) => updateLine(index, { label: e.target.value })}
              placeholder="Libellé de la ligne"
              className="text-sm"
              disabled={readOnly}
              onKeyDown={(e) => handleKeyDown(e, index, "label")}
            />
          </div>
          <div className="p-1">
            <CurrencyInput
              value={line.debit}
              onChange={(val) => updateLine(index, { debit: val, credit: val > 0 ? 0 : line.credit })}
              disabled={readOnly}
              onKeyDown={(e) => handleKeyDown(e, index, "debit")}
            />
          </div>
          <div className="p-1">
            <CurrencyInput
              value={line.credit}
              onChange={(val) => updateLine(index, { credit: val, debit: val > 0 ? 0 : line.debit })}
              disabled={readOnly}
              onKeyDown={(e) => handleKeyDown(e, index, "credit")}
            />
          </div>
          <div className="p-1">
            {!readOnly && lines.length > 2 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-gray-400 hover:text-red-500"
                onClick={() => removeLine(index)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
      ))}

      {/* Add line button */}
      {!readOnly && (
        <div className="p-2 border-b">
          <Button variant="ghost" size="sm" onClick={addLine} className="text-blue-600">
            <Plus className="h-4 w-4 mr-1" /> Ajouter une ligne
          </Button>
        </div>
      )}

      {/* Totals */}
      <div className="grid grid-cols-[40px_1fr_180px_2fr_140px_140px_40px] bg-gray-50 font-semibold">
        <div className="p-2" />
        <div className="p-2" />
        <div className="p-2" />
        <div className="p-2 text-right text-sm">TOTAUX</div>
        <div className="p-2 text-right font-mono text-sm">{formatMAD(totalDebit)}</div>
        <div className="p-2 text-right font-mono text-sm">{formatMAD(totalCredit)}</div>
        <div className="p-2" />
      </div>

      {/* Balance indicator */}
      <div className={`p-2 text-center text-sm font-medium ${isBalanced ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
        {isBalanced ? (
          "ÉQUILIBRÉ"
        ) : (
          `DÉSÉQUILIBRÉ — Écart: ${formatMAD(Math.abs(totalDebit - totalCredit))} MAD`
        )}
      </div>
    </div>
  );
}
