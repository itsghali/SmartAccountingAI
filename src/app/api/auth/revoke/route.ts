import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { revokeSession, revokeAllUserSessions } from "@/server/session-revocation";

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    }

    let all = false;
    try {
      const body = await request.json();
      all = Boolean(body?.all);
    } catch {
      // Empty or non-JSON body defaults to revoking current session
    }

    if (all) {
      await revokeAllUserSessions(session.user.id);
      return NextResponse.json({
        success: true,
        message: "Toutes vos sessions ont été révoquées",
      });
    }

    if (session.user.jti) {
      await revokeSession(session.user.jti);
    }

    return NextResponse.json({
      success: true,
      message: "Session courante révoquée avec succès",
    });
  } catch (error) {
    console.error("Error during session revocation:", error);
    return NextResponse.json(
      { error: "Erreur lors de la révocation de la session" },
      { status: 500 }
    );
  }
}
