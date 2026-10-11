import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/server/prisma";
import { checkRateLimit, createRateLimitResponse, getClientIp } from "@/server/rate-limit";

const registerSchema = z.object({
  firstName: z.string().min(2),
  lastName: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6),
  organizationName: z.string().min(2),
});

export async function POST(request: Request) {
  const ip = getClientIp(request);
  const rateLimitResult = await checkRateLimit("AUTH_REGISTER", `register_${ip}`);
  if (!rateLimitResult.success) {
    return createRateLimitResponse(rateLimitResult);
  }

  try {
    const body = await request.json();
    const parsed = registerSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Données invalides.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { firstName, lastName, email, password, organizationName } =
      parsed.data;

    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return NextResponse.json(
        { error: "Un compte avec cette adresse e-mail existe déjà." },
        { status: 409 }
      );
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const result = await prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: {
          name: organizationName,
          type: "FIDUCIARY",
        },
      });

      const user = await tx.user.create({
        data: {
          organizationId: organization.id,
          email,
          passwordHash,
          firstName,
          lastName,
          role: "ADMIN",
        },
      });

      return { organization, user };
    });

    return NextResponse.json(
      {
        message: "Compte créé avec succès.",
        userId: result.user.id,
        organizationId: result.organization.id,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Registration error:", error);
    return NextResponse.json(
      { error: "Une erreur interne est survenue." },
      { status: 500 }
    );
  }
}
