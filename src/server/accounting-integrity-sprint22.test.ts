import { describe, it, expect, vi, beforeEach } from "vitest";
import Decimal from "decimal.js";
import { computeTrialBalance } from "@/server/calculations/balance";
import { computeVATDeclaration } from "@/server/calculations/vat";
import { POST as postAmortization } from "@/app/api/fixed-assets/amortization/route";
import { POST as postReconciliation, GET as getReconciliation } from "@/app/api/reconciliation/route";
import { prisma } from "@/server/prisma";
import { auth } from "@/server/auth";
import { checkPermission } from "@/server/permissions";
import { NextRequest } from "next/server";

vi.mock("@/server/prisma", () => ({
  prisma: {
    journalEntryLine: {
      groupBy: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
    },
    company: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    userCompanyAccess: {
      findUnique: vi.fn(),
    },
    account: {
      findMany: vi.fn(),
    },
    journalEntry: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
    },
    journal: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    fiscalYear: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    fixedAsset: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    fixedAssetAmortization: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    lettrageGroup: {
      findMany: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    vATDeclaration: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    idempotencyKey: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
    $queryRaw: vi.fn().mockResolvedValue([]),
    $transaction: vi.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma)),
  },
}));

vi.mock("@/server/calculations/vatSync", () => ({
  syncVATDeclarationForDate: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/server/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/server/permissions", () => ({
  checkPermission: vi.fn(),
}));

vi.mock("@/server/rate-limit", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ success: true }),
  createRateLimitResponse: vi.fn(),
}));

