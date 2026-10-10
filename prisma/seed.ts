import "dotenv/config";
import { AccountType } from "@prisma/client";
import bcrypt from "bcryptjs";
import { prisma } from "../src/server/prisma";

type AccountSeed = [string, string, number, AccountType];


const PCGM_NORMAL: AccountSeed[] = [
  // CLASS 1 — COMPTES DE FINANCEMENT PERMANENT
  ["1", "Comptes de financement permanent", 1, "EQUITY"],
  ["11", "Capitaux propres", 1, "EQUITY"],
  ["111", "Capital social ou personnel", 1, "EQUITY"],
  ["1111", "Capital social", 1, "EQUITY"],
  ["1117", "Capital personnel", 1, "EQUITY"],
  ["112", "Primes d'émission, de fusion et d'apport", 1, "EQUITY"],
  ["1121", "Primes d'émission", 1, "EQUITY"],
  ["113", "Écarts de réévaluation", 1, "EQUITY"],
  ["114", "Réserve légale", 1, "EQUITY"],
  ["1140", "Réserve légale", 1, "EQUITY"],
  ["115", "Autres réserves", 1, "EQUITY"],
  ["1151", "Réserves statutaires ou contractuelles", 1, "EQUITY"],
  ["1152", "Réserves facultatives", 1, "EQUITY"],
  ["116", "Report à nouveau", 1, "EQUITY"],
  ["1161", "Report à nouveau (solde créditeur)", 1, "EQUITY"],
  ["1169", "Report à nouveau (solde débiteur)", 1, "EQUITY"],
  ["118", "Résultats nets en instance d'affectation", 1, "EQUITY"],
  ["1181", "Résultats nets en instance d'affectation (créditeur)", 1, "EQUITY"],
  ["1189", "Résultats nets en instance d'affectation (débiteur)", 1, "EQUITY"],
  ["119", "Résultat net de l'exercice", 1, "EQUITY"],
  ["1191", "Résultat net de l'exercice (bénéfice)", 1, "EQUITY"],
  ["1199", "Résultat net de l'exercice (perte)", 1, "EQUITY"],
  ["13", "Capitaux propres assimilés", 1, "EQUITY"],
  ["131", "Subventions d'investissement", 1, "EQUITY"],
  ["135", "Provisions réglementées", 1, "EQUITY"],
  ["14", "Dettes de financement", 1, "LIABILITY"],
  ["141", "Emprunts obligataires", 1, "LIABILITY"],
  ["148", "Autres dettes de financement", 1, "LIABILITY"],
  ["1481", "Emprunts auprès des établissements de crédit", 1, "LIABILITY"],
  ["15", "Provisions durables pour risques et charges", 1, "LIABILITY"],
  ["151", "Provisions pour risques", 1, "LIABILITY"],
  ["155", "Provisions pour charges", 1, "LIABILITY"],
  ["17", "Écarts de conversion — Passif", 1, "LIABILITY"],

  // CLASS 2 — COMPTES D'ACTIF IMMOBILISÉ
  ["2", "Comptes d'actif immobilisé", 2, "ASSET"],
  ["21", "Immobilisations en non-valeurs", 2, "ASSET"],
  ["211", "Frais préliminaires", 2, "ASSET"],
  ["212", "Charges à répartir sur plusieurs exercices", 2, "ASSET"],
  ["22", "Immobilisations incorporelles", 2, "ASSET"],
  ["221", "Immobilisation en recherche et développement", 2, "ASSET"],
  ["222", "Brevets, marques, droits et valeurs similaires", 2, "ASSET"],
  ["223", "Fonds commercial", 2, "ASSET"],
  ["23", "Immobilisations corporelles", 2, "ASSET"],
  ["231", "Terrains", 2, "ASSET"],
  ["2311", "Terrains nus", 2, "ASSET"],
  ["2312", "Terrains aménagés", 2, "ASSET"],
  ["2313", "Terrains bâtis", 2, "ASSET"],
  ["232", "Constructions", 2, "ASSET"],
  ["2321", "Bâtiments", 2, "ASSET"],
  ["233", "Installations techniques, matériel et outillage", 2, "ASSET"],
  ["2331", "Installations techniques", 2, "ASSET"],
  ["2332", "Matériel et outillage", 2, "ASSET"],
  ["234", "Matériel de transport", 2, "ASSET"],
  ["2340", "Matériel de transport", 2, "ASSET"],
  ["235", "Mobilier, matériel de bureau et aménagements divers", 2, "ASSET"],
  ["2351", "Mobilier de bureau", 2, "ASSET"],
  ["2352", "Matériel de bureau", 2, "ASSET"],
  ["2355", "Matériel informatique", 2, "ASSET"],
  ["2356", "Agencements, installations et aménagements", 2, "ASSET"],
  ["238", "Autres immobilisations corporelles", 2, "ASSET"],
  ["239", "Immobilisations corporelles en cours", 2, "ASSET"],
  ["24", "Immobilisations financières", 2, "ASSET"],
  ["241", "Prêts immobilisés", 2, "ASSET"],
  ["248", "Autres créances financières", 2, "ASSET"],
  ["25", "Immobilisations incorporelles en cours", 2, "ASSET"],
  ["27", "Écarts de conversion — Actif", 2, "ASSET"],
  ["28", "Amortissements des immobilisations", 2, "ASSET"],
  ["281", "Amortissements des non-valeurs", 2, "ASSET"],
  ["282", "Amortissements des immob. incorporelles", 2, "ASSET"],
  ["283", "Amortissements des immob. corporelles", 2, "ASSET"],
  ["2831", "Amortissements des terrains", 2, "ASSET"],
  ["2832", "Amortissements des constructions", 2, "ASSET"],
  ["2833", "Amortissements des ITMO", 2, "ASSET"],
  ["2834", "Amortissements du matériel de transport", 2, "ASSET"],
  ["2835", "Amortissements du MMB et aménagements", 2, "ASSET"],
  ["28355", "Amortissements du matériel informatique", 2, "ASSET"],
  ["29", "Provisions pour dépréciation des immobilisations", 2, "ASSET"],

  // CLASS 3 — COMPTES D'ACTIF CIRCULANT
  ["3", "Comptes d'actif circulant", 3, "ASSET"],
  ["31", "Stocks", 3, "ASSET"],
  ["311", "Marchandises", 3, "ASSET"],
  ["312", "Matières et fournitures consommables", 3, "ASSET"],
  ["313", "Produits en cours", 3, "ASSET"],
  ["315", "Produits finis", 3, "ASSET"],
  ["34", "Créances de l'actif circulant", 3, "ASSET"],
  ["341", "Fournisseurs débiteurs, avances et acomptes", 3, "ASSET"],
  ["342", "Clients et comptes rattachés", 3, "ASSET"],
  ["3421", "Clients", 3, "ASSET"],
  ["3423", "Clients — retenues de garantie", 3, "ASSET"],
  ["3424", "Clients douteux ou litigieux", 3, "ASSET"],
  ["3425", "Clients — effets à recevoir", 3, "ASSET"],
  ["3427", "RRR à obtenir — avoir non encore reçus", 3, "ASSET"],
  ["343", "Personnel — débiteur", 3, "ASSET"],
  ["345", "État — débiteur", 3, "ASSET"],
  ["3451", "Subventions à recevoir", 3, "ASSET"],
  ["3453", "Acomptes sur IS", 3, "ASSET"],
  ["3455", "État — TVA récupérable", 3, "ASSET"],
  ["34551", "État — TVA récupérable sur immobilisations", 3, "ASSET"],
  ["34552", "État — TVA récupérable sur charges", 3, "ASSET"],
  ["3456", "État — crédit de TVA (suivant déclaration)", 3, "ASSET"],
  ["3458", "État — autres comptes débiteurs", 3, "ASSET"],
  ["346", "Comptes d'associés — débiteurs", 3, "ASSET"],
  ["348", "Autres débiteurs", 3, "ASSET"],
  ["349", "Comptes de régularisation — actif", 3, "ASSET"],
  ["3491", "Charges constatées d'avance", 3, "ASSET"],
  ["39", "Provisions pour dépréciation des comptes de l'actif circulant", 3, "ASSET"],
  ["391", "Provisions pour dépréciation des stocks", 3, "ASSET"],
  ["394", "Provisions pour dépréciation des créances", 3, "ASSET"],

  // CLASS 4 — COMPTES DE PASSIF CIRCULANT
  ["4", "Comptes de passif circulant", 4, "LIABILITY"],
  ["44", "Dettes du passif circulant", 4, "LIABILITY"],
  ["441", "Fournisseurs et comptes rattachés", 4, "LIABILITY"],
  ["4411", "Fournisseurs", 4, "LIABILITY"],
  ["4413", "Fournisseurs — retenues de garantie", 4, "LIABILITY"],
  ["4415", "Fournisseurs — effets à payer", 4, "LIABILITY"],
  ["4417", "RRR à accorder — avoirs à établir", 4, "LIABILITY"],
  ["442", "Clients créditeurs, avances et acomptes", 4, "LIABILITY"],
  ["443", "Personnel — créditeur", 4, "LIABILITY"],
  ["4432", "Rémunérations dues au personnel", 4, "LIABILITY"],
  ["4434", "Oppositions sur salaires", 4, "LIABILITY"],
  ["4437", "Charges du personnel à payer", 4, "LIABILITY"],
  ["444", "Organismes sociaux", 4, "LIABILITY"],
  ["4441", "Caisse nationale de sécurité sociale (CNSS)", 4, "LIABILITY"],
  ["4443", "Caisses de retraite (CIMR)", 4, "LIABILITY"],
  ["4445", "Mutuelles", 4, "LIABILITY"],
  ["445", "État — créditeur", 4, "LIABILITY"],
  ["4452", "État — impôts, taxes et assimilés", 4, "LIABILITY"],
  ["4453", "État — impôts sur les résultats", 4, "LIABILITY"],
  ["4455", "État — TVA facturée", 4, "LIABILITY"],
  ["44551", "État — TVA facturée", 4, "LIABILITY"],
  ["4456", "État — TVA due (suivant déclaration)", 4, "LIABILITY"],
  ["4457", "État — impôts et taxes à payer", 4, "LIABILITY"],
  ["4458", "État — autres comptes créditeurs", 4, "LIABILITY"],
  ["446", "Comptes d'associés — créditeurs", 4, "LIABILITY"],
  ["448", "Autres créanciers", 4, "LIABILITY"],
  ["449", "Comptes de régularisation — passif", 4, "LIABILITY"],
  ["4491", "Produits constatés d'avance", 4, "LIABILITY"],
  ["45", "Autres provisions pour risques et charges", 4, "LIABILITY"],

  // CLASS 5 — COMPTES DE TRÉSORERIE
  ["5", "Comptes de trésorerie", 5, "ASSET"],
  ["51", "Trésorerie — Actif", 5, "ASSET"],
  ["511", "Chèques et valeurs à encaisser", 5, "ASSET"],
  ["514", "Banques, trésorerie générale et chèques postaux débiteurs", 5, "ASSET"],
  ["5141", "Banques (solde débiteur)", 5, "ASSET"],
  ["5143", "Trésorerie générale", 5, "ASSET"],
  ["5146", "Chèques postaux", 5, "ASSET"],
  ["516", "Caisses, régies d'avances et accréditifs", 5, "ASSET"],
  ["5161", "Caisses", 5, "ASSET"],
  ["55", "Trésorerie — Passif", 5, "LIABILITY"],
  ["552", "Crédits d'escompte", 5, "LIABILITY"],
  ["553", "Crédits de trésorerie", 5, "LIABILITY"],
  ["554", "Banques (solde créditeur)", 5, "LIABILITY"],
  ["59", "Provisions pour dépréciation des comptes de trésorerie", 5, "ASSET"],

  // CLASS 6 — COMPTES DE CHARGES
  ["6", "Comptes de charges", 6, "EXPENSE"],
  ["61", "Charges d'exploitation", 6, "EXPENSE"],
  ["611", "Achats revendus de marchandises", 6, "EXPENSE"],
  ["6111", "Achats de marchandises", 6, "EXPENSE"],
  ["6114", "Variation des stocks de marchandises", 6, "EXPENSE"],
  ["612", "Achats consommés de matières et fournitures", 6, "EXPENSE"],
  ["6121", "Achats de matières premières", 6, "EXPENSE"],
  ["6122", "Achats de matières et fournitures consommables", 6, "EXPENSE"],
  ["6125", "Achats non stockés de matières et fournitures", 6, "EXPENSE"],
  ["6126", "Achats de travaux, études et prestations de services", 6, "EXPENSE"],
  ["6128", "Achats de matières et fournitures des exercices antérieurs", 6, "EXPENSE"],
  ["6129", "RRR obtenus sur achats consommés", 6, "EXPENSE"],
  ["613", "Autres charges externes", 6, "EXPENSE"],
  ["6131", "Locations et charges locatives", 6, "EXPENSE"],
  ["6132", "Redevances de crédit-bail", 6, "EXPENSE"],
  ["6133", "Entretien et réparations", 6, "EXPENSE"],
  ["6134", "Primes d'assurances", 6, "EXPENSE"],
  ["6135", "Rémunérations du personnel extérieur", 6, "EXPENSE"],
  ["6136", "Rémunérations d'intermédiaires et honoraires", 6, "EXPENSE"],
  ["6141", "Études, recherches et documentation", 6, "EXPENSE"],
  ["6142", "Transports", 6, "EXPENSE"],
  ["6143", "Déplacements, missions et réceptions", 6, "EXPENSE"],
  ["6144", "Publicité, publications et relations publiques", 6, "EXPENSE"],
  ["6145", "Frais postaux et frais de télécommunications", 6, "EXPENSE"],
  ["6146", "Cotisations et dons", 6, "EXPENSE"],
  ["6147", "Services bancaires", 6, "EXPENSE"],
  ["6148", "Autres charges externes des exercices antérieurs", 6, "EXPENSE"],
  ["6149", "RRR obtenus sur autres charges externes", 6, "EXPENSE"],
  ["616", "Impôts et taxes", 6, "EXPENSE"],
  ["6161", "Impôts et taxes directs", 6, "EXPENSE"],
  ["6165", "Impôts et taxes indirects", 6, "EXPENSE"],
  ["6167", "Impôts, taxes et droits assimilés", 6, "EXPENSE"],
  ["617", "Charges de personnel", 6, "EXPENSE"],
  ["6171", "Rémunérations du personnel", 6, "EXPENSE"],
  ["6174", "Charges sociales", 6, "EXPENSE"],
  ["6176", "Charges sociales diverses", 6, "EXPENSE"],
  ["6177", "Rémunérations de l'exploitant", 6, "EXPENSE"],
  ["619", "Dotations d'exploitation", 6, "EXPENSE"],
  ["6191", "DEA de l'immobilisation en non-valeurs", 6, "EXPENSE"],
  ["6192", "DEA des immobilisations incorporelles", 6, "EXPENSE"],
  ["6193", "DEA des immobilisations corporelles", 6, "EXPENSE"],
  ["6194", "Dotations d'exploitation pour provisions", 6, "EXPENSE"],
  ["6196", "Dotations d'exploitation des immob. corporelles", 6, "EXPENSE"],
  ["63", "Charges financières", 6, "EXPENSE"],
  ["631", "Charges d'intérêts", 6, "EXPENSE"],
  ["6311", "Intérêts des emprunts et dettes", 6, "EXPENSE"],
  ["633", "Pertes de change", 6, "EXPENSE"],
  ["638", "Autres charges financières", 6, "EXPENSE"],
  ["639", "Dotations financières", 6, "EXPENSE"],
  ["65", "Charges non courantes", 6, "EXPENSE"],
  ["651", "Valeurs nettes d'amortissements des immobilisations cédées", 6, "EXPENSE"],
  ["6512", "VNA des immobilisations incorporelles cédées", 6, "EXPENSE"],
  ["6513", "VNA des immobilisations corporelles cédées", 6, "EXPENSE"],
  ["656", "Subventions accordées", 6, "EXPENSE"],
  ["658", "Autres charges non courantes", 6, "EXPENSE"],
  ["659", "Dotations non courantes", 6, "EXPENSE"],
  ["67", "Impôts sur les résultats", 6, "EXPENSE"],
  ["6701", "Impôts sur les bénéfices", 6, "EXPENSE"],
  ["6705", "Imposition minimale annuelle", 6, "EXPENSE"],

  // CLASS 7 — COMPTES DE PRODUITS
  ["7", "Comptes de produits", 7, "REVENUE"],
  ["71", "Produits d'exploitation", 7, "REVENUE"],
  ["711", "Ventes de marchandises", 7, "REVENUE"],
  ["7111", "Ventes de marchandises au Maroc", 7, "REVENUE"],
  ["7113", "Ventes de marchandises à l'étranger", 7, "REVENUE"],
  ["712", "Ventes de biens et services produits", 7, "REVENUE"],
  ["7121", "Ventes de biens produits au Maroc", 7, "REVENUE"],
  ["7122", "Ventes de biens produits à l'étranger", 7, "REVENUE"],
  ["7124", "Ventes de services produits au Maroc", 7, "REVENUE"],
  ["7126", "Redevances pour brevets, marques, droits", 7, "REVENUE"],
  ["7128", "Ventes de biens et services des exercices antérieurs", 7, "REVENUE"],
  ["7129", "RRR accordés par l'entreprise", 7, "REVENUE"],
  ["713", "Variation des stocks de produits", 7, "REVENUE"],
  ["714", "Immobilisations produites par l'entreprise pour elle-même", 7, "REVENUE"],
  ["716", "Subventions d'exploitation", 7, "REVENUE"],
  ["718", "Autres produits d'exploitation", 7, "REVENUE"],
  ["7181", "Jetons de présence reçus", 7, "REVENUE"],
  ["7182", "Revenus des immeubles non affectés à l'exploitation", 7, "REVENUE"],
  ["719", "Reprises d'exploitation, transferts de charges", 7, "REVENUE"],
  ["73", "Produits financiers", 7, "REVENUE"],
  ["731", "Produits des titres de participation", 7, "REVENUE"],
  ["733", "Gains de change", 7, "REVENUE"],
  ["738", "Intérêts et autres produits financiers", 7, "REVENUE"],
  ["739", "Reprises financières, transferts de charges", 7, "REVENUE"],
  ["75", "Produits non courants", 7, "REVENUE"],
  ["751", "Produits des cessions d'immobilisations", 7, "REVENUE"],
  ["7512", "PC des immobilisations incorporelles", 7, "REVENUE"],
  ["7513", "PC des immobilisations corporelles", 7, "REVENUE"],
  ["756", "Subventions d'équilibre", 7, "REVENUE"],
  ["758", "Autres produits non courants", 7, "REVENUE"],
  ["759", "Reprises non courantes, transferts de charges", 7, "REVENUE"],
];


