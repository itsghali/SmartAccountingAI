import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";
import { revokeAllUserSessions } from "@/server/session-revocation";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: NextRequest, context: RouteContext) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    }

    if (!["ADMIN", "SUPER_ADMIN"].includes(session.user.role)) {
      return NextResponse.json(
        { error: "Vous n'avez pas les droits pour révoquer les sessions d'un utilisateur" },
        { status: 403 }
      );
    }

    const { id } = await context.params;

    const targetUser = await prisma.user.findUnique({
      where: { id },
      select: { id: true, organizationId: true, role: true },
    });

    if (!targetUser) {
      return NextResponse.json(
        { error: "Utilisateur introuvable" },
        { status: 404 }
      );
    }

    if (targetUser.organizationId !== session.user.organizationId) {
      return NextResponse.json({ error: "Accès interdit" }, { status: 403 });
    }

    if (targetUser.role === "SUPER_ADMIN" && session.user.role !== "SUPER_ADMIN") {
      return NextResponse.json(
        { error: "Seul un Super Admin peut révoquer les sessions d'un autre Super Admin" },
        { status: 403 }
      );
    }

    await revokeAllUserSessions(targetUser.id);

    return NextResponse.json({
      success: true,
      message: "Toutes les sessions de l'utilisateur ont été révoquées",
      userId: targetUser.id,
    });
  } catch (error) {
    console.error("Error revoking user sessions:", error);
    return NextResponse.json(
      { error: "Erreur interne lors de la révocation des sessions" },
      { status: 500 }
    );
  }
}
