import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";

const schema = z.object({
  companyId: z.string().min(1),
  fiscalYearId: z.string().min(1),
});

/**
 * POST /api/entries/duplicate-prior-year
 *
 * Copie toutes les écritures VALIDÉES de l'exercice N-1 vers l'exercice courant,
 * avec origin=AUTO et sourceModule="PRIOR_YEAR_COPY".
 * Ces écritures servent de référence N-1 lors de la clôture.
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const user = session.user as { id: string; organizationId: string };

  try {
    const body = await request.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Paramètres invalides" }, { status: 400 });
    }

    const { companyId, fiscalYearId } = parsed.data;

    // Vérifier l'accès à la société
    const company = await prisma.company.findFirst({
      where: { id: companyId, organizationId: user.organizationId },
      select: { id: true },
    });
    if (!company) {
      return NextResponse.json({ error: "Société introuvable" }, { status: 404 });
    }

    // Vérifier les droits de l'utilisateur
    const access = await prisma.userCompanyAccess.findUnique({
      where: { userId_companyId: { userId: user.id, companyId } },
      select: { canCloseExercise: true },
    });
    if (!access?.canCloseExercise) {
      return NextResponse.json({ error: "Droits insuffisants" }, { status: 403 });
    }

    // Charger l'exercice courant
    const currentFiscalYear = await prisma.fiscalYear.findUnique({
      where: { id: fiscalYearId },
      select: { id: true, startDate: true, endDate: true, status: true, companyId: true },
    });
    if (!currentFiscalYear || currentFiscalYear.companyId !== companyId) {
      return NextResponse.json({ error: "Exercice introuvable" }, { status: 404 });
    }
    if (currentFiscalYear.status !== "OPEN" && currentFiscalYear.status !== "PROVISIONAL_CLOSE") {
      return NextResponse.json(
        { error: "L'exercice doit être ouvert ou en clôture provisoire" },
        { status: 400 }
      );
    }

    // Trouver l'exercice N-1 (celui qui se termine juste avant le début de l'exercice courant)
    const priorFiscalYear = await prisma.fiscalYear.findFirst({
      where: {
        companyId,
        endDate: { lt: currentFiscalYear.startDate },
      },
      orderBy: { endDate: "desc" },
      select: { id: true, label: true },
    });
    if (!priorFiscalYear) {
      return NextResponse.json(
        { error: "Aucun exercice précédent (N-1) trouvé pour cette société" },
        { status: 404 }
      );
    }

    // Vérifier que la duplication N-1 n'a pas déjà été faite
    const alreadyDuplicated = await prisma.journalEntry.count({
      where: {
        fiscalYearId,
        sourceModule: "PRIOR_YEAR_COPY",
      },
    });
    if (alreadyDuplicated > 0) {
      return NextResponse.json(
        {
          error: `La duplication N-1 a déjà été effectuée (${alreadyDuplicated} écriture(s) existantes). Supprimez-les d'abord si vous souhaitez recommencer.`,
        },
        { status: 409 }
      );
    }

    // Charger toutes les écritures validées de N-1 avec leurs lignes
    const priorEntries = await prisma.journalEntry.findMany({
      where: {
        fiscalYearId: priorFiscalYear.id,
        status: "VALIDATED",
        // Exclure les éventuelles copies N-1 précédentes
        NOT: { sourceModule: "PRIOR_YEAR_COPY" },
      },
      include: {
        lines: { orderBy: { lineNumber: "asc" } },
        journal: { select: { id: true, companyId: true } },
      },
      orderBy: [{ entryDate: "asc" }, { entryNumber: "asc" }],
    });

    if (priorEntries.length === 0) {
      return NextResponse.json(
        { error: "Aucune écriture validée dans l'exercice N-1" },
        { status: 404 }
      );
    }

    // Pour chaque écriture N-1, obtenir le prochain numéro dans le journal courant
    // et créer la copie dans l'exercice courant
    let duplicatedCount = 0;

    for (const entry of priorEntries) {
      // Obtenir le prochain numéro d'écriture pour ce journal dans l'exercice courant
      const lastEntry = await prisma.journalEntry.findFirst({
        where: { journalId: entry.journalId, fiscalYearId },
        orderBy: { entryNumber: "desc" },
        select: { entryNumber: true },
      });
      const nextEntryNumber = (lastEntry?.entryNumber ?? 0) + 1;

      // Décaler la date d'un an en avant pour qu'elle tombe dans l'exercice courant
      const originalDate = new Date(entry.entryDate);
      const shiftedDate = new Date(originalDate);
      shiftedDate.setFullYear(shiftedDate.getFullYear() + 1);

      // Si la date décalée dépasse la fin de l'exercice courant, utiliser le dernier jour
      const targetDate =
        shiftedDate <= currentFiscalYear.endDate ? shiftedDate : currentFiscalYear.endDate;

      await prisma.journalEntry.create({
        data: {
          fiscalYearId,
          journalId: entry.journalId,
          entryNumber: nextEntryNumber,
          entryDate: targetDate,
          reference: entry.reference,
          description: `[N-1] ${entry.description}`,
          piece: entry.piece,
          status: "VALIDATED",
          totalDebit: entry.totalDebit,
          totalCredit: entry.totalCredit,
          origin: "AUTO",
          sourceModule: "PRIOR_YEAR_COPY",
          sourceId: entry.id,
          createdById: user.id,
          lines: {
            create: entry.lines.map((line) => ({
              lineNumber: line.lineNumber,
              accountCode: line.accountCode,
              companyId,
              label: line.label,
              debit: line.debit,
              credit: line.credit,
              tiersName: line.tiersName,
              tiersReference: line.tiersReference,
              dueDate: line.dueDate,
            })),
          },
        },
      });

      duplicatedCount++;
    }

    return NextResponse.json({
      success: true,
      priorFiscalYearLabel: priorFiscalYear.label,
      duplicatedCount,
      message: `${duplicatedCount} écriture(s) N-1 copiées depuis l'exercice "${priorFiscalYear.label}"`,
    });
  } catch (error) {
    console.error("Erreur duplication N-1:", error);
    return NextResponse.json({ error: "Erreur interne du serveur" }, { status: 500 });
  }
}
