import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";
import Decimal from "decimal.js";

// Sum debit and credit for lines whose accountCode starts with any of the given prefixes
function sumLines(
  lines: Array<{ accountCode: string; debit: Decimal; credit: Decimal }>,
  prefixes: string[]
): { totalDebit: Decimal; totalCredit: Decimal; net: Decimal } {
  let totalDebit = new Decimal(0);
  let totalCredit = new Decimal(0);
  for (const line of lines) {
    if (prefixes.some((p) => line.accountCode.startsWith(p))) {
      totalDebit = totalDebit.plus(line.debit);
      totalCredit = totalCredit.plus(line.credit);
    }
  }
  // net = debit - credit (positive = asset/expense, negative = liability/revenue)
  return { totalDebit, totalCredit, net: totalDebit.minus(totalCredit) };
}

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  const companyId = params.get("companyId");
  const fiscalYearId = params.get("fiscalYearId");

  if (!companyId || !fiscalYearId) {
    return NextResponse.json(
      { error: "companyId et fiscalYearId requis" },
      { status: 400 }
    );
  }

  const rawLines = await prisma.journalEntryLine.findMany({
    where: {
      companyId,
      journalEntry: {
        fiscalYearId,
        journal: { companyId },
        status: { in: ["DRAFT", "VALIDATED"] },
      },
    },
    select: {
      accountCode: true,
      debit: true,
      credit: true,
    },
  });

  // Convert to Decimal
  const lines = rawLines.map((l) => ({
    accountCode: l.accountCode,
    debit: new Decimal(l.debit.toString()),
    credit: new Decimal(l.credit.toString()),
  }));

  // ─── BILAN ACTIF ────────────────────────────────────────────────────────────
  // Immobilisations brutes = accounts 2x (debit side)
  const immosBrut = sumLines(lines, ["2"]);
  // Amortissements/provisions = accounts 28x, 29x (credit reduces net)
  const immosAmort = sumLines(lines, ["28", "29"]);
  // Net immobilisations = gross debit minus amortization credit
  const immosNet = immosBrut.totalDebit.minus(immosAmort.totalCredit);

  // Actif circulant = accounts 3x (debit - credit)
  const actifCirculant = sumLines(lines, ["3"]);
  const actifCirculantNet = actifCirculant.totalDebit.minus(actifCirculant.totalCredit);

  // Trésorerie actif = accounts 51x, 516x, 514x, 515x
  const tresoActif = sumLines(lines, ["51", "516"]);
  const tresoActifNet = tresoActif.totalDebit.minus(tresoActif.totalCredit);

  const totalActif = immosNet.plus(actifCirculantNet).plus(tresoActifNet);

  // ─── BILAN PASSIF ───────────────────────────────────────────────────────────
  // Financement permanent = accounts 1x (equity + long-term liabilities) — credit side
  const financement = sumLines(lines, ["1"]);
  const financementNet = financement.totalCredit.minus(financement.totalDebit);

  // Passif circulant = accounts 4x — credit side
  const passifCirc = sumLines(lines, ["4"]);
  const passifCircNet = passifCirc.totalCredit.minus(passifCirc.totalDebit);

  // Trésorerie passif = accounts 55x
  const tresoPassif = sumLines(lines, ["55"]);
  const tresoPassifNet = tresoPassif.totalCredit.minus(tresoPassif.totalDebit);

  const totalPassif = financementNet.plus(passifCircNet).plus(tresoPassifNet);

  // ─── CPC ────────────────────────────────────────────────────────────────────
  // Produits d'exploitation = 71x (credit - debit → positive = revenue)
  const prodExploit = sumLines(lines, ["71"]);
  const prodExploitNet = prodExploit.totalCredit.minus(prodExploit.totalDebit);

  // Charges d'exploitation = 61x (debit - credit → positive = expense)
  const chargExploit = sumLines(lines, ["61"]);
  const chargExploitNet = chargExploit.totalDebit.minus(chargExploit.totalCredit);

  const resultatExploitation = prodExploitNet.minus(chargExploitNet);

  // Produits financiers = 73x
  const prodFinancier = sumLines(lines, ["73"]);
  const prodFinancierNet = prodFinancier.totalCredit.minus(prodFinancier.totalDebit);

  // Charges financières = 63x
  const chargFinancier = sumLines(lines, ["63"]);
  const chargFinancierNet = chargFinancier.totalDebit.minus(chargFinancier.totalCredit);

  const resultatFinancier = prodFinancierNet.minus(chargFinancierNet);
  const resultatCourant = resultatExploitation.plus(resultatFinancier);

  // Produits non courants = 75x
  const prodNonCourant = sumLines(lines, ["75"]);
  const prodNonCourantNet = prodNonCourant.totalCredit.minus(prodNonCourant.totalDebit);

  // Charges non courantes = 65x
  const chargNonCourant = sumLines(lines, ["65"]);
  const chargNonCourantNet = chargNonCourant.totalDebit.minus(chargNonCourant.totalCredit);

  const resultatNonCourant = prodNonCourantNet.minus(chargNonCourantNet);

  // Impôts sur résultats = 67x
  const impots = sumLines(lines, ["67"]);
  const impotsNet = impots.totalDebit.minus(impots.totalCredit);

  const resultatNet = resultatCourant.plus(resultatNonCourant).minus(impotsNet);

  return NextResponse.json({
    bilan: {
      actif: {
        immobilisations: {
          brut: immosBrut.totalDebit.toFixed(2),
          amortissement: immosAmort.totalCredit.toFixed(2),
          net: immosNet.toFixed(2),
        },
        actifCirculant: {
          debit: actifCirculant.totalDebit.toFixed(2),
          credit: actifCirculant.totalCredit.toFixed(2),
          net: actifCirculantNet.toFixed(2),
        },
        tresorerieActif: {
          debit: tresoActif.totalDebit.toFixed(2),
          credit: tresoActif.totalCredit.toFixed(2),
          net: tresoActifNet.toFixed(2),
        },
        totalActif: totalActif.toFixed(2),
      },
      passif: {
        financementPermanent: {
          debit: financement.totalDebit.toFixed(2),
          credit: financement.totalCredit.toFixed(2),
          net: financementNet.toFixed(2),
        },
        passifCirculant: {
          debit: passifCirc.totalDebit.toFixed(2),
          credit: passifCirc.totalCredit.toFixed(2),
          net: passifCircNet.toFixed(2),
        },
        tresoreriePassif: {
          debit: tresoPassif.totalDebit.toFixed(2),
          credit: tresoPassif.totalCredit.toFixed(2),
          net: tresoPassifNet.toFixed(2),
        },
        totalPassif: totalPassif.toFixed(2),
      },
    },
    cpc: {
      produitsExploitation: prodExploitNet.toFixed(2),
      chargesExploitation: chargExploitNet.toFixed(2),
      resultatExploitation: resultatExploitation.toFixed(2),
      produitsFinanciers: prodFinancierNet.toFixed(2),
      chargesFinancieres: chargFinancierNet.toFixed(2),
      resultatFinancier: resultatFinancier.toFixed(2),
      resultatCourant: resultatCourant.toFixed(2),
      produitsNonCourants: prodNonCourantNet.toFixed(2),
      chargesNonCourantes: chargNonCourantNet.toFixed(2),
      resultatNonCourant: resultatNonCourant.toFixed(2),
      impotsSurResultats: impotsNet.toFixed(2),
      resultatNet: resultatNet.toFixed(2),
    },
  });
}
