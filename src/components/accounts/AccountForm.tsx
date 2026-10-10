"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

interface Account {
  id: string;
  code: string;
  label: string;
  labelAr?: string;
  classNumber: number;
  accountType: string;
  parentCode: string | null;
  isSystem: boolean;
  isActive: boolean;
  isAuxiliary: boolean;
  isTiers: boolean;
  requiresAnalytical: boolean;
  vatRate?: number;
  vatType?: string;
}

interface AccountFormProps {
  account?: Account | null;
  companyId: string;
  onSaved: () => void;
}

export function AccountForm({ account, companyId, onSaved }: AccountFormProps) {
  const [code, setCode] = useState(account?.code || "");
  const [label, setLabel] = useState(account?.label || "");
  const [labelAr, setLabelAr] = useState(account?.labelAr || "");
  const [parentCode, setParentCode] = useState(account?.parentCode || "");
  const [accountType, setAccountType] = useState(account?.accountType || "ASSET");
  const [isAuxiliary, setIsAuxiliary] = useState(account?.isAuxiliary || false);
  const [isTiers, setIsTiers] = useState(account?.isTiers || false);
  const [requiresAnalytical, setRequiresAnalytical] = useState(account?.requiresAnalytical || false);
  const [vatRate, setVatRate] = useState(account?.vatRate?.toString() || "");
  const [saving, setSaving] = useState(false);

  const classNumber = code ? parseInt(code[0]!) : 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code || !label) {
      toast.error("Le code et le libellé sont requis");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          code,
          label,
          labelAr: labelAr || undefined,
          classNumber,
          accountType,
          parentCode: parentCode || undefined,
          isAuxiliary,
          isTiers,
          requiresAnalytical,
          vatRate: vatRate ? parseFloat(vatRate) : undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || "Erreur");
        return;
      }

      toast.success("Compte créé avec succès");
      onSaved();
    } catch {
      toast.error("Erreur de connexion");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="p-6 m-6 bg-card/60 backdrop-blur-md rounded-xl border border-border/50 shadow-sm space-y-6">
      <h3 className="text-xl font-bold bg-clip-text text-transparent bg-linear-to-r from-primary to-secondary mb-2">
        {account ? "Détails du compte" : "Nouveau compte"}
      </h3>

      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-2">
          <Label className="text-muted-foreground">Code *</Label>
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="ex: 61111"
            className="font-mono"
            disabled={account?.isSystem}
            maxLength={11}
          />
        </div>
        <div className="space-y-2">
          <Label className="text-muted-foreground">Type</Label>
          <Select value={accountType} onValueChange={(v) => v !== null && setAccountType(v)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ASSET">Actif</SelectItem>
              <SelectItem value="LIABILITY">Passif</SelectItem>
              <SelectItem value="EQUITY">Capitaux propres</SelectItem>
              <SelectItem value="REVENUE">Produits</SelectItem>
              <SelectItem value="EXPENSE">Charges</SelectItem>
              <SelectItem value="RESULT">Résultat</SelectItem>
              <SelectItem value="OFF_BALANCE_SHEET">Hors bilan</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-muted-foreground">Libellé (Français) *</Label>
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Libellé du compte"
          disabled={account?.isSystem}
        />
      </div>

      <div className="space-y-2">
        <Label className="text-muted-foreground">Libellé (Arabe)</Label>
        <Input
          value={labelAr}
          onChange={(e) => setLabelAr(e.target.value)}
          placeholder="التسمية بالعربية"
          dir="rtl"
        />
      </div>

      <div className="space-y-2">
        <Label className="text-muted-foreground">Compte parent</Label>
        <Input
          value={parentCode}
          onChange={(e) => setParentCode(e.target.value)}
          placeholder="Code du compte parent"
          className="font-mono"
        />
      </div>

      <div className="space-y-2">
        <Label className="text-muted-foreground">Taux TVA par défaut</Label>
        <Select value={vatRate} onValueChange={(v) => v !== null && setVatRate(v)}>
          <SelectTrigger>
            <SelectValue placeholder="Aucun" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">Aucun</SelectItem>
            <SelectItem value="0">0%</SelectItem>
            <SelectItem value="7">7%</SelectItem>
            <SelectItem value="10">10%</SelectItem>
            <SelectItem value="14">14%</SelectItem>
            <SelectItem value="20">20%</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-4 pt-4 border-t border-border/50 mt-4">
        <div className="flex items-center justify-between p-3 rounded-lg border border-border/50 bg-muted/20">
          <Label className="font-medium">Compte auxiliaire</Label>
          <Switch checked={isAuxiliary} onCheckedChange={setIsAuxiliary} />
        </div>
        <div className="flex items-center justify-between p-3 rounded-lg border border-border/50 bg-muted/20">
          <Label className="font-medium">Compte tiers (client/fournisseur)</Label>
          <Switch checked={isTiers} onCheckedChange={setIsTiers} />
        </div>
        <div className="flex items-center justify-between p-3 rounded-lg border border-border/50 bg-muted/20">
          <Label className="font-medium">Ventilation analytique obligatoire</Label>
          <Switch checked={requiresAnalytical} onCheckedChange={setRequiresAnalytical} />
        </div>
      </div>

      {!account?.isSystem && (
        <Button type="submit" disabled={saving} className="w-full">
          {saving ? "Enregistrement..." : account ? "Mettre à jour" : "Créer le compte"}
        </Button>
      )}
    </form>
  );
}