function findParentCode(code: string, allCodes: Set<string>): string | null {
  for (let i = code.length - 1; i >= 1; i--) {
    const candidate = code.slice(0, i);
    if (allCodes.has(candidate)) return candidate;
  }
  return null;
}

export async function seedAccountsForCompany(companyId: string) {
  const allCodes = new Set(PCGM_NORMAL.map(([code]) => code));

  const accounts = PCGM_NORMAL.map(([code, label, classNumber, accountType]) => ({
    companyId,
    code,
    label,
    classNumber,
    accountType,
    parentCode: findParentCode(code, allCodes),
    isActive: true,
    isSystem: true,
    isAuxiliary: false,
    isTiers: code === "3421" || code === "4411",
    requiresAnalytical: false,
  }));

  await prisma.account.createMany({
    data: accounts,
    skipDuplicates: true,
  });
}

export async function seedJournalsForCompany(companyId: string) {
  const journals = [
    { code: "AC", label: "Journal des Achats", type: "PURCHASES" as const },
    { code: "VT", label: "Journal des Ventes", type: "SALES" as const },
    { code: "BQ1", label: "Journal de Banque", type: "BANK" as const, defaultCounterpartAccountCode: "5141" },
    { code: "CS", label: "Journal de Caisse", type: "CASH" as const, defaultCounterpartAccountCode: "5161" },
    { code: "OD", label: "Journal des Opérations Diverses", type: "MISCELLANEOUS" as const },
    { code: "AN", label: "Journal des À Nouveaux", type: "OPENING" as const },
  ];

  await prisma.journal.createMany({
    data: journals.map((j) => ({ ...j, companyId, isSystem: true })),
    skipDuplicates: true,
  });
}

