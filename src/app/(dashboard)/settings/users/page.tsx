"use client";

import { useState, useEffect, useCallback } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  Plus,
  Users as UsersIcon,
  Loader2,
  UserCheck,
  UserX,
} from "lucide-react";

const createUserSchema = z.object({
  firstName: z.string().min(1, "Le prénom est obligatoire"),
  lastName: z.string().min(1, "Le nom est obligatoire"),
  email: z.string().email("Email invalide"),
  role: z.enum(["SUPER_ADMIN", "ADMIN", "ACCOUNTANT", "VIEWER"]),
  password: z.string().min(6, "Le mot de passe doit contenir au moins 6 caractères"),
});

type CreateUserFormData = z.infer<typeof createUserSchema>;

interface User {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: "SUPER_ADMIN" | "ADMIN" | "ACCOUNTANT" | "VIEWER";
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

const roleLabels: Record<string, { label: string; className: string }> = {
  SUPER_ADMIN: {
    label: "Super Admin",
    className:
      "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-purple-100 text-purple-800",
  },
  ADMIN: {
    label: "Administrateur",
    className:
      "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-blue-100 text-blue-800",
  },
  ACCOUNTANT: {
    label: "Comptable",
    className:
      "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-green-100 text-green-800",
  },
  VIEWER: {
    label: "Lecteur",
    className:
      "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-gray-100 text-gray-800",
  },
};

export default function UsersSettingsPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateUserFormData>({
    resolver: zodResolver(createUserSchema),
    defaultValues: {
      role: "ACCOUNTANT",
    },
  });

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/users");
      if (res.ok) {
        const data = await res.json();
        setUsers(data);
      }
    } catch {
      toast.error("Erreur lors du chargement des utilisateurs");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const onSubmit = async (formData: CreateUserFormData) => {
    setCreating(true);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      if (res.ok) {
        toast.success("Utilisateur créé avec succès");
        reset();
        setShowForm(false);
        await fetchUsers();
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

  const toggleActive = async (userId: string, currentActive: boolean) => {
    setTogglingId(userId);
    try {
      const res = await fetch(`/api/users/${userId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !currentActive }),
      });

      if (res.ok) {
        toast.success(
          currentActive ? "Utilisateur désactivé" : "Utilisateur activé"
        );
        setUsers((prev) =>
          prev.map((u) =>
            u.id === userId ? { ...u, isActive: !u.isActive } : u
          )
        );
      } else {
        const err = await res.json();
        toast.error(err.error || "Erreur lors de la mise à jour");
      }
    } catch {
      toast.error("Erreur réseau");
    } finally {
      setTogglingId(null);
    }
  };

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">
          Gestion des Utilisateurs
        </h1>
        <Button onClick={() => setShowForm(!showForm)}>
          <Plus className="h-4 w-4 mr-2" />
          Nouvel Utilisateur
        </Button>
      </div>

      {/* Create Form */}
      {showForm && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">Créer un Utilisateur</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="firstName">Prénom *</Label>
                  <Input
                    id="firstName"
                    {...register("firstName")}
                    placeholder="Prénom"
                  />
                  {errors.firstName && (
                    <p className="text-xs text-red-500">
                      {errors.firstName.message}
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="lastName">Nom *</Label>
                  <Input
                    id="lastName"
                    {...register("lastName")}
                    placeholder="Nom"
                  />
                  {errors.lastName && (
                    <p className="text-xs text-red-500">
                      {errors.lastName.message}
                    </p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="email">Email *</Label>
                  <Input
                    id="email"
                    type="email"
                    {...register("email")}
                    placeholder="utilisateur@societe.ma"
                  />
                  {errors.email && (
                    <p className="text-xs text-red-500">
                      {errors.email.message}
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="role">Rôle *</Label>
                  <select
                    id="role"
                    {...register("role")}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="ACCOUNTANT">Comptable</option>
                    <option value="ADMIN">Administrateur</option>
                    <option value="VIEWER">Lecteur</option>
                    <option value="SUPER_ADMIN">Super Admin</option>
                  </select>
                  {errors.role && (
                    <p className="text-xs text-red-500">
                      {errors.role.message}
                    </p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="password">Mot de passe *</Label>
                  <Input
                    id="password"
                    type="password"
                    {...register("password")}
                    placeholder="Minimum 6 caractères"
                  />
                  {errors.password && (
                    <p className="text-xs text-red-500">
                      {errors.password.message}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex gap-2 justify-end">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setShowForm(false);
                    reset();
                  }}
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

      {/* Users List */}
      {loading ? (
        <div className="text-gray-400 py-8 text-center">Chargement...</div>
      ) : users.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-gray-400">
            <UsersIcon className="h-12 w-12 mx-auto mb-3 text-gray-300" />
            <p>Aucun utilisateur trouvé.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="p-3 text-left">Utilisateur</th>
                <th className="p-3 text-left">Email</th>
                <th className="p-3 text-center">Rôle</th>
                <th className="p-3 text-center">Statut</th>
                <th className="p-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-t hover:bg-gray-50">
                  <td className="p-3">
                    <span className="font-medium">
                      {user.firstName} {user.lastName}
                    </span>
                  </td>
                  <td className="p-3 text-sm text-gray-600">{user.email}</td>
                  <td className="p-3 text-center">
                    <span className={roleLabels[user.role]!.className}>
                      {roleLabels[user.role]!.label}
                    </span>
                  </td>
                  <td className="p-3 text-center">
                    {user.isActive ? (
                      <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-green-100 text-green-800">
                        Actif
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-red-100 text-red-800">
                        Inactif
                      </span>
                    )}
                  </td>
                  <td className="p-3 text-center">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={togglingId === user.id}
                      onClick={() => toggleActive(user.id, user.isActive)}
                      className={
                        user.isActive ? "text-red-500" : "text-green-500"
                      }
                    >
                      {togglingId === user.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : user.isActive ? (
                        <UserX className="h-3.5 w-3.5 mr-1" />
                      ) : (
                        <UserCheck className="h-3.5 w-3.5 mr-1" />
                      )}
                      {user.isActive ? "Désactiver" : "Activer"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
