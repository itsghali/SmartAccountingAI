import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";
import { checkPermission } from "@/server/permissions";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Non autoris\u00e9" }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  const companyId = params.get("companyId");
  const fiscalYearId = params.get("fiscalYearId");
  const journalId = params.get("journalId");
  const startDate = params.get("startDate");
  const endDate = params.get("endDate");

  if (!companyId || !fiscalYearId) {
    return NextResponse.json(
      { error: "companyId et fiscalYearId requis" },
      { status: 400 }
    );
  }

  if (!(await checkPermission(companyId, "canAccessReports"))) {
    return NextResponse.json({ error: "Forbidden: No access to reports" }, { status: 403 });
  }

  const includeDrafts = params.get("includeDrafts") === "true";
  const includePriorYear = params.get("includePriorYear") === "true";

  const where: Prisma.JournalEntryWhereInput = {
    fiscalYearId,
    journal: { companyId },
    status: includeDrafts
      ? { in: ["DRAFT", "VALIDATED", "REVERSED"] }
      : { in: ["VALIDATED", "REVERSED"] },
    ...(!includePriorYear ? { NOT: { sourceModule: "PRIOR_YEAR_COPY" } } : {}),
  };

  if (journalId) where.journalId = journalId;

  if (startDate || endDate) {
    const entryDate: { gte?: Date; lte?: Date } = {};
    if (startDate) entryDate.gte = new Date(startDate);
    if (endDate) entryDate.lte = new Date(endDate);
    where.entryDate = entryDate;
  }

  const entries = await prisma.journalEntry.findMany({
    where,
    include: {
      journal: {
        select: { code: true, label: true },
      },
      lines: {
        include: {
          account: {
            select: { code: true, label: true },
          },
        },
        orderBy: { lineNumber: "asc" },
      },
      createdBy: {
        select: { firstName: true, lastName: true },
      },
    },
    orderBy: [
      { journal: { code: "asc" } },
      { entryDate: "asc" },
      { entryNumber: "asc" },
    ],
  });

  // Group entries by journal for easier display
  const journalGroups = new Map<
    string,
    {
      journalCode: string;
      journalLabel: string;
      entries: typeof entries;
    }
  >();

  for (const entry of entries) {
    const jCode = entry.journal.code;
    let group = journalGroups.get(jCode);
    if (!group) {
      group = {
        journalCode: entry.journal.code,
        journalLabel: entry.journal.label,
        entries: [],
      };
      journalGroups.set(jCode, group);
    }
    group.entries.push(entry);
  }

  const journals = Array.from(journalGroups.values()).sort((a, b) =>
    a.journalCode.localeCompare(b.journalCode)
  );

  return NextResponse.json({ journals, totalEntries: entries.length });
}
