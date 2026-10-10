"use client";

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAppContext } from "@/hooks/useAppContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Save, Loader2 } from "lucide-react";

const companyFormSchema = z.object({
  name: z.string().min(1, "Le nom est obligatoire").max(255),
  legalForm: z.string().max(100).optional().or(z.literal("")),
  address: z.string().max(500).optional().or(z.literal("")),
  city: z.string().max(100).optional().or(z.literal("")),
  phone: z.string().max(50).optional().or(z.literal("")),
  email: z.string().email("Email invalide").optional().or(z.literal("")),
  ice: z.string().max(50).optional().or(z.literal("")),
  rc: z.string().max(50).optional().or(z.literal("")),
  patente: z.string().max(50).optional().or(z.literal("")),
  cnss: z.string().max(50).optional().or(z.literal("")),
  ifNumber: z.string().max(50).optional().or(z.literal("")),
});

type CompanyFormData = z.infer<typeof companyFormSchema>;

interface CompanyData {
  id: string;
  name: string;
  legalForm: string | null;
  address: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
  ice: string | null;
  rc: string | null;
  patente: string | null;
  cnss: string | null;
  ifNumber: string | null;
}

export default function CompanySettingsPage() {
  const { currentCompanyId } = useAppContext();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<CompanyFormData>({
    resolver: zodResolver(companyFormSchema),
  });

  useEffect(() => {
    if (!currentCompanyId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    fetch(`/api/companies/${currentCompanyId}`)
      .then((r) => r.json())
      .then((data: CompanyData) => {
        reset({
          name: data.name || "",
          legalForm: data.legalForm || "",
          address: data.address || "",
          city: data.city || "",
          phone: data.phone || "",
          email: data.email || "",
          ice: data.ice || "",
          rc: data.rc || "",
          patente: data.patente || "",
          cnss: data.cnss || "",
          ifNumber: data.ifNumber || "",
        });
      })
      .catch(() => toast.error("Erreur lors du chargement des données"))
      .finally(() => setLoading(false));
  }, [currentCompanyId, reset]);

  const onSubmit = async (formData: CompanyFormData) => {
    if (!currentCompanyId) return;

    setSaving(true);
    try {
      // Convert empty strings to null for optional fields
      const payload: Record<string, string | null> = { name: formData.name };
      const optionalFields: (keyof CompanyFormData)[] = [
        "legalForm",
        "address",
        "city",
        "phone",
        "email",
        "ice",
        "rc",
        "patente",
        "cnss",
        "ifNumber",
      ];

      for (const field of optionalFields) {
        const val = formData[field];
        payload[field] = val && val.trim() !== "" ? val.trim() : null;
      }

      const res = await fetch(`/api/companies/${currentCompanyId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const updated = await res.json();
        reset({
          name: updated.name || "",
          legalForm: updated.legalForm || "",
          address: updated.address || "",
          city: updated.city || "",
          phone: updated.phone || "",
          email: updated.email || "",
          ice: updated.ice || "",
          rc: updated.rc || "",
          patente: updated.patente || "",
          cnss: updated.cnss || "",
          ifNumber: updated.ifNumber || "",
        });
        toast.success("Société mise à jour avec succès");
      } else {
        const err = await res.json();
        toast.error(err.error || "Erreur lors de la mise à jour");
      }
    } catch {
      toast.error("Erreur réseau");
    } finally {
      setSaving(false);
    }
  };

  if (!currentCompanyId) {
    return (
      <div className="p-6 text-gray-500">
        Veuillez sélectionner une société.
      </div>
    );
  }

  if (loading) {
    return <div className="p-6 text-gray-500">Chargement...</div>;
  }

  return (
    <div className="p-6 max-w-75xl animate-in fade-in duration-500">
      <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-linear-to-r from-primary to-secondary mb-8">
        Paramètres de la Société
      </h1>

      <form onSubmit={handleSubmit(onSubmit)}>
        {/* General Info */}
        <Card className="mb-8 bg-card/60 backdrop-blur-xl border-border/50 shadow-sm transition-all duration-300 hover:shadow-md">
          <CardHeader>
            <CardTitle className="text-base">Informations Générales</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="name">Raison sociale *</Label>
                <Input
                  id="name"
                  {...register("name")}
                  placeholder="Nom de la société"
                />
                {errors.name && (
                  <p className="text-xs text-red-500">{errors.name.message}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="legalForm">Forme juridique</Label>
                <Input
                  id="legalForm"
                  {...register("legalForm")}
                  placeholder="SARL, SA, SNC..."
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="address">Adresse</Label>
              <Input
                id="address"
                {...register("address")}
                placeholder="Adresse complète"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="city">Ville</Label>
                <Input
                  id="city"
                  {...register("city")}
                  placeholder="Ville"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="phone">Téléphone</Label>
                <Input
                  id="phone"
                  {...register("phone")}
                  placeholder="+212..."
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                {...register("email")}
                placeholder="contact@societe.ma"
              />
              {errors.email && (
                <p className="text-xs text-red-500">{errors.email.message}</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Fiscal Identifiers */}
        <Card className="mb-8 bg-card/60 backdrop-blur-xl border-border/50 shadow-sm transition-all duration-300 hover:shadow-md">
          <CardHeader>
            <CardTitle className="text-base">
              Identifiants Fiscaux
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="ice">ICE</Label>
                <Input
                  id="ice"
                  {...register("ice")}
                  placeholder="Identifiant Commun de l'Entreprise"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rc">RC</Label>
                <Input
                  id="rc"
                  {...register("rc")}
                  placeholder="Registre du Commerce"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="patente">Patente</Label>
                <Input
                  id="patente"
                  {...register("patente")}
                  placeholder="N° Patente"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cnss">CNSS</Label>
                <Input
                  id="cnss"
                  {...register("cnss")}
                  placeholder="N° CNSS"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ifNumber">IF</Label>
                <Input
                  id="ifNumber"
                  {...register("ifNumber")}
                  placeholder="Identifiant Fiscal"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button type="submit" disabled={saving || !isDirty}>
            {saving ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            Enregistrer
          </Button>
        </div>
      </form>
    </div>
  );
}