describe("Sprint 2.2-A Accounting Integrity Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({
      user: { id: "user-1", organizationId: "org-1", role: "ADMIN", email: "user@example.com", name: "User" },
      expires: "",
    } as never);
    vi.mocked(checkPermission).mockResolvedValue(true);
  });

  describe("1. Reversal & Financial Reports Integrity", () => {
    it("ensures computeTrialBalance includes VALIDATED and REVERSED, and excludes PRIOR_YEAR_COPY by default", async () => {
      const mockBothEntriesGrouped = [
        {
          accountCode: "6111",
          companyId: "comp-1",
          _sum: { debit: new Decimal(1000), credit: new Decimal(1000) },
        },
        {
          accountCode: "4411",
          companyId: "comp-1",
          _sum: { debit: new Decimal(1000), credit: new Decimal(1000) },
        },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ] as any;

      vi.mocked(prisma.journalEntryLine.groupBy).mockResolvedValue(mockBothEntriesGrouped);
      vi.mocked(prisma.account.findMany).mockResolvedValue([
        { code: "6111", label: "Achats", classNumber: 6 },
        { code: "4411", label: "Fournisseurs", classNumber: 4 },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ] as any);

      const result = await computeTrialBalance("comp-1", "fy-1");

      const lastCall = vi.mocked(prisma.journalEntryLine.groupBy).mock.calls[0]?.[0];
      const statusCondition = lastCall?.where?.journalEntry?.status;
      const notCondition = lastCall?.where?.journalEntry?.NOT;

      // Status must include both VALIDATED and REVERSED
      expect(statusCondition).toEqual({ in: ["VALIDATED", "REVERSED"] });
      // PRIOR_YEAR_COPY must be excluded by default
      expect(notCondition).toEqual({ sourceModule: "PRIOR_YEAR_COPY" });

      // Check account balances net out to zero
      const expense = result.accounts.find((a) => a.accountCode === "6111");
      expect(expense?.soldeDebit.toNumber()).toBe(0);
      expect(expense?.soldeCredit.toNumber()).toBe(0);

      const supplier = result.accounts.find((a) => a.accountCode === "4411");
      expect(supplier?.soldeDebit.toNumber()).toBe(0);
      expect(supplier?.soldeCredit.toNumber()).toBe(0);
    });

    it("ensures computeTrialBalance isolates DRAFT entries when statusFilter is DRAFT", async () => {
      vi.mocked(prisma.journalEntryLine.groupBy).mockResolvedValue([]);
      vi.mocked(prisma.account.findMany).mockResolvedValue([]);

      await computeTrialBalance("comp-1", "fy-1", undefined, undefined, "DRAFT");

      const lastCall = vi.mocked(prisma.journalEntryLine.groupBy).mock.calls[0]?.[0];
      expect(lastCall?.where?.journalEntry?.status).toBe("DRAFT");
    });

    it("ensures computeVATDeclaration includes VALIDATED and REVERSED, and excludes PRIOR_YEAR_COPY", async () => {
      vi.mocked(prisma.account.findMany).mockResolvedValue([
        { code: "4455", vatType: "VAT_COLLECTED", vatRate: new Decimal(20) },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ] as any);

      vi.mocked(prisma.journalEntryLine.groupBy).mockResolvedValue([]);

      await computeVATDeclaration("comp-1", "fy-1", new Date("2024-01-01"), new Date("2024-01-31"));

      const lastCall = vi.mocked(prisma.journalEntryLine.groupBy).mock.calls[0]?.[0];
      expect(lastCall?.where?.journalEntry?.status).toEqual({ in: ["VALIDATED", "REVERSED"] });
      expect(lastCall?.where?.journalEntry?.NOT).toEqual({ sourceModule: "PRIOR_YEAR_COPY" });
    });
  });

  describe("2. Fixed-Asset Amortization Fail-Closed Protection", () => {
    it("aborts the entire transaction with 400 when MISCELLANEOUS journal is missing, preventing partial updates", async () => {
      vi.mocked(prisma.fiscalYear.findUnique).mockResolvedValue({
        id: "fy-1",
        companyId: "comp-1",
        status: "OPEN",
        startDate: new Date("2024-01-01"),
        endDate: new Date("2024-12-31"),
      } as never);

      // Active asset requiring amortization
      vi.mocked(prisma.fixedAsset.findMany).mockResolvedValue([
        {
          id: "asset-1",
          code: "IMM-001",
          label: "Ordinateur",
          companyId: "comp-1",
          status: "ACTIVE",
          acquisitionValue: new Decimal(12000),
          residualValue: new Decimal(0),
          commissioningDate: new Date("2024-01-01"),
          usefulLifeYears: 3,
          amortizationMethod: "LINEAR",
          dotationAccountCode: "6193",
          amortizationAccountCode: "2833",
        },
      ] as never);

      // No posted amortization yet
      vi.mocked(prisma.fixedAssetAmortization.findFirst).mockResolvedValue(null);

      // MISCELLANEOUS journal is MISSING
      vi.mocked(prisma.journal.findFirst).mockResolvedValue(null);

      const req = new NextRequest("http://localhost:3000/api/fixed-assets/amortization", {
        method: "POST",
        body: JSON.stringify({ companyId: "comp-1", fiscalYearId: "fy-1" }),
      });

      const res = await postAmortization(req);
      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body.error).toContain("MISCELLANEOUS");

      // Verify that no ledger entry was created
      expect(prisma.journalEntry.create).not.toHaveBeenCalled();
    });
  });

  describe("3. Reconciliation Server-Side Restriction to Validated Entries", () => {
    it("GET /api/reconciliation queries only VALIDATED entries", async () => {
      vi.mocked(prisma.journalEntryLine.findMany).mockResolvedValue([]);

      const req = new NextRequest(
        "http://localhost:3000/api/reconciliation?companyId=comp-1&fiscalYearId=fy-1&accountCode=3421"
      );

      const res = await getReconciliation(req);
      expect(res.status).toBe(200);

      const lastCall = vi.mocked(prisma.journalEntryLine.findMany).mock.calls[0]?.[0];
      expect(lastCall?.where?.journalEntry?.status).toBe("VALIDATED");
    });

    it("POST /api/reconciliation rejects lines from DRAFT entries with 400 error", async () => {
      vi.mocked(prisma.fiscalYear.findUnique).mockResolvedValue({
        id: "fy-1",
        companyId: "comp-1",
        status: "OPEN",
        startDate: new Date("2024-01-01"),
        endDate: new Date("2024-12-31"),
      } as never);

      // Line 1 is VALIDATED, but Line 2 is DRAFT!
      vi.mocked(prisma.journalEntryLine.findMany).mockResolvedValue([
        {
          id: "line-1",
          companyId: "comp-1",
          accountCode: "3421",
          debit: new Decimal(100),
          credit: new Decimal(0),
          isLettered: false,
          journalEntry: { id: "entry-1", status: "VALIDATED", entryNumber: 1 },
        },
        {
          id: "line-2",
          companyId: "comp-1",
          accountCode: "3421",
          debit: new Decimal(0),
          credit: new Decimal(100),
          isLettered: false,
          journalEntry: { id: "entry-2", status: "DRAFT", entryNumber: 2 },
        },
      ] as never);

      const req = new NextRequest("http://localhost:3000/api/reconciliation", {
        method: "POST",
        body: JSON.stringify({
          companyId: "comp-1",
          fiscalYearId: "fy-1",
          accountCode: "3421",
          lineIds: ["line-1", "line-2"],
        }),
      });

      const res = await postReconciliation(req);
      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body.error).toContain("validées");

      // Verify that lettrageGroup was NOT created
      expect(prisma.lettrageGroup.create).not.toHaveBeenCalled();
      expect(prisma.journalEntryLine.updateMany).not.toHaveBeenCalled();
    });

    it("POST /api/reconciliation succeeds when all lines belong to VALIDATED entries", async () => {
      vi.mocked(prisma.fiscalYear.findUnique).mockResolvedValue({
        id: "fy-1",
        companyId: "comp-1",
        status: "OPEN",
        startDate: new Date("2024-01-01"),
        endDate: new Date("2024-12-31"),
      } as never);

      // Both lines belong to VALIDATED entries
      vi.mocked(prisma.journalEntryLine.findMany).mockResolvedValue([
        {
          id: "line-1",
          companyId: "comp-1",
          accountCode: "3421",
          debit: new Decimal(100),
          credit: new Decimal(0),
          isLettered: false,
          journalEntry: { id: "entry-1", status: "VALIDATED", entryNumber: 1 },
        },
        {
          id: "line-2",
          companyId: "comp-1",
          accountCode: "3421",
          debit: new Decimal(0),
          credit: new Decimal(100),
          isLettered: false,
          journalEntry: { id: "entry-2", status: "VALIDATED", entryNumber: 2 },
        },
      ] as never);

      vi.mocked(prisma.lettrageGroup.findMany).mockResolvedValue([]);
      vi.mocked(prisma.lettrageGroup.create).mockResolvedValue({
        id: "group-1",
        companyId: "comp-1",
        accountCode: "3421",
        code: "A",
        isPartial: false,
        totalDebit: new Decimal(100),
        totalCredit: new Decimal(100),
        remainder: new Decimal(0),
      } as never);

      vi.mocked(prisma.journalEntryLine.updateMany).mockResolvedValue({ count: 2 });

      const req = new NextRequest("http://localhost:3000/api/reconciliation", {
        method: "POST",
        body: JSON.stringify({
          companyId: "comp-1",
          fiscalYearId: "fy-1",
          accountCode: "3421",
          lineIds: ["line-1", "line-2"],
        }),
      });

      const res = await postReconciliation(req);
      expect(res.status).toBe(201);

      const body = await res.json();
      expect(body.code).toBe("A");
      expect(body.isPartial).toBe(false);
      expect(prisma.lettrageGroup.create).toHaveBeenCalled();
    });
  });

  describe("4. General Ledger & Financial Statements Default Filters", () => {
    it("ensures General Ledger defaults to VALIDATED and REVERSED, and excludes DRAFT and PRIOR_YEAR_COPY", async () => {
      const { GET: getGeneralLedger } = await import("@/app/api/reports/general-ledger/route");
      vi.mocked(prisma.journalEntryLine.findMany).mockResolvedValue([]);

      const req = new NextRequest(
        "http://localhost:3000/api/reports/general-ledger?companyId=comp-1&fiscalYearId=fy-1"
      );

      const res = await getGeneralLedger(req);
      expect(res.status).toBe(200);

      const lastCall = vi.mocked(prisma.journalEntryLine.findMany).mock.calls[0]?.[0];
      const whereJournalEntry = lastCall?.where?.journalEntry;

      expect(whereJournalEntry?.status).toEqual({ in: ["VALIDATED", "REVERSED"] });
      expect(whereJournalEntry?.NOT).toEqual({ sourceModule: "PRIOR_YEAR_COPY" });
    });

    it("ensures Financial Statements default to VALIDATED and REVERSED, and exclude DRAFT and PRIOR_YEAR_COPY", async () => {
      const { GET: getFinancialStatements } = await import("@/app/api/reports/financial-statements/route");
      vi.mocked(prisma.journalEntryLine.findMany).mockResolvedValue([]);

      const req = new NextRequest(
        "http://localhost:3000/api/reports/financial-statements?companyId=comp-1&fiscalYearId=fy-1"
      );

      const res = await getFinancialStatements(req);
      expect(res.status).toBe(200);

      const lastCall = vi.mocked(prisma.journalEntryLine.findMany).mock.calls[0]?.[0];
      const whereJournalEntry = lastCall?.where?.journalEntry;

      expect(whereJournalEntry?.status).toEqual({ in: ["VALIDATED", "REVERSED"] });
      expect(whereJournalEntry?.NOT).toEqual({ sourceModule: "PRIOR_YEAR_COPY" });
    });

    it("ensures duplicate-prior-year excludes reversed and reversal entries from source fiscal year", async () => {
      const { POST: postDuplicatePriorYear } = await import("@/app/api/entries/duplicate-prior-year/route");

      vi.mocked(prisma.company.findFirst).mockResolvedValue({ id: "comp-1" } as never);
      vi.mocked(prisma.userCompanyAccess.findUnique).mockResolvedValue({ canCloseExercise: true } as never);
      vi.mocked(prisma.fiscalYear.findUnique).mockResolvedValue({
        id: "fy-2024",
        companyId: "comp-1",
        startDate: new Date("2024-01-01"),
        endDate: new Date("2024-12-31"),
        status: "OPEN",
      } as never);
      vi.mocked(prisma.fiscalYear.findFirst).mockResolvedValue({
        id: "fy-2023",
        label: "2023",
        companyId: "comp-1",
        startDate: new Date("2023-01-01"),
        endDate: new Date("2023-12-31"),
      } as never);

      // Return empty priorEntries to verify the query where clause
      vi.mocked(prisma.journalEntry.findMany).mockResolvedValue([]);

      const req = new NextRequest("http://localhost:3000/api/entries/duplicate-prior-year", {
        method: "POST",
        body: JSON.stringify({ companyId: "comp-1", fiscalYearId: "fy-2024" }),
      });

      const res = await postDuplicatePriorYear(req);
      // Since priorEntries is empty, it returns 404 "Aucune écriture validée dans l'exercice N-1"
      expect(res.status).toBe(404);

      const findManyCalls = vi.mocked(prisma.journalEntry.findMany).mock.calls;
      const priorCall = findManyCalls.find((call) => call[0]?.where?.fiscalYearId === "fy-2023");
      const whereClause = priorCall?.[0]?.where;

      expect(whereClause?.status).toBe("VALIDATED");
      expect(whereClause?.isReversed).toBe(false);
      expect(whereClause?.isReversal).toBe(false);
      expect(whereClause?.NOT).toEqual({ sourceModule: "PRIOR_YEAR_COPY" });
    });

    it("VAT statements report excludes drafts by default, nets reversed entries, and excludes PRIOR_YEAR_COPY", async () => {
      const { GET: getVatStatements } = await import("@/app/api/reports/vat-statements/route");

      vi.mocked(prisma.vATDeclaration.findMany).mockResolvedValue([]);
      vi.mocked(prisma.journalEntryLine.findMany).mockResolvedValue([
        // Original sale TVA collectée (4455)
        {
          accountCode: "445500",
          debit: new Decimal(0),
          credit: new Decimal(200),
          journalEntry: { entryDate: new Date("2024-05-10") },
        },
        // Reversal sale TVA collectée (4455)
        {
          accountCode: "445500",
          debit: new Decimal(200),
          credit: new Decimal(0),
          journalEntry: { entryDate: new Date("2024-05-15") },
        },
        // Original expense TVA déductible (3455)
        {
          accountCode: "345500",
          debit: new Decimal(100),
          credit: new Decimal(0),
          journalEntry: { entryDate: new Date("2024-05-10") },
        },
        // Reversal expense TVA déductible (3455)
        {
          accountCode: "345500",
          debit: new Decimal(0),
          credit: new Decimal(100),
          journalEntry: { entryDate: new Date("2024-05-15") },
        },
      ] as never);

      const req = new NextRequest(
        "http://localhost:3000/api/reports/vat-statements?companyId=comp-1&fiscalYearId=fy-2024"
      );

      const res = await getVatStatements(req);
      expect(res.status).toBe(200);
      const json = await res.json();

      // Check query filters
      const lastLineCall = vi.mocked(prisma.journalEntryLine.findMany).mock.calls[0]?.[0];
      const whereJE = lastLineCall?.where?.journalEntry;
      expect(whereJE?.status).toEqual({ in: ["VALIDATED", "REVERSED"] });
      expect(whereJE?.NOT).toEqual({ sourceModule: "PRIOR_YEAR_COPY" });

      // Check summary: 200 - 200 = 0 collected, 100 - 100 = 0 deductible
      expect(json.summary.totalCollected).toBe("0.00");
      expect(json.summary.totalDeductible).toBe("0.00");
      expect(json.summary.netBalance).toBe("0.00");
    });

    it("Dashboard report excludes drafts by default, nets reversed entries, and excludes PRIOR_YEAR_COPY", async () => {
      const { GET: getDashboard } = await import("@/app/api/reports/dashboard/route");

      vi.mocked(prisma.company.findUnique).mockResolvedValue({ organizationId: "org-1" } as never);
      vi.mocked(prisma.fiscalYear.findUnique).mockResolvedValue({
        id: "fy-2024",
        startDate: new Date("2024-01-01"),
        endDate: new Date("2024-12-31"),
      } as never);

      vi.mocked(prisma.journalEntryLine.findMany).mockResolvedValue([
        // Validated sale on 7111: credit 1000
        {
          accountCode: "711100",
          debit: new Decimal(0),
          credit: new Decimal(1000),
          journalEntry: { entryDate: new Date("2024-03-10") },
          account: { code: "711100", label: "Ventes", classNumber: 7 },
        },
        // Reversal sale on 7111: debit 1000
        {
          accountCode: "711100",
          debit: new Decimal(1000),
          credit: new Decimal(0),
          journalEntry: { entryDate: new Date("2024-03-15") },
          account: { code: "711100", label: "Ventes", classNumber: 7 },
        },
        // Validated expense on 6111: debit 400
        {
          accountCode: "611100",
          debit: new Decimal(400),
          credit: new Decimal(0),
          journalEntry: { entryDate: new Date("2024-03-10") },
          account: { code: "611100", label: "Achats", classNumber: 6 },
        },
        // Reversal expense on 6111: credit 400
        {
          accountCode: "611100",
          debit: new Decimal(0),
          credit: new Decimal(400),
          journalEntry: { entryDate: new Date("2024-03-15") },
          account: { code: "611100", label: "Achats", classNumber: 6 },
        },
        // Active validated sale: credit 500
        {
          accountCode: "711100",
          debit: new Decimal(0),
          credit: new Decimal(500),
          journalEntry: { entryDate: new Date("2024-04-01") },
          account: { code: "711100", label: "Ventes", classNumber: 7 },
        },
      ] as never);

      const req = new NextRequest(
        "http://localhost:3000/api/reports/dashboard?companyId=comp-1&fiscalYearId=fy-2024"
      );

      const res = await getDashboard(req);
      expect(res.status).toBe(200);
      const json = await res.json();

      // Check query filter
      const lastLineCall = vi.mocked(prisma.journalEntryLine.findMany).mock.calls[0]?.[0];
      const whereJE = lastLineCall?.where?.journalEntry;
      expect(whereJE?.status).toEqual({ in: ["VALIDATED", "REVERSED"] });
      expect(whereJE?.NOT).toEqual({ sourceModule: "PRIOR_YEAR_COPY" });

      // Revenue: (1000 - 1000) + 500 = 500
      expect(json.kpis.revenue).toBe(500);
      // Expenses: 400 - 400 = 0
      expect(json.kpis.expenses).toBe(0);
      // Result: 500 - 0 = 500
      expect(json.kpis.result).toBe(500);
    });
  });

  describe("2. Reversal Fiscal-Period Date Integrity", () => {
      const mockEntryOriginal = {
        id: "entry-orig",
        fiscalYearId: "fy-2024",
        journalId: "j-1",
        entryNumber: 101,
        entryDate: new Date("2024-03-15"),
        reference: "ORIG-101",
        description: "Original entry",
        totalDebit: new Decimal(1000),
        totalCredit: new Decimal(1000),
        status: "VALIDATED",
        isReversed: false,
        journal: { id: "j-1", companyId: "comp-1" },
        fiscalYear: { id: "fy-2024", status: "OPEN", companyId: "comp-1" },
      };

      const mockSourceFY = {
        id: "fy-2024",
        status: "OPEN",
        startDate: new Date("2024-01-01"),
        endDate: new Date("2024-12-31"),
        companyId: "comp-1",
      };

      const mockTargetFY = {
        id: "fy-2025",
        status: "OPEN",
        startDate: new Date("2025-01-01"),
        endDate: new Date("2025-12-31"),
        companyId: "comp-1",
      };

      beforeEach(() => {
        vi.mocked(prisma.journal.findUnique).mockResolvedValue({
          id: "j-1",
          companyId: "comp-1",
        } as never);
        vi.mocked(prisma.journalEntryLine.findMany).mockResolvedValue([
          {
            lineNumber: 1,
            accountCode: "6111",
            companyId: "comp-1",
            label: "Charge",
            debit: new Decimal(1000),
            credit: new Decimal(0),
          },
          {
            lineNumber: 2,
            accountCode: "4411",
            companyId: "comp-1",
            label: "Dette",
            debit: new Decimal(0),
            credit: new Decimal(1000),
          },
        ] as never);
        vi.mocked(prisma.journalEntry.updateMany).mockResolvedValue({ count: 1 });
        vi.mocked(prisma.journalEntry.findFirst).mockResolvedValue({ entryNumber: 101 } as never);
      });

      type MockFn<TArgs, TReturn = unknown> = {
        mockImplementation: (fn: (args: TArgs) => Promise<TReturn>) => void;
      };

      const mockFindEntry = (fn: (args: { where: { id: string } }) => Promise<unknown>) => {
        (vi.mocked(prisma.journalEntry.findUnique) as unknown as MockFn<{ where: { id: string } }>).mockImplementation(fn);
      };

      const mockFindFY = (fn: (args: { where: { id: string } }) => Promise<unknown>) => {
        (vi.mocked(prisma.fiscalYear.findUnique) as unknown as MockFn<{ where: { id: string } }>).mockImplementation(fn);
      };

      const mockCreateEntry = (fn: (args: { data: Record<string, unknown> }) => Promise<unknown>) => {
        (vi.mocked(prisma.journalEntry.create) as unknown as MockFn<{ data: Record<string, unknown> }>).mockImplementation(fn);
      };

      it("reverses successfully within the same open fiscal year when date is within bounds", async () => {
        const { PUT: putEntry } = await import("@/app/api/entries/[id]/route");

        mockFindEntry(async ({ where }) => {
          if (where.id === "entry-orig") return mockEntryOriginal;
          return null;
        });

        mockFindFY(async ({ where }) => {
          if (where.id === "fy-2024") return mockSourceFY;
          return null;
        });

        let createdEntryData: Record<string, unknown> | null = null;
        mockCreateEntry(async ({ data }) => {
          createdEntryData = data;
          return { id: "rev-1", ...data };
        });

        const req = new NextRequest("http://localhost:3000/api/entries/entry-orig", {
          method: "PUT",
          body: JSON.stringify({
            action: "reverse",
            reversalDate: "2024-06-15",
          }),
        });

        const res = await putEntry(req, { params: Promise.resolve({ id: "entry-orig" }) });
        expect(res.status).toBe(200);

        expect(createdEntryData).not.toBeNull();
        expect(createdEntryData!.fiscalYearId).toBe("fy-2024");
        expect(createdEntryData!.isReversal).toBe(true);
        expect(createdEntryData!.originalEntryId).toBe("entry-orig");
        expect(new Date(createdEntryData!.entryDate as Date).toISOString().slice(0, 10)).toBe("2024-06-15");

        expect(prisma.journalEntry.updateMany).toHaveBeenCalledWith({
          where: { id: "entry-orig", status: "VALIDATED", isReversed: false },
          data: { isReversed: true, reversedById: "rev-1", status: "REVERSED" },
        });
      });

      it("reverses successfully targeting a later open fiscal year with explicit targetFiscalYearId", async () => {
        const { PUT: putEntry } = await import("@/app/api/entries/[id]/route");

        mockFindEntry(async ({ where }) => {
          if (where.id === "entry-orig") return mockEntryOriginal;
          return null;
        });

        mockFindFY(async ({ where }) => {
          if (where.id === "fy-2024") return mockSourceFY;
          if (where.id === "fy-2025") return mockTargetFY;
          return null;
        });

        let createdEntryData: Record<string, unknown> | null = null;
        mockCreateEntry(async ({ data }) => {
          createdEntryData = data;
          return { id: "rev-2", ...data };
        });

        const req = new NextRequest("http://localhost:3000/api/entries/entry-orig", {
          method: "PUT",
          body: JSON.stringify({
            action: "reverse",
            targetFiscalYearId: "fy-2025",
            reversalDate: "2025-02-15",
          }),
        });

        const res = await putEntry(req, { params: Promise.resolve({ id: "entry-orig" }) });
        expect(res.status).toBe(200);

        expect(createdEntryData).not.toBeNull();
        expect(createdEntryData!.fiscalYearId).toBe("fy-2025");
        expect(createdEntryData!.isReversal).toBe(true);
        expect(createdEntryData!.originalEntryId).toBe("entry-orig");
        expect(new Date(createdEntryData!.entryDate as Date).toISOString().slice(0, 10)).toBe("2025-02-15");
      });

      it("rejects reversal when reversal date is outside target fiscal year boundaries", async () => {
        const { PUT: putEntry } = await import("@/app/api/entries/[id]/route");

        mockFindEntry(async ({ where }) => {
          if (where.id === "entry-orig") return mockEntryOriginal;
          return null;
        });

        mockFindFY(async ({ where }) => {
          if (where.id === "fy-2024") return mockSourceFY;
          return null;
        });

        const req = new NextRequest("http://localhost:3000/api/entries/entry-orig", {
          method: "PUT",
          body: JSON.stringify({
            action: "reverse",
            // fy-2024 ends 2024-12-31, date is in 2025 without targetFiscalYearId
            reversalDate: "2025-03-01",
          }),
        });

        const res = await putEntry(req, { params: Promise.resolve({ id: "entry-orig" }) });
        expect(res.status).toBe(400);
        const json = await res.json();
        expect(json.error).toMatch(/limites de l'exercice/);
      });

      it("rejects reversal targeting an earlier fiscal year than original entry", async () => {
        const { PUT: putEntry } = await import("@/app/api/entries/[id]/route");

        mockFindEntry(async ({ where }) => {
          if (where.id === "entry-orig") return mockEntryOriginal;
          return null;
        });

        mockFindFY(async ({ where }) => {
          if (where.id === "fy-2024") return mockSourceFY;
          if (where.id === "fy-2023") {
            return {
              id: "fy-2023",
              status: "OPEN",
              startDate: new Date("2023-01-01"),
              endDate: new Date("2023-12-31"),
              companyId: "comp-1",
            };
          }
          return null;
        });

        const req = new NextRequest("http://localhost:3000/api/entries/entry-orig", {
          method: "PUT",
          body: JSON.stringify({
            action: "reverse",
            targetFiscalYearId: "fy-2023",
            reversalDate: "2023-06-01",
          }),
        });

        const res = await putEntry(req, { params: Promise.resolve({ id: "entry-orig" }) });
        expect(res.status).toBe(400);
        const json = await res.json();
        expect(json.error).toMatch(/antérieur/);
      });

      it("rejects reversal when source fiscal year is CLOSED", async () => {
        const { PUT: putEntry } = await import("@/app/api/entries/[id]/route");

        const closedSourceFY = { ...mockSourceFY, status: "CLOSED" };
        const entryInClosedFY = {
          ...mockEntryOriginal,
          fiscalYear: { id: "fy-2024", status: "CLOSED", companyId: "comp-1" },
        };

        mockFindEntry(async ({ where }) => {
          if (where.id === "entry-orig") return entryInClosedFY;
          return null;
        });

        mockFindFY(async ({ where }) => {
          if (where.id === "fy-2024") return closedSourceFY;
          return null;
        });

        const req = new NextRequest("http://localhost:3000/api/entries/entry-orig", {
          method: "PUT",
          body: JSON.stringify({
            action: "reverse",
            reversalDate: "2024-06-15",
          }),
        });

        const res = await putEntry(req, { params: Promise.resolve({ id: "entry-orig" }) });
        expect(res.status).toBe(400);
        const json = await res.json();
        expect(json.error).toMatch(/clôturé/);
      });

      it("rejects reversal when target fiscal year is CLOSED", async () => {
        const { PUT: putEntry } = await import("@/app/api/entries/[id]/route");

        const closedTargetFY = { ...mockTargetFY, status: "CLOSED" };

        mockFindEntry(async ({ where }) => {
          if (where.id === "entry-orig") return mockEntryOriginal;
          return null;
        });

        mockFindFY(async ({ where }) => {
          if (where.id === "fy-2024") return mockSourceFY;
          if (where.id === "fy-2025") return closedTargetFY;
          return null;
        });

        const req = new NextRequest("http://localhost:3000/api/entries/entry-orig", {
          method: "PUT",
          body: JSON.stringify({
            action: "reverse",
            targetFiscalYearId: "fy-2025",
            reversalDate: "2025-06-15",
          }),
        });

        const res = await putEntry(req, { params: Promise.resolve({ id: "entry-orig" }) });
        expect(res.status).toBe(400);
        const json = await res.json();
        expect(json.error).toMatch(/clôturé/);
      });

      it("rejects reversal when reversal date is earlier than original entryDate within same fiscal year", async () => {
        const { PUT: putEntry } = await import("@/app/api/entries/[id]/route");

        mockFindEntry(async ({ where }) => {
          if (where.id === "entry-orig") return mockEntryOriginal;
          return null;
        });

        mockFindFY(async ({ where }) => {
          if (where.id === "fy-2024") return mockSourceFY;
          return null;
        });

        const req = new NextRequest("http://localhost:3000/api/entries/entry-orig", {
          method: "PUT",
          body: JSON.stringify({
            action: "reverse",
            // entry-orig has entryDate: 2024-03-15, but reversalDate is 2024-02-01 (earlier in same FY)
            reversalDate: "2024-02-01",
          }),
        });

        const res = await putEntry(req, { params: Promise.resolve({ id: "entry-orig" }) });
        expect(res.status).toBe(400);
        const json = await res.json();
        expect(json.error).toMatch(/antérieure à la date de l'écriture d'origine/);
      });
    });

    describe("5. Aged Balance Report (/api/reports/aged-balance)", () => {
      it("enforces canAccessReports authorization check", async () => {
        const { GET: getAgedBalance } = await import("@/app/api/reports/aged-balance/route");
        vi.mocked(checkPermission).mockResolvedValueOnce(false);

        const req = new NextRequest("http://localhost:3000/api/reports/aged-balance?companyId=comp-1&fiscalYearId=fy-2024");
        const res = await getAgedBalance(req);
        expect(res.status).toBe(403);
        const json = await res.json();
        expect(json.error).toBe("Forbidden");
      });

      it("excludes drafts and PRIOR_YEAR_COPY by default, and nets reversed entries", async () => {
        const { GET: getAgedBalance } = await import("@/app/api/reports/aged-balance/route");

        vi.mocked(prisma.journalEntryLine.findMany).mockResolvedValue([
          // Original client invoice (Client Alpha, debit 1000)
          {
            accountCode: "342100",
            debit: new Decimal(1000),
            credit: new Decimal(0),
            tiersName: "Client Alpha",
            dueDate: new Date("2024-03-15"),
            journalEntry: { entryDate: new Date("2024-03-01") },
          },
          // Reversal client invoice (Client Alpha, credit 1000) -> nets Client Alpha to zero!
          {
            accountCode: "342100",
            debit: new Decimal(0),
            credit: new Decimal(1000),
            tiersName: "Client Alpha",
            dueDate: new Date("2024-03-20"),
            journalEntry: { entryDate: new Date("2024-03-20") },
          },
          // Outstanding client invoice (Client Beta, debit 500)
          {
            accountCode: "342100",
            debit: new Decimal(500),
            credit: new Decimal(0),
            tiersName: "Client Beta",
            dueDate: new Date("2024-03-15"),
            journalEntry: { entryDate: new Date("2024-03-01") },
          },
        ] as never);

        const req = new NextRequest("http://localhost:3000/api/reports/aged-balance?companyId=comp-1&fiscalYearId=fy-2024");
        const res = await getAgedBalance(req);
        expect(res.status).toBe(200);
        const json = await res.json();

        // Check query filters
        const lastCall = vi.mocked(prisma.journalEntryLine.findMany).mock.calls[0]?.[0];
        const whereJE = lastCall?.where?.journalEntry;
        expect(whereJE?.status).toEqual({ in: ["VALIDATED", "REVERSED"] });
        expect(whereJE?.NOT).toEqual({ sourceModule: "PRIOR_YEAR_COPY" });

        // Client Alpha is netted to 0 so filtered out; Client Beta remains with balance 500.00
        expect(json.rows).toHaveLength(1);
        expect(json.rows[0].tiersName).toBe("Client Beta");
        expect(json.rows[0].totalBalance).toBe("500.00");
        expect(json.summary.totalReceivables).toBe("500.00");
        expect(json.summary.totalPayables).toBe("0.00");
      });
    });

    describe("6. Journal Report (/api/reports/journal)", () => {
      it("enforces canAccessReports authorization check", async () => {
        const { GET: getJournal } = await import("@/app/api/reports/journal/route");
        vi.mocked(checkPermission).mockResolvedValueOnce(false);

        const req = new NextRequest("http://localhost:3000/api/reports/journal?companyId=comp-1&fiscalYearId=fy-2024");
        const res = await getJournal(req);
        expect(res.status).toBe(403);
        const json = await res.json();
        expect(json.error).toBe("Forbidden: No access to reports");
      });

      it("excludes drafts and PRIOR_YEAR_COPY by default, and includes both original and reversal entries", async () => {
        const { GET: getJournal } = await import("@/app/api/reports/journal/route");

        vi.mocked(prisma.journalEntry.findMany).mockResolvedValue([
          {
            id: "entry-1",
            entryNumber: 10,
            entryDate: new Date("2024-03-15"),
            status: "REVERSED",
            isReversed: true,
            description: "Facture Client",
            reference: "FAC-10",
            journal: { code: "VT", label: "Ventes" },
            lines: [
              { lineNumber: 1, debit: new Decimal(1200), credit: new Decimal(0), account: { code: "3421", label: "Client" } },
              { lineNumber: 2, debit: new Decimal(0), credit: new Decimal(1000), account: { code: "7111", label: "Vente" } },
              { lineNumber: 3, debit: new Decimal(0), credit: new Decimal(200), account: { code: "4455", label: "TVA" } },
            ],
            createdBy: { firstName: "Ali", lastName: "Admin" },
          },
          {
            id: "entry-2",
            entryNumber: 11,
            entryDate: new Date("2024-03-20"),
            status: "VALIDATED",
            isReversal: true,
            description: "Contrepassation: Facture Client",
            reference: "REV-10",
            journal: { code: "VT", label: "Ventes" },
            lines: [
              { lineNumber: 1, debit: new Decimal(0), credit: new Decimal(1200), account: { code: "3421", label: "Client" } },
              { lineNumber: 2, debit: new Decimal(1000), credit: new Decimal(0), account: { code: "7111", label: "Vente" } },
              { lineNumber: 3, debit: new Decimal(200), credit: new Decimal(0), account: { code: "4455", label: "TVA" } },
            ],
            createdBy: { firstName: "Ali", lastName: "Admin" },
          },
        ] as never);

        const req = new NextRequest("http://localhost:3000/api/reports/journal?companyId=comp-1&fiscalYearId=fy-2024");
        const res = await getJournal(req);
        expect(res.status).toBe(200);
        const json = await res.json();

        // Check query filters
        const lastCall = vi.mocked(prisma.journalEntry.findMany).mock.calls[0]?.[0];
        const where = lastCall?.where;
        expect(where?.status).toEqual({ in: ["VALIDATED", "REVERSED"] });
        expect(where?.NOT).toEqual({ sourceModule: "PRIOR_YEAR_COPY" });

        // Both original and reversal entries appear in the journal
        expect(json.totalEntries).toBe(2);
        expect(json.journals).toHaveLength(1);
        expect(json.journals[0].journalCode).toBe("VT");
        expect(json.journals[0].entries).toHaveLength(2);
      });
    });
  });

