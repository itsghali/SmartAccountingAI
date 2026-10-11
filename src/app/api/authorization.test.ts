import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";
import { checkPermission } from "@/server/permissions";

// Route handlers
import { GET as getEntry, PUT as putEntry, DELETE as deleteEntry } from "@/app/api/entries/[id]/route";
import { POST as postFixedAsset } from "@/app/api/fixed-assets/route";
import { GET as getFixedAsset } from "@/app/api/fixed-assets/[id]/route";
import { PUT as putVAT } from "@/app/api/vat/[id]/route";
import { GET as getReconciliation, POST as postReconciliation, DELETE as deleteReconciliation } from "@/app/api/reconciliation/route";
import { GET as getAgedBalance } from "@/app/api/reports/aged-balance/route";
import { GET as getFinancialStatements } from "@/app/api/reports/financial-statements/route";
import { GET as getVATStatements } from "@/app/api/reports/vat-statements/route";
import { GET as getCompany, DELETE as deleteCompany } from "@/app/api/companies/[id]/route";
import { GET as getDocumentFile } from "@/app/api/documents/[id]/file/route";
import { GET as getEntryProposal, POST as postEntryProposal } from "@/app/api/documents/[id]/entry-proposal/route";
import { GET as getTaxDetermination, POST as postTaxDetermination } from "@/app/api/documents/[id]/tax-determination/route";

vi.mock("@/server/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/server/permissions", () => ({
  checkPermission: vi.fn(),
}));

vi.mock("@/server/calculations/vatSync", () => ({
  syncVATDeclarationForDate: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/server/storage", () => ({
  readPrivateFile: vi.fn().mockResolvedValue(Buffer.from("dummy-file-content")),
}));

vi.mock("@/server/accounting-entry-preparer/service", () => ({
  generateDocumentEntryProposal: vi.fn().mockResolvedValue({ id: "prop-1" }),
  getCurrentDocumentEntryProposal: vi.fn().mockResolvedValue({ id: "prop-1" }),
}));

vi.mock("@/server/tax-support/service", () => ({
  generateDocumentTaxDetermination: vi.fn().mockResolvedValue({ id: "tax-1" }),
  getCurrentDocumentTaxDetermination: vi.fn().mockResolvedValue({ id: "tax-1" }),
}));

vi.mock("@/server/prisma", () => ({
  prisma: {
    journalEntry: {
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    journalEntryLine: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
    },
    journal: {
      findUnique: vi.fn(),
    },
    fixedAsset: {
      create: vi.fn(),
      findUnique: vi.fn(),
    },
    vATDeclaration: {
      findUnique: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
    },
    lettrageGroup: {
      findMany: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
    company: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      delete: vi.fn(),
    },
    document: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(async (callbackOrArray) => {
      if (typeof callbackOrArray === "function") {
        return callbackOrArray(prisma);
      }
      return Promise.all(callbackOrArray);
    }),
  },
}));

