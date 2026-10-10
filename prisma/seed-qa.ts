import "dotenv/config";
import bcrypt from "bcryptjs";
import { prisma } from "../src/server/prisma";
import { seedAccountsForCompany, seedJournalsForCompany } from "./seed";

async function main() {
  console.log("🌱 Seeding QA Database for Agentic Explorer...");

  // Create QA Organization
  const org = await prisma.organization.upsert({
    where: { id: "qa-org" },
    update: {},
    create: {
      id: "qa-org",
      name: "QA Testing Organization",
      type: "FIDUCIARY",
      city: "Paris",
    },
  });

  const passwordHash = await bcrypt.hash("Test@1234!", 12);

  // Users to create
  const profiles = [
    { email: "qa-admin-a@example.com", firstName: "Admin", lastName: "A", role: "SUPER_ADMIN" as const },
    { email: "qa-manager-a@example.com", firstName: "Manager", lastName: "A", role: "ADMIN" as const },
    { email: "qa-collab-a@example.com", firstName: "Collab", lastName: "A", role: "ACCOUNTANT" as const },
    { email: "qa-admin-b@example.com", firstName: "Admin", lastName: "B", role: "SUPER_ADMIN" as const },
    { email: "qa-collab-b@example.com", firstName: "Collab", lastName: "B", role: "ACCOUNTANT" as const },
  ];

  const createdUsers = await Promise.all(
    profiles.map((p) =>
      prisma.user.upsert({
        where: { email: p.email },
        update: { role: p.role, passwordHash },
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

  // Companies
  const companiesData = [
    { id: "qa-company-a", name: "Entreprise A (QA)", users: ["qa-admin-a", "qa-manager-a", "qa-collab-a"] },
    { id: "qa-company-b", name: "Entreprise B (QA)", users: ["qa-admin-b", "qa-collab-b"] },
  ];

  for (const cData of companiesData) {
    const company = await prisma.company.upsert({
      where: { id: cData.id },
      update: {},
      create: {
        id: cData.id,
        organizationId: org.id,
        name: cData.name,
        legalForm: "SARL",
        city: "Paris",
        chartType: "NORMAL",
        currency: "EUR",
      },
    });

    await seedAccountsForCompany(company.id);
    await seedJournalsForCompany(company.id);

    // Create Fiscal Year
    const fiscalYear = await prisma.fiscalYear.upsert({
      where: { companyId_label: { companyId: company.id, label: "2026" } },
      update: {},
      create: {
        companyId: company.id,
        label: "2026",
        startDate: new Date("2026-01-01"),
        endDate: new Date("2026-12-31"),
        status: "OPEN",
        isDefault: true,
      },
    });

    // Create a dummy entry to ensure journals and fiscal year are properly used
    const journalByCode = await prisma.journal.findMany({
      where: { companyId: company.id },
      select: { id: true, code: true },
    });
    const odJournal = journalByCode.find(j => j.code === "OD");
    
    if (odJournal) {
      // Avoid duplicate entry if already seeded
      const existingEntry = await prisma.journalEntry.findFirst({
        where: { fiscalYearId: fiscalYear!.id, journalId: odJournal!.id, reference: "QA-SEED-1" }
      });
      if (!existingEntry) {
        await prisma.journalEntry.create({
          data: {
            fiscalYearId: fiscalYear.id,
            journalId: odJournal.id,
            entryNumber: 1,
            entryDate: new Date("2026-06-15"),
            reference: "QA-SEED-1",
            description: "Ecriture fictive d'initialisation QA",
            piece: "QA-001",
            status: "VALIDATED",
            totalDebit: 1000,
            totalCredit: 1000,
            origin: "IMPORT",
            createdById: createdUsers[0]!.id,
            validatedAt: new Date("2026-06-15"),
            lines: {
              create: [
                { lineNumber: 1, accountCode: "6133", label: "Frais QA", debit: 1000, companyId: company.id },
                { lineNumber: 2, accountCode: "5141", label: "Banque QA", credit: 1000, companyId: company.id }
              ]
            }
          }
        });
      }
    }

    // Assign Users to Company
    const companyUsers = createdUsers.filter(u => cData.users.some(prefix => u.email.startsWith(prefix)));
    for (const u of companyUsers) {
      await prisma.userCompanyAccess.upsert({
        where: { userId_companyId: { userId: u.id, companyId: company.id } },
        update: {},
        create: {
          userId: u.id,
          companyId: company.id,
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
      });
    }
  }

  console.log("✅ QA Seeding complete!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
