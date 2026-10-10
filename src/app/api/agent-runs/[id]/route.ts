import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const user = session.user as { organizationId: string };
  const { id } = await params;
  const fiscalYearId = request.nextUrl.searchParams.get("fiscalYearId");

  const run = await prisma.agentRun.findUnique({
    where: { id },
    select: {
      id: true,
      agentType: true,
      status: true,
      modelVersion: true,
      durationMs: true,
      createdAt: true,
      completedAt: true,
      errorMessage: true,
      structuredOutput: true,
      inputSnapshot: true,      // contient fiscalYear, ledgerState, openItems, priorPeriod
      company: { select: { organizationId: true } },
    },
  });

  if (!run) {
    return NextResponse.json({ error: "Run introuvable" }, { status: 404 });
  }

  // Vérifier que le run appartient à l'organisation de l'utilisateur
  if (run.company.organizationId !== user.organizationId) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  if (run.status !== "COMPLETED" || !run.structuredOutput) {
    return NextResponse.json(
      { error: "Ce run n'a pas de résultat disponible (statut: " + run.status + ")" },
      { status: 400 }
    );
  }

  // inputSnapshot.inputData contient fiscalYear, ledgerState, openItems, priorPeriod
  // structuredOutput contient summary, suggestions, governance
  // On les combine ici pour reconstruire le résultat complet côté client.
  const inputData =
    run.inputSnapshot &&
    typeof run.inputSnapshot === "object" &&
    "inputData" in run.inputSnapshot
      ? (run.inputSnapshot as Record<string, unknown>).inputData
      : null;

  const runFiscalYearId =
    inputData && typeof inputData === "object" && "fiscalYearId" in inputData
      ? (inputData as Record<string, unknown>).fiscalYearId
      : null;

  if (fiscalYearId && runFiscalYearId !== fiscalYearId) {
    return NextResponse.json(
      { error: "Ce run appartient à un autre exercice." },
      { status: 404 }
    );
  }

  return NextResponse.json({
    runId: run.id,
    modelVersion: run.modelVersion,
    durationMs: run.durationMs ?? 0,
    createdAt: run.createdAt,
    structuredOutput: run.structuredOutput,
    inputData,
  });
}