describe("API Routes RBAC & Tenant Isolation Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Entries by ID (/api/entries/[id])", () => {
    it("returns 401 when unauthenticated", async () => {
      vi.mocked(auth).mockResolvedValue(null as never);

      const req = new NextRequest("http://localhost/api/entries/entry-1");
      const res = await getEntry(req, { params: Promise.resolve({ id: "entry-1" }) });

      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toBe("Non autorisé");
    });

    it("returns 403 on GET when user lacks canAccessEntries or on cross-tenant IDOR attempt", async () => {
      vi.mocked(auth).mockResolvedValue({
        user: { id: "user-1", organizationId: "org-1", role: "ACCOUNTANT" },
      } as never);

      vi.mocked(prisma.journalEntry.findUnique).mockResolvedValue({
        id: "entry-1",
        journal: { companyId: "comp-target" },
      } as never);
      vi.mocked(checkPermission).mockResolvedValue(false);

      const req = new NextRequest("http://localhost/api/entries/entry-1");
      const res = await getEntry(req, { params: Promise.resolve({ id: "entry-1" }) });

      expect(res.status).toBe(403);
      expect(checkPermission).toHaveBeenCalledWith("comp-target", "canAccessEntries");
    });

    it("returns 200 on GET when user is authorized", async () => {
      vi.mocked(auth).mockResolvedValue({
        user: { id: "user-1", organizationId: "org-1", role: "ACCOUNTANT" },
      } as never);

      vi.mocked(prisma.journalEntry.findUnique).mockResolvedValue({
        id: "entry-1",
        journal: { companyId: "comp-1" },
        lines: [],
      } as never);
      vi.mocked(checkPermission).mockResolvedValue(true);

      const req = new NextRequest("http://localhost/api/entries/entry-1");
      const res = await getEntry(req, { params: Promise.resolve({ id: "entry-1" }) });

      expect(res.status).toBe(200);
    });

    it("returns 403 on PUT validate when user lacks canValidateEntries", async () => {
      vi.mocked(auth).mockResolvedValue({
        user: { id: "user-1", organizationId: "org-1", role: "ACCOUNTANT" },
      } as never);

      vi.mocked(prisma.journalEntry.findUnique).mockResolvedValue({
        id: "entry-1",
        status: "DRAFT",
        journal: { companyId: "comp-1" },
      } as never);
      vi.mocked(checkPermission).mockResolvedValue(false);

      const req = new NextRequest("http://localhost/api/entries/entry-1", {
        method: "PUT",
        body: JSON.stringify({ action: "validate" }),
      });
      const res = await putEntry(req, { params: Promise.resolve({ id: "entry-1" }) });

      expect(res.status).toBe(403);
      expect(checkPermission).toHaveBeenCalledWith("comp-1", "canValidateEntries");
    });

    it("returns 200 on PUT validate when user possesses canValidateEntries", async () => {
      vi.mocked(auth).mockResolvedValue({
        user: { id: "user-1", organizationId: "org-1", role: "ACCOUNTANT" },
      } as never);

      vi.mocked(prisma.journalEntry.findUnique).mockResolvedValue({
        id: "entry-1",
        status: "DRAFT",
        journal: { companyId: "comp-1" },
      } as never);
      vi.mocked(checkPermission).mockResolvedValue(true);
      vi.mocked(prisma.journalEntry.update).mockResolvedValue({
        id: "entry-1",
        status: "VALIDATED",
        journal: { companyId: "comp-1" },
        fiscalYearId: "fy-1",
        entryDate: new Date(),
      } as never);

      const req = new NextRequest("http://localhost/api/entries/entry-1", {
        method: "PUT",
        body: JSON.stringify({ action: "validate" }),
      });
      const res = await putEntry(req, { params: Promise.resolve({ id: "entry-1" }) });

      expect(res.status).toBe(200);
    });

    it("returns 403 on DELETE draft when user lacks canDeleteDraftEntries", async () => {
      vi.mocked(auth).mockResolvedValue({
        user: { id: "user-1", organizationId: "org-1", role: "ACCOUNTANT" },
      } as never);

      vi.mocked(prisma.journalEntry.findUnique).mockResolvedValue({
        id: "entry-1",
        status: "DRAFT",
        journal: { companyId: "comp-1" },
      } as never);
      vi.mocked(checkPermission).mockResolvedValue(false);

      const req = new NextRequest("http://localhost/api/entries/entry-1", { method: "DELETE" });
      const res = await deleteEntry(req, { params: Promise.resolve({ id: "entry-1" }) });

      expect(res.status).toBe(403);
      expect(checkPermission).toHaveBeenCalledWith("comp-1", "canDeleteDraftEntries");
    });

    it("returns 200 on DELETE draft when user possesses canDeleteDraftEntries", async () => {
      vi.mocked(auth).mockResolvedValue({
        user: { id: "user-1", organizationId: "org-1", role: "ACCOUNTANT" },
      } as never);

      vi.mocked(prisma.journalEntry.findUnique).mockResolvedValue({
        id: "entry-1",
        status: "DRAFT",
        journal: { companyId: "comp-1" },
      } as never);
      vi.mocked(checkPermission).mockResolvedValue(true);
      vi.mocked(prisma.journalEntry.delete).mockResolvedValue({ id: "entry-1" } as never);

      const req = new NextRequest("http://localhost/api/entries/entry-1", { method: "DELETE" });
      const res = await deleteEntry(req, { params: Promise.resolve({ id: "entry-1" }) });

      expect(res.status).toBe(200);
      expect(prisma.journalEntry.delete).toHaveBeenCalledWith({ where: { id: "entry-1" } });
    });
  });

  describe("Fixed Assets Authorization (/api/fixed-assets)", () => {
    it("returns 403 on POST fixed asset when user lacks canAccessFixedAssets", async () => {
      vi.mocked(auth).mockResolvedValue({
        user: { id: "user-1", organizationId: "org-1", role: "ACCOUNTANT" },
      } as never);
      vi.mocked(checkPermission).mockResolvedValue(false);

      const req = new NextRequest("http://localhost/api/fixed-assets", {
        method: "POST",
        body: JSON.stringify({
          companyId: "comp-1",
          code: "IMM-001",
          label: "Ordinateur",
          category: "IT_EQUIPMENT",
          assetAccountCode: "2355",
          amortizationAccountCode: "28355",
          dotationAccountCode: "6193",
          acquisitionDate: "2024-01-01",
          commissioningDate: "2024-01-01",
          acquisitionValue: 10000,
          usefulLifeYears: 5,
          amortizationMethod: "LINEAR",
        }),
      });

      const res = await postFixedAsset(req);
      expect(res.status).toBe(403);
      expect(checkPermission).toHaveBeenCalledWith("comp-1", "canAccessFixedAssets");
    });

    it("returns 201 on POST fixed asset when authorized", async () => {
      vi.mocked(auth).mockResolvedValue({
        user: { id: "user-1", organizationId: "org-1", role: "ACCOUNTANT" },
      } as never);
      vi.mocked(checkPermission).mockResolvedValue(true);
      vi.mocked(prisma.fixedAsset.create).mockResolvedValue({
        id: "fa-1",
        code: "IMM-001",
      } as never);

      const req = new NextRequest("http://localhost/api/fixed-assets", {
        method: "POST",
        body: JSON.stringify({
          companyId: "comp-1",
          code: "IMM-001",
          label: "Ordinateur",
          category: "IT_EQUIPMENT",
          assetAccountCode: "2355",
          amortizationAccountCode: "28355",
          dotationAccountCode: "6193",
          acquisitionDate: "2024-01-01",
          commissioningDate: "2024-01-01",
          acquisitionValue: 10000,
          usefulLifeYears: 5,
          amortizationMethod: "LINEAR",
        }),
      });

      const res = await postFixedAsset(req);
      expect(res.status).toBe(201);
    });

    it("returns 403 on GET fixed asset by ID when lacking permissions or cross-tenant", async () => {
      vi.mocked(auth).mockResolvedValue({
        user: { id: "user-1", organizationId: "org-1", role: "ACCOUNTANT" },
      } as never);
      vi.mocked(prisma.fixedAsset.findUnique).mockResolvedValue({
        id: "fa-1",
        companyId: "comp-victim",
      } as never);
      vi.mocked(checkPermission).mockResolvedValue(false);

      const req = new NextRequest("http://localhost/api/fixed-assets/fa-1");
      const res = await getFixedAsset(req, { params: Promise.resolve({ id: "fa-1" }) });

      expect(res.status).toBe(403);
    });
  });

  describe("VAT by ID (/api/vat/[id])", () => {
    it("returns 403 on PUT VAT declaration when lacking canAccessVAT or cross-tenant", async () => {
      vi.mocked(auth).mockResolvedValue({
        user: { id: "user-1", organizationId: "org-1", role: "ACCOUNTANT" },
      } as never);
      vi.mocked(prisma.vATDeclaration.findUnique).mockResolvedValue({
        id: "vat-1",
        companyId: "comp-victim",
      } as never);
      vi.mocked(checkPermission).mockResolvedValue(false);

      const req = new NextRequest("http://localhost/api/vat/vat-1", {
        method: "PUT",
        body: JSON.stringify({ action: "validate" }),
      });
      const res = await putVAT(req, { params: Promise.resolve({ id: "vat-1" }) });

      expect(res.status).toBe(403);
      expect(checkPermission).toHaveBeenCalledWith("comp-victim", "canAccessVAT");
    });
  });

  describe("Reconciliation (/api/reconciliation)", () => {
    it("returns 403 on GET reconciliation when lacking canAccessEntries", async () => {
      vi.mocked(auth).mockResolvedValue({
        user: { id: "user-1", organizationId: "org-1", role: "ACCOUNTANT" },
      } as never);
      vi.mocked(checkPermission).mockResolvedValue(false);

      const req = new NextRequest("http://localhost/api/reconciliation?companyId=comp-1&fiscalYearId=fy-1&accountCode=3421");
      const res = await getReconciliation(req);

      expect(res.status).toBe(403);
      expect(checkPermission).toHaveBeenCalledWith("comp-1", "canAccessEntries");
    });

    it("returns 403 on POST reconciliation when lacking canAccessEntries", async () => {
      vi.mocked(auth).mockResolvedValue({
        user: { id: "user-1", organizationId: "org-1", role: "ACCOUNTANT" },
      } as never);
      vi.mocked(checkPermission).mockResolvedValue(false);

      const req = new NextRequest("http://localhost/api/reconciliation", {
        method: "POST",
        body: JSON.stringify({
          companyId: "comp-1",
          fiscalYearId: "fy-1",
          accountCode: "3421",
          lineIds: ["line-1", "line-2"],
        }),
      });
      const res = await postReconciliation(req);

      expect(res.status).toBe(403);
    });

    it("returns 403 on DELETE reconciliation when lacking canAccessEntries", async () => {
      vi.mocked(auth).mockResolvedValue({
        user: { id: "user-1", organizationId: "org-1", role: "ACCOUNTANT" },
      } as never);
      vi.mocked(checkPermission).mockResolvedValue(false);

      const req = new NextRequest("http://localhost/api/reconciliation?companyId=comp-1&fiscalYearId=fy-1&accountCode=3421&lettrageCode=A", {
        method: "DELETE",
      });
      const res = await deleteReconciliation(req);

      expect(res.status).toBe(403);
    });
  });

  describe("Reports Authorization", () => {
    it("returns 403 on aged-balance report when lacking canAccessReports", async () => {
      vi.mocked(auth).mockResolvedValue({
        user: { id: "user-1", organizationId: "org-1", role: "ACCOUNTANT" },
      } as never);
      vi.mocked(checkPermission).mockResolvedValue(false);

      const req = new NextRequest("http://localhost/api/reports/aged-balance?companyId=comp-1&fiscalYearId=fy-1");
      const res = await getAgedBalance(req);

      expect(res.status).toBe(403);
      expect(checkPermission).toHaveBeenCalledWith("comp-1", "canAccessReports");
    });

    it("returns 403 on financial-statements report when lacking canAccessReports", async () => {
      vi.mocked(auth).mockResolvedValue({
        user: { id: "user-1", organizationId: "org-1", role: "ACCOUNTANT" },
      } as never);
      vi.mocked(checkPermission).mockResolvedValue(false);

      const req = new NextRequest("http://localhost/api/reports/financial-statements?companyId=comp-1&fiscalYearId=fy-1");
      const res = await getFinancialStatements(req);

      expect(res.status).toBe(403);
      expect(checkPermission).toHaveBeenCalledWith("comp-1", "canAccessReports");
    });

    it("returns 403 on vat-statements report when lacking canAccessReports", async () => {
      vi.mocked(auth).mockResolvedValue({
        user: { id: "user-1", organizationId: "org-1", role: "ACCOUNTANT" },
      } as never);
      vi.mocked(checkPermission).mockResolvedValue(false);

      const req = new NextRequest("http://localhost/api/reports/vat-statements?companyId=comp-1&fiscalYearId=fy-1");
      const res = await getVATStatements(req);

      expect(res.status).toBe(403);
      expect(checkPermission).toHaveBeenCalledWith("comp-1", "canAccessReports");
    });
  });

  describe("Companies RBAC (/api/companies/[id])", () => {
    it("returns 403 on DELETE company when requester is not an ADMIN or SUPER_ADMIN", async () => {
      vi.mocked(auth).mockResolvedValue({
        user: { id: "user-1", organizationId: "org-1", role: "ACCOUNTANT" },
      } as never);

      const req = new NextRequest("http://localhost/api/companies/comp-1", { method: "DELETE" });
      const res = await deleteCompany(req, { params: Promise.resolve({ id: "comp-1" }) });

      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toContain("Only admins can delete companies");
    });

    it("returns 403 on GET company when user has no access record for that company", async () => {
      vi.mocked(auth).mockResolvedValue({
        user: { id: "user-1", organizationId: "org-1", role: "ACCOUNTANT" },
      } as never);
      vi.mocked(prisma.company.findUnique).mockResolvedValue({
        id: "comp-1",
        organizationId: "org-1",
      } as never);
      vi.mocked(checkPermission).mockResolvedValue(false);

      const req = new NextRequest("http://localhost/api/companies/comp-1");
      const res = await getCompany(req, { params: Promise.resolve({ id: "comp-1" }) });

      expect(res.status).toBe(403);
      expect(checkPermission).toHaveBeenCalledWith("comp-1");
    });
  });

  describe("Documents File Download (/api/documents/[id]/file)", () => {
    it("returns 403 on document file download when user lacks canAccessEntries", async () => {
      vi.mocked(auth).mockResolvedValue({
        user: { id: "user-1", organizationId: "org-1", role: "VIEWER" },
      } as never);
      vi.mocked(prisma.document.findUnique).mockResolvedValue({
        id: "doc-1",
        tenantId: "comp-1",
        storagePath: "/path/to/file",
        mimeType: "application/pdf",
        originalFilename: "facture.pdf",
      } as never);
      vi.mocked(prisma.company.findFirst).mockResolvedValue({ id: "comp-1" } as never);
      vi.mocked(checkPermission).mockResolvedValue(false);

      const req = new NextRequest("http://localhost/api/documents/doc-1/file");
      const res = await getDocumentFile(req, { params: Promise.resolve({ id: "doc-1" }) });

      expect(res.status).toBe(403);
      expect(checkPermission).toHaveBeenCalledWith("comp-1", "canAccessEntries");
    });
  });

  describe("Document Entry Proposal Authorization (/api/documents/[id]/entry-proposal)", () => {
    it("returns 403 on GET entry proposal when lacking canAccessEntries", async () => {
      vi.mocked(auth).mockResolvedValue({
        user: { id: "user-1", organizationId: "org-1", role: "VIEWER" },
      } as never);
      vi.mocked(prisma.document.findUnique).mockResolvedValue({
        id: "doc-1",
        tenantId: "comp-1",
      } as never);
      vi.mocked(checkPermission).mockResolvedValue(false);

      const req = new NextRequest("http://localhost/api/documents/doc-1/entry-proposal");
      const res = await getEntryProposal(req, { params: Promise.resolve({ id: "doc-1" }) });

      expect(res.status).toBe(403);
      expect(checkPermission).toHaveBeenCalledWith("comp-1", "canAccessEntries");
    });

    it("returns 403 on POST entry proposal when lacking canAccessEntries", async () => {
      vi.mocked(auth).mockResolvedValue({
        user: { id: "user-1", organizationId: "org-1", role: "VIEWER" },
      } as never);
      vi.mocked(prisma.document.findUnique).mockResolvedValue({
        id: "doc-1",
        tenantId: "comp-1",
      } as never);
      vi.mocked(checkPermission).mockResolvedValue(false);

      const req = new NextRequest("http://localhost/api/documents/doc-1/entry-proposal", {
        method: "POST",
        body: JSON.stringify({}),
      });
      const res = await postEntryProposal(req, { params: Promise.resolve({ id: "doc-1" }) });

      expect(res.status).toBe(403);
      expect(checkPermission).toHaveBeenCalledWith("comp-1", "canAccessEntries");
    });
  });

  describe("Document Tax Determination Authorization (/api/documents/[id]/tax-determination)", () => {
    it("returns 403 on GET tax determination when lacking canAccessVAT", async () => {
      vi.mocked(auth).mockResolvedValue({
        user: { id: "user-1", organizationId: "org-1", role: "ACCOUNTANT" },
      } as never);
      vi.mocked(prisma.document.findUnique).mockResolvedValue({
        id: "doc-1",
        tenantId: "comp-1",
      } as never);
      vi.mocked(checkPermission).mockResolvedValue(false);

      const req = new NextRequest("http://localhost/api/documents/doc-1/tax-determination");
      const res = await getTaxDetermination(req, { params: Promise.resolve({ id: "doc-1" }) });

      expect(res.status).toBe(403);
      expect(checkPermission).toHaveBeenCalledWith("comp-1", "canAccessVAT");
    });

    it("returns 403 on POST tax determination when lacking canAccessVAT", async () => {
      vi.mocked(auth).mockResolvedValue({
        user: { id: "user-1", organizationId: "org-1", role: "ACCOUNTANT" },
      } as never);
      vi.mocked(prisma.document.findUnique).mockResolvedValue({
        id: "doc-1",
        tenantId: "comp-1",
      } as never);
      vi.mocked(checkPermission).mockResolvedValue(false);

      const req = new NextRequest("http://localhost/api/documents/doc-1/tax-determination", {
        method: "POST",
      });
      const res = await postTaxDetermination(req, { params: Promise.resolve({ id: "doc-1" }) });

      expect(res.status).toBe(403);
      expect(checkPermission).toHaveBeenCalledWith("comp-1", "canAccessVAT");
    });
  });
});
