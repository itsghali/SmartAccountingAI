import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";
import bcrypt from "bcryptjs";
import { z } from "zod";

const createUserSchema = z.object({
  firstName: z.string().min(1, "Le prénom est obligatoire"),
  lastName: z.string().min(1, "Le nom est obligatoire"),
  email: z.string().email("Email invalide"),
  role: z.enum(["SUPER_ADMIN", "ADMIN", "ACCOUNTANT", "VIEWER"]),
  password: z.string().min(6, "Le mot de passe doit contenir au moins 6 caractères"),
});

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    }

    const users = await prisma.user.findMany({
      where: {
        organizationId: session.user.organizationId,
      },
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
      orderBy: [{ role: "asc" }, { lastName: "asc" }],
    });

    return NextResponse.json(users);
  } catch (error) {
    console.error("Error fetching users:", error);
    return NextResponse.json(
      { error: "Erreur interne du serveur" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    }

    // Only ADMIN and SUPER_ADMIN can create users
    if (!["ADMIN", "SUPER_ADMIN"].includes(session.user.role)) {
      return NextResponse.json(
        { error: "Vous n'avez pas les droits pour créer un utilisateur" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const parsed = createUserSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation échouée", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { firstName, lastName, email, role, password } = parsed.data;

    // Check if email already exists
    const existing = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    if (existing) {
      return NextResponse.json(
        { error: "Un utilisateur avec cet email existe déjà" },
        { status: 409 }
      );
    }

    // Prevent non-SUPER_ADMIN from creating SUPER_ADMIN
    if (role === "SUPER_ADMIN" && session.user.role !== "SUPER_ADMIN") {
      return NextResponse.json(
        { error: "Seul un Super Admin peut créer un autre Super Admin" },
        { status: 403 }
      );
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: {
        organizationId: session.user.organizationId,
        firstName,
        lastName,
        email,
        role,
        passwordHash,
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
    });

    return NextResponse.json(user, { status: 201 });
  } catch (error: unknown) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "Un utilisateur avec cet email existe déjà" },
        { status: 409 }
      );
    }
    console.error("Error creating user:", error);
    return NextResponse.json(
      { error: "Erreur interne du serveur" },
      { status: 500 }
    );
  }
}
