import { describe, it, expect, vi } from "vitest";
import { POST } from "./route";
import { prisma } from "@/server/prisma";
import { auth } from "@/server/auth";
import { checkPermission } from "@/server/permissions";
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

describe("Journal Entry API (POST)", () => {
  it("creates a journal entry successfully when authorized and balanced", async () => {
    vi.mocked(auth).mockResolvedValue({
      user: { id: "user-1", organizationId: "org-1", role: "ADMIN", email: "user@example.com", name: "User" },
      expires: "",
    } as never);
    vi.mocked(checkPermission).mockResolvedValue(true);
    
    vi.mocked(prisma.journal.findUnique).mockResolvedValue({ id: "journal-1", companyId: "comp-1" } as never);
    vi.mocked(prisma.fiscalYear.findUnique).mockResolvedValue({ id: "fy-1", status: "OPEN", startDate: new Date("2024-01-01"), endDate: new Date("2024-12-31") } as never);
    vi.mocked(prisma.journalEntry.findFirst).mockResolvedValue({ entryNumber: 1 } as never);
    vi.mocked(prisma.journalEntry.create).mockResolvedValue({ id: "entry-123" } as never);

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
