import { describe, it, expect, vi } from "vitest";
import Decimal from "decimal.js";
import { computeTrialBalance } from "./balance";
import { prisma } from "@/server/prisma";

vi.mock("@/server/prisma", () => ({
  prisma: {
    journalEntryLine: {
      findMany: vi.fn(),
    },
  },
}));

describe("Trial Balance Calculations", () => {
  it("calculates trial balance totals correctly from DB rows", async () => {
    // Mock the DB response
    const mockLines = [
      {
        accountCode: "5141",
        debit: new Decimal(1000),
        credit: new Decimal(0),
        account: { label: "Banque", classNumber: 5 },
      },
      {
        accountCode: "5141",
        debit: new Decimal(0),
        credit: new Decimal(200),
        account: { label: "Banque", classNumber: 5 },
      },
      {
        accountCode: "7111",
        debit: new Decimal(0),
        credit: new Decimal(800),
        account: { label: "Ventes de marchandises", classNumber: 7 },
      },
    ] as unknown as Awaited<ReturnType<typeof prisma.journalEntryLine.findMany>>;
    
    vi.mocked(prisma.journalEntryLine.findMany).mockResolvedValue(mockLines);

    const result = await computeTrialBalance("company-1", "fiscal-year-1");

    expect(result.accounts).toHaveLength(2);
    
    // Check 5141 Account (Banque)
    const banque = result.accounts.find(a => a.accountCode === "5141");
    expect(banque?.totalDebit.toNumber()).toBe(1000);
    expect(banque?.totalCredit.toNumber()).toBe(200);
    expect(banque?.soldeDebit.toNumber()).toBe(800);
    expect(banque?.soldeCredit.toNumber()).toBe(0);

    // Check 7111 Account
    const ventes = result.accounts.find(a => a.accountCode === "7111");
    expect(ventes?.totalDebit.toNumber()).toBe(0);
    expect(ventes?.totalCredit.toNumber()).toBe(800);
    expect(ventes?.soldeDebit.toNumber()).toBe(0);
    expect(ventes?.soldeCredit.toNumber()).toBe(800);

    // Check Globals
    expect(result.totalDebit.toNumber()).toBe(1000);
    expect(result.totalCredit.toNumber()).toBe(1000);
    expect(result.totalSoldeDebit.toNumber()).toBe(800);
    expect(result.totalSoldeCredit.toNumber()).toBe(800);
  });
});
