import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";
import { z } from "zod";

type RouteContext = { params: Promise<{ id: string }> };

const updateUserSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  role: z.enum(["SUPER_ADMIN", "ADMIN", "ACCOUNTANT", "VIEWER"]).optional(),
  isActive: z.boolean().optional(),
});

export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    }

    // Only ADMIN and SUPER_ADMIN can update users
    if (!["ADMIN", "SUPER_ADMIN"].includes(session.user.role)) {
      return NextResponse.json(
        { error: "Vous n'avez pas les droits pour modifier un utilisateur" },
        { status: 403 }
      );
    }

    const { id } = await context.params;

    // Verify user belongs to same organization
    const existing = await prisma.user.findUnique({
      where: { id },
      select: { organizationId: true, role: true },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "Utilisateur introuvable" },
        { status: 404 }
      );
    }

    if (existing.organizationId !== session.user.organizationId) {
      return NextResponse.json({ error: "Accès interdit" }, { status: 403 });
    }

    // Prevent non-SUPER_ADMIN from modifying SUPER_ADMIN users
    if (
      existing.role === "SUPER_ADMIN" &&
      session.user.role !== "SUPER_ADMIN"
    ) {
      return NextResponse.json(
        { error: "Seul un Super Admin peut modifier un autre Super Admin" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const parsed = updateUserSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation échouée", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    // Prevent setting role to SUPER_ADMIN unless requester is SUPER_ADMIN
    if (
      parsed.data.role === "SUPER_ADMIN" &&
      session.user.role !== "SUPER_ADMIN"
    ) {
      return NextResponse.json(
        { error: "Seul un Super Admin peut attribuer ce rôle" },
        { status: 403 }
      );
    }

    // Prevent deactivating yourself
    if (parsed.data.isActive === false && id === session.user.id) {
      return NextResponse.json(
        { error: "Vous ne pouvez pas vous désactiver vous-même" },
        { status: 400 }
      );
    }

    const user = await prisma.user.update({
      where: { id },
      data: parsed.data,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        role: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
      },
    });

    return NextResponse.json(user);
  } catch (error) {
    console.error("Error updating user:", error);
    return NextResponse.json(
      { error: "Erreur interne du serveur" },
      { status: 500 }
    );
  }
}
