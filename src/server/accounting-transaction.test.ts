import { describe, expect, it, vi } from "vitest";
import {
  AccountingError,
  assertFiscalPeriodAllowsMutation,
  lockJournalsInOrder,
  lockJournalEntry,
  allocateNextEntryNumber,
  recordAuditLog,
  runAccountingTransaction,
} from "./accounting-transaction";
import { prisma } from "@/server/prisma";
import type { Prisma } from "@prisma/client";

vi.mock("@/server/prisma", () => ({
  prisma: {
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
  },
}));

describe("Accounting Transaction Safety & Locking (src/server/accounting-transaction.ts)", () => {
  describe("AccountingError", () => {
    it("creates an error with default and custom status code", () => {
      const errDefault = new AccountingError("Default error");
      expect(errDefault.message).toBe("Default error");
      expect(errDefault.statusCode).toBe(400);
      expect(errDefault.name).toBe("AccountingError");

      const errCustom = new AccountingError("Not found", 404, { id: "123" });
      expect(errCustom.message).toBe("Not found");
      expect(errCustom.statusCode).toBe(404);
      expect(errCustom.details).toEqual({ id: "123" });
    });
  });

  describe("assertFiscalPeriodAllowsMutation", () => {
    it("throws 400 when fiscal year is CLOSED for any mutation type", () => {
      const closedFy = { status: "CLOSED" };
      expect(() => assertFiscalPeriodAllowsMutation(closedFy, "CREATE")).toThrow(
        "L'exercice comptable est clôturé"
      );
      expect(() => assertFiscalPeriodAllowsMutation(closedFy, "VALIDATE")).toThrow(
        "L'exercice comptable est clôturé"
      );
      expect(() => assertFiscalPeriodAllowsMutation(closedFy, "REVERSE")).toThrow(
        "L'exercice comptable est clôturé"
      );
      expect(() => assertFiscalPeriodAllowsMutation(closedFy, "DELETE")).toThrow(
        "L'exercice comptable est clôturé"
      );
      expect(() => assertFiscalPeriodAllowsMutation(closedFy, "DUPLICATE")).toThrow(
        "L'exercice comptable est clôturé"
      );
      expect(() => assertFiscalPeriodAllowsMutation(closedFy, "AMORTIZATION")).toThrow(
        "L'exercice comptable est clôturé"
      );
      expect(() => assertFiscalPeriodAllowsMutation(closedFy, "RECONCILIATION")).toThrow(
        "L'exercice comptable est clôturé"
      );
    });

    it("throws 400 when fiscal year is PROVISIONAL_CLOSE for CREATE operations", () => {
      const provFy = { status: "PROVISIONAL_CLOSE" };
      expect(() => assertFiscalPeriodAllowsMutation(provFy, "CREATE")).toThrow(
        "L'exercice comptable est en clôture provisoire"
      );
    });

    it("allows non-CREATE operations when fiscal year is PROVISIONAL_CLOSE", () => {
      const provFy = { status: "PROVISIONAL_CLOSE" };
      expect(() => assertFiscalPeriodAllowsMutation(provFy, "VALIDATE")).not.toThrow();
      expect(() => assertFiscalPeriodAllowsMutation(provFy, "REVERSE")).not.toThrow();
      expect(() => assertFiscalPeriodAllowsMutation(provFy, "DELETE")).not.toThrow();
      expect(() => assertFiscalPeriodAllowsMutation(provFy, "RECONCILIATION")).not.toThrow();
    });

    it("allows all operations when fiscal year is OPEN", () => {
      const openFy = { status: "OPEN" };
      expect(() => assertFiscalPeriodAllowsMutation(openFy, "CREATE")).not.toThrow();
      expect(() => assertFiscalPeriodAllowsMutation(openFy, "VALIDATE")).not.toThrow();
      expect(() => assertFiscalPeriodAllowsMutation(openFy, "REVERSE")).not.toThrow();
      expect(() => assertFiscalPeriodAllowsMutation(openFy, "DELETE")).not.toThrow();
      expect(() => assertFiscalPeriodAllowsMutation(openFy, "DUPLICATE")).not.toThrow();
      expect(() => assertFiscalPeriodAllowsMutation(openFy, "AMORTIZATION")).not.toThrow();
      expect(() => assertFiscalPeriodAllowsMutation(openFy, "RECONCILIATION")).not.toThrow();
    });
  });

  describe("lockJournalsInOrder", () => {
    it("locks distinct journals in deterministic ascending order to prevent deadlocks", async () => {
      const lockOrder: string[] = [];

      const mockTx = {
        $queryRaw: vi.fn().mockImplementation((strings: TemplateStringsArray, ...values: unknown[]) => {
          const jId = values[0] as string;
          lockOrder.push(jId);
          return Promise.resolve([{ id: jId, code: "J", label: "Journal", companyId: "comp-1" }]);
        }),
      } as unknown as Prisma.TransactionClient;

      // Pass out of order and with duplicates: ["journal-C", "journal-A", "journal-B", "journal-A"]
      const result = await lockJournalsInOrder(
        mockTx,
        ["journal-C", "journal-A", "journal-B", "journal-A"],
        "comp-1"
      );

      // Verify execution order was sorted ascending without duplicates
      expect(lockOrder).toEqual(["journal-A", "journal-B", "journal-C"]);
      expect(result.size).toBe(3);
      expect(result.get("journal-A")?.id).toBe("journal-A");
      expect(result.get("journal-B")?.id).toBe("journal-B");
      expect(result.get("journal-C")?.id).toBe("journal-C");
    });
  });

  describe("lockJournalEntry", () => {
    it("locks entry using queryRaw FOR UPDATE", async () => {
      const mockEntry = {
        id: "entry-1",
        status: "DRAFT",
        isReversed: false,
        entryNumber: 10,
        description: "Test",
        totalDebit: 100,
        totalCredit: 100,
        journalId: "j-1",
        fiscalYearId: "fy-1",
      };

      const mockTx = {
        $queryRaw: vi.fn().mockResolvedValue([mockEntry]),
      } as unknown as Prisma.TransactionClient;

      const result = await lockJournalEntry(mockTx, "entry-1");
      expect(result).toEqual(mockEntry);
    });

    it("falls back to findUnique when queryRaw is mocked/unavailable", async () => {
      const mockEntry = {
        id: "entry-2",
        status: "VALIDATED",
        isReversed: false,
        entryNumber: 12,
        description: "Test 2",
        totalDebit: 200,
        totalCredit: 200,
        journalId: "j-1",
        fiscalYearId: "fy-1",
      };

      const mockTx = {
        $queryRaw: vi.fn().mockRejectedValue(new Error("queryRaw unavailable")),
        journalEntry: {
          findUnique: vi.fn().mockResolvedValue(mockEntry),
        },
      } as unknown as Prisma.TransactionClient;

      const result = await lockJournalEntry(mockTx, "entry-2");
      expect(result).toEqual(mockEntry);
    });
  });

  describe("allocateNextEntryNumber", () => {
    it("queries max entry number and returns next sequential number via queryRaw", async () => {
      const mockTx = {
        $queryRaw: vi.fn().mockResolvedValue([{ nextNumber: 15 }]),
      } as unknown as Prisma.TransactionClient;

      const num = await allocateNextEntryNumber(mockTx, "j-1", "fy-1");
      expect(num).toBe(15);
    });

    it("handles driver case-folded column names like nextnumber", async () => {
      const mockTx = {
        $queryRaw: vi.fn().mockResolvedValue([{ nextnumber: "20" }]),
      } as unknown as Prisma.TransactionClient;

      const num = await allocateNextEntryNumber(mockTx, "j-1", "fy-1");
      expect(num).toBe(20);
    });

    it("falls back to findFirst when queryRaw returns null/empty", async () => {
      const mockTx = {
        $queryRaw: vi.fn().mockResolvedValue([]),
        journalEntry: {
          findFirst: vi.fn().mockResolvedValue({ entryNumber: 7 }),
        },
      } as unknown as Prisma.TransactionClient;

      const num = await allocateNextEntryNumber(mockTx, "j-1", "fy-1");
      expect(num).toBe(8);
    });

    it("returns 1 if no previous entries exist", async () => {
      const mockTx = {
        $queryRaw: vi.fn().mockResolvedValue([]),
        journalEntry: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
      } as unknown as Prisma.TransactionClient;

      const num = await allocateNextEntryNumber(mockTx, "j-1", "fy-1");
      expect(num).toBe(1);
    });
  });

  describe("recordAuditLog", () => {
    it("invokes tx.auditLog.create with normalized data", async () => {
      const createMock = vi.fn().mockResolvedValue({});
      const mockTx = {
        auditLog: {
          create: createMock,
        },
      } as unknown as Prisma.TransactionClient;

      await recordAuditLog(mockTx, {
        userId: "user-99",
        companyId: "comp-1",
        action: "ENTRY_CREATED",
        entityType: "JournalEntry",
        entityId: "entry-123",
        details: { amount: 500 },
        ipAddress: "192.168.1.1",
      });

      expect(createMock).toHaveBeenCalledTimes(1);
      expect(createMock).toHaveBeenCalledWith({
        data: {
          userId: "user-99",
          companyId: "comp-1",
          action: "ENTRY_CREATED",
          entityType: "JournalEntry",
          entityId: "entry-123",
          details: { amount: 500 },
          ipAddress: "192.168.1.1",
        },
      });
    });
  });

  describe("runAccountingTransaction", () => {
    it("delegates to prisma.$transaction", async () => {
      const mockCallbackResult = { done: true };
      vi.mocked(prisma.$transaction).mockImplementation(async (cb: unknown) => {
        return (cb as (tx: unknown) => Promise<unknown>)({} as Prisma.TransactionClient);
      });

      const result = await runAccountingTransaction(async () => {
        return mockCallbackResult;
      });

      expect(result).toBe(mockCallbackResult);
      expect(prisma.$transaction).toHaveBeenCalled();
    });
  });
});
