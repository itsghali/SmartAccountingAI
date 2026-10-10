import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { checkPermission } from "@/server/permissions";
import { prisma } from "@/server/prisma";
import Decimal from "decimal.js";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const companyId = request.nextUrl.searchParams.get("companyId");
  const fiscalYearId = request.nextUrl.searchParams.get("fiscalYearId");

  if (!companyId || !fiscalYearId) {
    return NextResponse.json(
      { error: "companyId et fiscalYearId requis" },
      { status: 400 }
    );
  }
  if (!(await checkPermission(companyId, "canAccessTaxPackage"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const taxPackage = await prisma.taxPackage.findUnique({
    where: {
      companyId_fiscalYearId: { companyId, fiscalYearId },
    },
    include: {
      tables: {
        include: {
          cells: {
            orderBy: [{ rowCode: "asc" }, { columnCode: "asc" }],
          },
        },
        orderBy: { tableCode: "asc" },
      },
    },
  });

  if (!taxPackage) {
    return NextResponse.json(null);
  }

  return NextResponse.json(taxPackage);
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const body = await request.json();
  const { companyId, fiscalYearId, action } = body;

  if (!companyId || !fiscalYearId) {
    return NextResponse.json(
      { error: "companyId et fiscalYearId requis" },
      { status: 400 }
    );
  }
  if (!(await checkPermission(companyId, "canAccessTaxPackage"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Handle status transitions (review)
  if (action === "review") {
    const existing = await prisma.taxPackage.findUnique({
      where: { companyId_fiscalYearId: { companyId, fiscalYearId } },
    });
    if (!existing) {
      return NextResponse.json({ error: "Liasse fiscale introuvable" }, { status: 404 });
    }
    const updated = await prisma.taxPackage.update({
      where: { id: existing.id },
      data: { status: "REVIEWED" },
      include: {
        tables: {
          include: { cells: { orderBy: [{ rowCode: "asc" }, { columnCode: "asc" }] } },
          orderBy: { tableCode: "asc" },
        },
      },
    });
    return NextResponse.json(updated);
  }

  // Handle cell update
  if (action === "updateCell") {
    const { cellId, value } = body;
    if (!cellId || value === undefined) {
      return NextResponse.json({ error: "cellId et value requis" }, { status: 400 });
  if (!(await checkPermission(companyId, "canAccessTaxPackage"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    }
    const cell = await prisma.taxPackageCell.update({
      where: { id: cellId },
      data: { value: new Decimal(value).toDecimalPlaces(2).toNumber() },
    });
    return NextResponse.json(cell);
  }

  // Generate (or regenerate) the tax package
  // Fetch trial balance from journal entry lines for this fiscal year
  const lines = await prisma.journalEntryLine.findMany({
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
      account: {
        select: {
          code: true,
          classNumber: true,
          accountType: true,
        },
      },
    },
  });

  // Aggregate balances by account code
  type AccountBalance = {
    code: string;
    classNumber: number;
    accountType: string;
    debit: Decimal;
    credit: Decimal;
  };
  const accountMap = new Map<string, AccountBalance>();

  for (const line of lines) {
    const code = line.accountCode;
    let entry = accountMap.get(code);
    if (!entry) {
      entry = {
        code,
        classNumber: line.account.classNumber,
        accountType: line.account.accountType,
        debit: new Decimal(0),
        credit: new Decimal(0),
      };
      accountMap.set(code, entry);
    }
    entry.debit = entry.debit.plus(new Decimal(line.debit.toString()));
    entry.credit = entry.credit.plus(new Decimal(line.credit.toString()));
  }

  // Helper: sum net balance (debit - credit) for accounts matching prefix
  function sumByPrefix(prefix: string): Decimal {
    let total = new Decimal(0);
    for (const [code, acc] of accountMap) {
      if (code.startsWith(prefix)) {
        total = total.plus(acc.debit.minus(acc.credit));
      }
    }
    return total;
  }

  // Helper: sum net balance for accounts of a given class number
  function sumByClass(classNum: number, accountType?: string): Decimal {
    let total = new Decimal(0);
    for (const [, acc] of accountMap) {
      if (acc.classNumber === classNum) {
        if (accountType && acc.accountType !== accountType) continue;
        total = total.plus(acc.debit.minus(acc.credit));
      }
    }
    return total;
  }

  // ── CPC computations ─────────────────────────────────────────────────────
  // Revenue accounts (class 7) are normally credit balances → net = credit - debit
  const ca = sumByPrefix("71").negated(); // credit balance → negate debit-credit
  const autresProdExpl = sumByPrefix("72").negated().plus(sumByPrefix("73").negated());
  const chargesExpl = sumByPrefix("61"); // debit balance
  const chargesPersonnel = sumByPrefix("62");
  const dotationsExpl = sumByPrefix("63");
  const totalChargesExpl = chargesExpl.plus(chargesPersonnel).plus(dotationsExpl);
  const resultatExpl = ca.plus(autresProdExpl).minus(totalChargesExpl);

  const prodFinancier = sumByPrefix("73").negated();
  const chargesFinancieres = sumByPrefix("63");
  const resultatFinancier = prodFinancier.minus(chargesFinancieres);

  const resultatCourant = resultatExpl.plus(resultatFinancier);

  const prodNonCourant = sumByPrefix("75").negated();
  const chargesNonCourantes = sumByPrefix("65");
  const resultatNonCourant = prodNonCourant.minus(chargesNonCourantes);

  const impots = sumByPrefix("67");
  const resultatNet = resultatCourant.plus(resultatNonCourant).minus(impots);

  // ── BILAN computations ───────────────────────────────────────────────────
  // Actif
  const immobilisations = sumByClass(2); // class 2 assets
  const actifCirculant = sumByClass(3);  // class 3
  const tresorerieActif = (() => {
    let total = new Decimal(0);
    for (const [, acc] of accountMap) {
      if (acc.classNumber === 5 && acc.accountType === "ASSET") {
        total = total.plus(acc.debit.minus(acc.credit));
      }
    }
    return total;
  })();

  // Passif
  const capitauxPropres = sumByClass(1, "EQUITY").negated();
  const dettesFinancement = (() => {
    let total = new Decimal(0);
    for (const [code, acc] of accountMap) {
      if (code.startsWith("14")) {
        total = total.plus(acc.credit.minus(acc.debit));
      }
    }
    return total;
  })();
  const passifCirculant = sumByClass(4).negated();
  const tresoreriePassif = (() => {
    let total = new Decimal(0);
    for (const [code, acc] of accountMap) {
      if (code.startsWith("55")) {
        total = total.plus(acc.credit.minus(acc.debit));
      }
    }
    return total;
  })();

  const totalActif = immobilisations.plus(actifCirculant).plus(tresorerieActif);
  const totalPassif = capitauxPropres.plus(dettesFinancement).plus(passifCirculant).plus(tresoreriePassif);

  function toNum(d: Decimal): number {
    return d.toDecimalPlaces(2).toNumber();
  }

  // Build table definitions
  const cpcCells = [
    { rowCode: "CA", columnCode: "MONTANT", label: "Chiffre d'affaires", value: toNum(ca), isManual: false },
    { rowCode: "AUTRES_PROD_EXPL", columnCode: "MONTANT", label: "Autres produits d'exploitation", value: toNum(autresProdExpl), isManual: false },
    { rowCode: "CHARGES_EXPL", columnCode: "MONTANT", label: "Charges d'exploitation", value: toNum(totalChargesExpl), isManual: false },
    { rowCode: "RES_EXPL", columnCode: "MONTANT", label: "Résultat d'exploitation", value: toNum(resultatExpl), isManual: false },
    { rowCode: "PROD_FIN", columnCode: "MONTANT", label: "Produits financiers", value: toNum(prodFinancier), isManual: false },
    { rowCode: "CHARGES_FIN", columnCode: "MONTANT", label: "Charges financières", value: toNum(chargesFinancieres), isManual: false },
    { rowCode: "RES_FIN", columnCode: "MONTANT", label: "Résultat financier", value: toNum(resultatFinancier), isManual: false },
    { rowCode: "RES_COURANT", columnCode: "MONTANT", label: "Résultat courant", value: toNum(resultatCourant), isManual: false },
    { rowCode: "PROD_NON_COURANT", columnCode: "MONTANT", label: "Produits non courants", value: toNum(prodNonCourant), isManual: false },
    { rowCode: "CHARGES_NON_COURANT", columnCode: "MONTANT", label: "Charges non courantes", value: toNum(chargesNonCourantes), isManual: false },
    { rowCode: "RES_NON_COURANT", columnCode: "MONTANT", label: "Résultat non courant", value: toNum(resultatNonCourant), isManual: false },
    { rowCode: "IMPOTS", columnCode: "MONTANT", label: "Impôts sur les résultats", value: toNum(impots), isManual: false },
    { rowCode: "RES_NET", columnCode: "MONTANT", label: "Résultat net de l'exercice", value: toNum(resultatNet), isManual: false },
  ];

  const bilanActifCells = [
    { rowCode: "IMMOB_BRUT", columnCode: "BRUT", label: "Immobilisations (valeur brute)", value: toNum(immobilisations), isManual: true },
    { rowCode: "IMMOB_AMORT", columnCode: "AMORT", label: "Amortissements et provisions", value: 0, isManual: true },
    { rowCode: "IMMOB_NET", columnCode: "NET", label: "Immobilisations (valeur nette)", value: toNum(immobilisations), isManual: false },
    { rowCode: "ACTIF_CIRC", columnCode: "MONTANT", label: "Actif circulant", value: toNum(actifCirculant), isManual: false },
    { rowCode: "TRESO_ACTIF", columnCode: "MONTANT", label: "Trésorerie – Actif", value: toNum(tresorerieActif), isManual: false },
    { rowCode: "TOTAL_ACTIF", columnCode: "MONTANT", label: "Total Actif", value: toNum(totalActif), isManual: false },
  ];

  const bilanPassifCells = [
    { rowCode: "CAP_PROPRES", columnCode: "MONTANT", label: "Capitaux propres", value: toNum(capitauxPropres), isManual: false },
    { rowCode: "DETTES_FIN", columnCode: "MONTANT", label: "Dettes de financement", value: toNum(dettesFinancement), isManual: false },
    { rowCode: "PASSIF_CIRC", columnCode: "MONTANT", label: "Passif circulant", value: toNum(passifCirculant), isManual: false },
    { rowCode: "TRESO_PASSIF", columnCode: "MONTANT", label: "Trésorerie – Passif", value: toNum(tresoreriePassif), isManual: false },
    { rowCode: "TOTAL_PASSIF", columnCode: "MONTANT", label: "Total Passif", value: toNum(totalPassif), isManual: false },
  ];

  // Upsert the TaxPackage and its tables/cells
  const taxPackage = await prisma.taxPackage.upsert({
    where: { companyId_fiscalYearId: { companyId, fiscalYearId } },
    update: {
      status: "GENERATED",
      generatedAt: new Date(),
    },
    create: {
      companyId,
      fiscalYearId,
      status: "GENERATED",
      generatedAt: new Date(),
    },
  });

  // Delete existing tables and recreate (clean regeneration)
  await prisma.taxPackageTable.deleteMany({ where: { taxPackageId: taxPackage.id } });

  // Create CPC table
  await prisma.taxPackageTable.create({
    data: {
      taxPackageId: taxPackage.id,
      tableCode: "CPC",
      tableName: "Compte de Produits et Charges",
      isAutoGenerated: true,
      cells: {
        create: cpcCells,
      },
    },
  });

  // Create BILAN_ACTIF table
  await prisma.taxPackageTable.create({
    data: {
      taxPackageId: taxPackage.id,
      tableCode: "BILAN_ACTIF",
      tableName: "Bilan – Actif",
      isAutoGenerated: true,
      cells: {
        create: bilanActifCells,
      },
    },
  });

  // Create BILAN_PASSIF table
  await prisma.taxPackageTable.create({
    data: {
      taxPackageId: taxPackage.id,
      tableCode: "BILAN_PASSIF",
      tableName: "Bilan – Passif",
      isAutoGenerated: true,
      cells: {
        create: bilanPassifCells,
      },
    },
  });

  // Fetch and return the complete result
  const result = await prisma.taxPackage.findUnique({
    where: { id: taxPackage.id },
    include: {
      tables: {
        include: {
          cells: {
            orderBy: [{ rowCode: "asc" }, { columnCode: "asc" }],
          },
        },
        orderBy: { tableCode: "asc" },
      },
    },
  });

  return NextResponse.json(result, { status: 201 });
}
