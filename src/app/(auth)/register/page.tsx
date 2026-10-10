"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const registerSchema = z
  .object({
    firstName: z.string().min(2, "Le prénom doit contenir au moins 2 caractères"),
    lastName: z.string().min(2, "Le nom doit contenir au moins 2 caractères"),
    email: z.string().email("Veuillez entrer une adresse e-mail valide"),
    password: z.string().min(6, "Le mot de passe doit contenir au moins 6 caractères"),
    confirmPassword: z.string(),
    organizationName: z
      .string()
      .min(2, "Le nom de l'organisation doit contenir au moins 2 caractères"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Les mots de passe ne correspondent pas",
    path: ["confirmPassword"],
  });

type RegisterFormData = z.infer<typeof registerSchema>;

export default function RegisterPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
  });

  async function onSubmit(data: RegisterFormData) {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: data.firstName,
          lastName: data.lastName,
          email: data.email,
          password: data.password,
          organizationName: data.organizationName,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        setError(result.error || "Une erreur est survenue lors de l'inscription.");
        return;
      }

      router.push("/login?registered=true");
    } catch {
      setError("Une erreur est survenue. Veuillez réessayer.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="text-2xl font-bold tracking-tight">
          SmartAccountingAI
        </CardTitle>
        <CardDescription>
          Créer un nouveau compte
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          {error && (
            <div className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="firstName">Prénom</Label>
              <Input
                id="firstName"
                placeholder="Jean"
                autoComplete="given-name"
                aria-invalid={!!errors.firstName}
                {...register("firstName")}
              />
              {errors.firstName && (
                <p className="text-sm text-destructive">
                  {errors.firstName.message}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="lastName">Nom</Label>
              <Input
                id="lastName"
                placeholder="Dupont"
                autoComplete="family-name"
                aria-invalid={!!errors.lastName}
                {...register("lastName")}
              />
              {errors.lastName && (
                <p className="text-sm text-destructive">
                  {errors.lastName.message}
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="email">Adresse e-mail</Label>
            <Input
              id="email"
              type="email"
              placeholder="nom@exemple.com"
              autoComplete="email"
              aria-invalid={!!errors.email}
              {...register("email")}
            />
            {errors.email && (
              <p className="text-sm text-destructive">{errors.email.message}</p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="organizationName">Nom de l&apos;organisation</Label>
            <Input
              id="organizationName"
              placeholder="Cabinet comptable XYZ"
              aria-invalid={!!errors.organizationName}
              {...register("organizationName")}
            />
            {errors.organizationName && (
              <p className="text-sm text-destructive">
                {errors.organizationName.message}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="password">Mot de passe</Label>
            <Input
              id="password"
              type="password"
              placeholder="••••••••"
              autoComplete="new-password"
              aria-invalid={!!errors.password}
              {...register("password")}
            />
            {errors.password && (
              <p className="text-sm text-destructive">
                {errors.password.message}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="confirmPassword">Confirmer le mot de passe</Label>
            <Input
              id="confirmPassword"
              type="password"
              placeholder="••••••••"
              autoComplete="new-password"
              aria-invalid={!!errors.confirmPassword}
              {...register("confirmPassword")}
            />
            {errors.confirmPassword && (
              <p className="text-sm text-destructive">
                {errors.confirmPassword.message}
              </p>
            )}
          </div>

          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading ? "Inscription en cours..." : "Créer le compte"}
          </Button>
        </form>
      </CardContent>

      <CardFooter className="justify-center">
        <p className="text-sm text-muted-foreground">
          Déjà inscrit ?{" "}
          <Link
            href="/login"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Se connecter
          </Link>
        </p>
      </CardFooter>
    </Card>
  );
}