async function main() {
  console.log("🌱 Seeding database...");

  // Create default organization
  const org = await prisma.organization.upsert({
    where: { id: "default-org" },
    update: {},
    create: {
      id: "default-org",
      name: "Cabinet Fiduciaire Atlas",
      type: "FIDUCIARY",
      city: "Casablanca",
    },
  });

  const adminEmail = process.env.INITIAL_ADMIN_EMAIL || "superadmin@smartaccountingai.com";
  const adminPassword = process.env.INITIAL_ADMIN_PASSWORD || "admin123";

  if (process.env.NODE_ENV === "production" && adminPassword === "admin123") {
    console.warn("⚠️ WARNING: Seeding production with default weak password! Please set INITIAL_ADMIN_PASSWORD.");
  }

  const passwordHash = await bcrypt.hash(adminPassword, 12);
  
  // In production, only create the initial superadmin if they don't exist
  const profiles: Array<{ email: string; firstName: string; lastName: string; role: "SUPER_ADMIN" | "ADMIN" | "ACCOUNTANT" | "VIEWER" }> = [
    { email: adminEmail, firstName: "Super", lastName: "Admin", role: "SUPER_ADMIN" },
  ];

  // Only add demo profiles in non-production
  if (process.env.NODE_ENV !== "production") {
    profiles.push(
      { email: "manager@smartaccountingai.com", firstName: "Manager", lastName: "Admin", role: "ADMIN" as const },
      { email: "accountant@smartaccountingai.com", firstName: "Alice", lastName: "Accountant", role: "ACCOUNTANT" as const },
      { email: "viewer@smartaccountingai.com", firstName: "Bob", lastName: "Viewer", role: "VIEWER" as const }
    );
  }

  const users = await Promise.all(
    profiles.map((p) =>
      prisma.user.upsert({
        where: { email: p.email },
        update: {},
        create: {
          email: p.email,
          passwordHash,
          firstName: p.firstName,
          lastName: p.lastName,
          role: p.role,
          organizationId: org.id,
        },
      })
    )
  );

  // Create demo company ONLY in dev
  let companyId: string | null = null;
  if (process.env.NODE_ENV !== "production") {
    const company = await prisma.company.upsert({
      where: { id: "demo-company" },
      update: {},
      create: {
        id: "demo-company",
        organizationId: org.id,
        name: "Société Demo SARL",
        legalForm: "SARL",
        city: "Casablanca",
        chartType: "NORMAL",
        currency: "MAD",
      },
    });
    companyId = company.id;

    // Seed accounts and journals
    await seedAccountsForCompany(company.id);
    await seedJournalsForCompany(company.id);
  }

  if (companyId) {
    // Create fiscal years used by the demo accounting data
    const fiscalYears = await Promise.all(
      [2024, 2025, 2026].map((year, yearIndex) =>
        prisma.fiscalYear.upsert({
          where: { companyId_label: { companyId, label: String(year) } },
          update: {},
          create: {
            companyId,
            label: String(year),
            startDate: new Date(`${year}-01-01`),
            endDate: new Date(`${year}-12-31`),
            status: "OPEN",
            isDefault: yearIndex === 0,
          },
        })
      )
    );

    const journalByCode = await prisma.journal.findMany({
      where: { companyId },
      select: { id: true, code: true },
    });
    const journalIds = Object.fromEntries(
      journalByCode.map((journal) => [journal.code, journal.id])
    ) as Record<string, string>;
    const demoUser = users.find((user) => user.role === "SUPER_ADMIN") ?? users[0];

    if (!demoUser) {
      throw new Error("Demo user was not created.");
    }

    const demoDocuments = await prisma.document.findMany({
      where: { tenantId: companyId },
      select: { id: true },
    });
    const demoDocumentIds = demoDocuments.map((document) => document.id);

    if (demoDocumentIds.length > 0) {
      await prisma.approvalDecision.deleteMany({
        where: { documentId: { in: demoDocumentIds } },
      });
      await prisma.suggestion.deleteMany({
        where: { documentId: { in: demoDocumentIds } },
      });
      await prisma.extractedField.deleteMany({
        where: { documentId: { in: demoDocumentIds } },
      });
      await prisma.documentExtractionRun.deleteMany({
        where: { documentId: { in: demoDocumentIds } },
      });
      await prisma.document.deleteMany({
        where: { id: { in: demoDocumentIds } },
      });
    }

    await prisma.journalEntry.deleteMany({
      where: { fiscalYear: { companyId } },
    });

    const entriesPerYear = 120;
    const entries = fiscalYears.flatMap((fiscalYearData) => {
      const year = Number(fiscalYearData.label);

      return Array.from({ length: entriesPerYear }, (_, index) => {
        const sequence = index + 1;
        const month = Math.floor(index / 10) + 1;
        const day = Math.min(28, 2 + (index % 25));
        const amount = 900 + sequence * 115 + (year - 2024) * 500 + month * 25;
        const journalCode = ["AC", "VT", "BQ1"][index % 3];

        const common = {
          fiscalYearId: fiscalYearData.id,
          entryNumber: sequence,
          date: new Date(year, month - 1, day),
          reference: `E-${year}-${String(sequence).padStart(3, "0")}`,
          description: `Opération comptable ${year} - ${String(month).padStart(2, "0")}/${year} - ${sequence}`,
          piece: `PIECE-${year}-${String(sequence).padStart(3, "0")}`,
        };

        const baseAmount = Number((amount / 1.2).toFixed(2));
        const vatAmount = Number((amount - baseAmount).toFixed(2));

        if (journalCode === "AC") {
          return {
            ...common,
            journalCode: "AC",
            amount,
            lines: [
              {
                lineNumber: 1,
                accountCode: "6111",
                label: `Achats ${year} - ${String(month).padStart(2, "0")}`,
                debit: baseAmount,
              },
              {
                lineNumber: 2,
                accountCode: "34552",
                label: `TVA récupérable ${year} - ${String(month).padStart(2, "0")}`,
                debit: vatAmount,
              },
              {
                lineNumber: 3,
                accountCode: "4411",
                label: `Fournisseurs ${year} - ${String(month).padStart(2, "0")}`,
                credit: amount,
              },
            ],
          };
        }

        if (journalCode === "VT") {
          return {
            ...common,
            journalCode: "VT",
            amount,
            lines: [
              {
                lineNumber: 1,
                accountCode: "3421",
                label: `Clients ${year} - ${String(month).padStart(2, "0")}`,
                debit: amount,
              },
              {
                lineNumber: 2,
                accountCode: "7111",
                label: `Ventes ${year} - ${String(month).padStart(2, "0")}`,
                credit: baseAmount,
              },
              {
                lineNumber: 3,
                accountCode: "4455",
                label: `TVA facturée ${year} - ${String(month).padStart(2, "0")}`,
                credit: vatAmount,
              },
            ],
          };
        }

        return {
          ...common,
          journalCode: "BQ1",
          amount,
          lines: [
            {
              lineNumber: 1,
              accountCode: "6171",
              label: `Salaires ${year} - ${String(month).padStart(2, "0")}`,
              debit: amount,
            },
            {
              lineNumber: 2,
              accountCode: "5141",
              label: `Banque ${year} - ${String(month).padStart(2, "0")}`,
              credit: amount,
            },
          ],
        };
      });
    });

    await Promise.all(
      entries.map((entry) => {
        const journalId = journalIds[entry.journalCode];
        if (!journalId) {
          throw new Error(`Missing journal for seed entry code ${entry.journalCode}.`);
        }

        return prisma.journalEntry.create({
          data: {
            fiscalYearId: entry.fiscalYearId,
            journalId,
            entryNumber: entry.entryNumber,
            entryDate: entry.date,
            reference: entry.reference,
            description: entry.description,
            piece: entry.piece,
            status: "VALIDATED",
            totalDebit: entry.amount,
            totalCredit: entry.amount,
            origin: "IMPORT",
            createdById: demoUser.id,
            validatedAt: new Date(entry.date),
            lines: {
              create: entry.lines.map((line) => ({
                ...line,
                companyId,
              })),
            },
          },
        });
      })
    );

    await prisma.fixedAsset.deleteMany({
      where: { companyId },
    });

    await prisma.fixedAsset.createMany({
      data: [
        {
          companyId,
          code: "FA001",
          label: "Voiture de service - Renault Clio",
          category: "TRANSPORT",
          assetAccountCode: "2340",
          amortizationAccountCode: "2834",
          dotationAccountCode: "6193",
          acquisitionDate: new Date("2024-01-15"),
          commissioningDate: new Date("2024-01-15"),
          acquisitionValue: 150000,
          residualValue: 0,
          amortizableBase: 150000,
          usefulLifeYears: 5,
          amortizationMethod: "LINEAR",
          annualRate: 20,
          netBookValue: 150000,
        },
        {
          companyId,
          code: "FA002",
          label: "Matériel informatique - MacBook Pro",
          category: "IT_EQUIPMENT",
          assetAccountCode: "2355",
          amortizationAccountCode: "28355",
          dotationAccountCode: "6193",
          acquisitionDate: new Date("2024-03-10"),
          commissioningDate: new Date("2024-03-15"),
          acquisitionValue: 25000,
          residualValue: 0,
          amortizableBase: 25000,
          usefulLifeYears: 4,
          amortizationMethod: "LINEAR",
          annualRate: 25,
          netBookValue: 25000,
        },
        {
          companyId,
          code: "FA003",
          label: "Mobilier de bureau - Pack complet",
          category: "FURNITURE",
          assetAccountCode: "2351",
          amortizationAccountCode: "2835",
          dotationAccountCode: "6193",
          acquisitionDate: new Date("2024-02-01"),
          commissioningDate: new Date("2024-02-05"),
          acquisitionValue: 45000,
          residualValue: 0,
          amortizableBase: 45000,
          usefulLifeYears: 10,
          amortizationMethod: "LINEAR",
          annualRate: 10,
          netBookValue: 45000,
        }
      ],
      skipDuplicates: true,
    });

    // Give all users access to the demo company
    await Promise.all(
      users.map((u) =>
        prisma.userCompanyAccess.upsert({
          where: { userId_companyId: { userId: u.id, companyId: companyId! } },
          update: {},
          create: {
            userId: u.id,
            companyId: companyId!,
            canAccessSetup: u.role === "SUPER_ADMIN" || u.role === "ADMIN",
            canAccessEntries: true,
            canAccessVAT: u.role !== "VIEWER",
            canAccessFixedAssets: u.role !== "VIEWER",
            canAccessAnalytical: u.role !== "VIEWER",
            canAccessTaxPackage: u.role === "SUPER_ADMIN" || u.role === "ADMIN",
            canAccessReports: true,
            canAccessUserManagement: u.role === "SUPER_ADMIN",
            canValidateEntries: u.role === "SUPER_ADMIN" || u.role === "ADMIN",
            canDeleteDraftEntries: u.role !== "VIEWER",
            canCloseExercise: u.role === "SUPER_ADMIN" || u.role === "ADMIN",
            canImportData: u.role !== "VIEWER",
            canExportData: true,
          },
        })
      )
    );
  }

  console.log("✅ Seed complete!");
  console.log(`   Initial Admin: ${adminEmail} (password: ${process.env.INITIAL_ADMIN_PASSWORD ? "****" : "admin123"})`);
}

if (require.main === module || (process.argv[1]?.includes('seed.ts') && !process.argv[1]?.includes('seed-qa.ts'))) {
  main()
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
