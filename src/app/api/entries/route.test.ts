import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "./route";
import { prisma } from "@/server/prisma";
import { auth } from "@/server/auth";
import { checkPermission } from "@/server/permissions";
import { syncVATDeclarationForDate } from "@/server/calculations/vatSync";
import { NextRequest } from "next/server";

vi.mock("@/server/prisma", () => ({
  prisma: {
    journalEntry: {
      create: vi.fn(),
      findFirst: vi.fn(),
    },
    journal: {
      findUnique: vi.fn(),
    },
    fiscalYear: {
      findUnique: vi.fn(),
    }
  },
}));

vi.mock("@/server/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/server/permissions", () => ({
  checkPermission: vi.fn(),
}));

vi.mock("@/server/calculations/vatSync", () => ({
  syncVATDeclarationForDate: vi.fn().mockResolvedValue(undefined),
}));

describe("Journal Entry API (POST)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a journal entry successfully when authorized and balanced", async () => {
    vi.mocked(auth).mockResolvedValue({
      user: { id: "user-1", organizationId: "org-1", role: "ADMIN", email: "user@example.com", name: "User" },
      expires: "",
    } as never);
    vi.mocked(checkPermission).mockResolvedValue(true);
    
    vi.mocked(prisma.journal.findUnique).mockResolvedValue({ id: "journal-1", companyId: "comp-1" } as never);
    vi.mocked(prisma.fiscalYear.findUnique).mockResolvedValue({ id: "fy-1", companyId: "comp-1", status: "OPEN", startDate: new Date("2024-01-01"), endDate: new Date("2024-12-31") } as never);
    vi.mocked(prisma.journalEntry.findFirst).mockResolvedValue({ entryNumber: 1 } as never);
    const expectedEntryDate = new Date("2024-01-10T00:00:00.000Z");
    vi.mocked(prisma.journalEntry.create).mockResolvedValue({
      id: "entry-123",
      fiscalYearId: "fy-1",
      entryDate: expectedEntryDate,
    } as never);

    const body = {
      journalId: "journal-1",
      fiscalYearId: "fy-1",
      entryDate: "2024-01-10T00:00:00.000Z",
      description: "Test Entry",
      lines: [
        { lineNumber: 1, accountCode: "5141", debit: 100, credit: 0, label: "Bank" },
        { lineNumber: 2, accountCode: "4111", debit: 0, credit: 100, label: "Client" }
      ]
    };

    const req = new NextRequest("http://localhost:3000/api/entries", {
      method: "POST",
      body: JSON.stringify(body)
    });

    const res = await POST(req);
    const data = await res.json();
    expect(res.status).toBe(201);
    expect(data.id).toBe("entry-123");
    expect(syncVATDeclarationForDate).toHaveBeenCalledWith("comp-1", "fy-1", expectedEntryDate);
  });

  it("returns 400 when fiscal year and journal belong to different companies", async () => {
    vi.mocked(auth).mockResolvedValue({
      user: { id: "user-1", organizationId: "org-1", role: "ADMIN", email: "user@example.com", name: "User" },
      expires: "",
    } as never);
    
    vi.mocked(prisma.fiscalYear.findUnique).mockResolvedValue({
      id: "fy-1",
      companyId: "comp-company-A",
      status: "OPEN",
      startDate: new Date("2024-01-01"),
      endDate: new Date("2024-12-31"),
    } as never);
    vi.mocked(prisma.journal.findUnique).mockResolvedValue({
      id: "journal-1",
      companyId: "comp-company-B",
    } as never);

    const body = {
      journalId: "journal-1",
      fiscalYearId: "fy-1",
      entryDate: "2024-01-10T00:00:00.000Z",
      description: "Cross company mismatch",
      lines: [
        { lineNumber: 1, accountCode: "5141", debit: 100, credit: 0, label: "Bank" },
        { lineNumber: 2, accountCode: "4111", debit: 0, credit: 100, label: "Client" },
      ],
    };

    const req = new NextRequest("http://localhost:3000/api/entries", {
      method: "POST",
      body: JSON.stringify(body),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("L'exercice comptable et le journal doivent appartenir à la même société");
    expect(checkPermission).not.toHaveBeenCalled();
    expect(prisma.journalEntry.create).not.toHaveBeenCalled();
  });

  it("returns 400 when entry is unbalanced", async () => {
    vi.mocked(auth).mockResolvedValue({
      user: { id: "user-1", organizationId: "org-1", role: "ADMIN", email: "user@example.com", name: "User" },
      expires: "",
    } as never);
    
    const body = {
      journalId: "journal-1",
      fiscalYearId: "fy-1",
      entryDate: "2024-01-10T00:00:00.000Z",
      description: "Unbalanced Entry",
      lines: [
        { lineNumber: 1, accountCode: "5141", debit: 100, credit: 0, label: "Bank" },
        { lineNumber: 2, accountCode: "4111", debit: 0, credit: 50, label: "Client" }
      ]
    };

    const req = new NextRequest("http://localhost:3000/api/entries", {
      method: "POST",
      body: JSON.stringify(body)
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBeDefined();
  });
});
