import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";
import Decimal from "decimal.js";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Non autoris\u00e9" }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  const companyId = params.get("companyId");
  const fiscalYearId = params.get("fiscalYearId");
  const accountCode = params.get("accountCode"); // optional, filter single account
  const startDate = params.get("startDate");
  const endDate = params.get("endDate");

  if (!companyId || !fiscalYearId) {
    return NextResponse.json(
      { error: "companyId et fiscalYearId requis" },
      { status: 400 }
    );
  }

  // Build where clause
  const journalEntryWhere: Prisma.JournalEntryWhereInput = {
    fiscalYearId,
    journal: { companyId },
    status: { in: ["DRAFT", "VALIDATED"] },
    ...(startDate || endDate
      ? {
          entryDate: {
            ...(startDate ? { gte: new Date(startDate) } : {}),
            ...(endDate ? { lte: new Date(endDate) } : {}),
          },
        }
      : {}),
  };
  const entryWhere: Prisma.JournalEntryLineWhereInput = {
    companyId,
    ...(accountCode ? { accountCode } : {}),
    journalEntry: journalEntryWhere,
  };

  const lines = await prisma.journalEntryLine.findMany({
    where: entryWhere,
    select: {
      id: true,
      accountCode: true,
      label: true,
      debit: true,
      credit: true,
      account: {
        select: {
          code: true,
          label: true,
        },
      },
      journalEntry: {
        select: {
          id: true,
          entryNumber: true,
          entryDate: true,
          description: true,
          reference: true,
          journal: {
            select: {
              code: true,
              label: true,
            },
          },
        },
      },
    },
    orderBy: [
      { accountCode: "asc" },
      { journalEntry: { entryDate: "asc" } },
      { journalEntry: { entryNumber: "asc" } },
      { lineNumber: "asc" },
    ],
  });

  // Group by account and compute running balance per account
  const accountGroups = new Map<
    string,
    {
      accountCode: string;
      accountLabel: string;
      lines: Array<{
        id: string;
        date: string;
        journalCode: string;
        entryNumber: number;
        label: string;
        reference: string | null;
        debit: string;
        credit: string;
        runningBalance: string;
      }>;
      totalDebit: string;
      totalCredit: string;
      solde: string;
    }
  >();

  for (const line of lines) {
    const code = line.accountCode;
    let group = accountGroups.get(code);
    if (!group) {
      group = {
        accountCode: line.account.code,
        accountLabel: line.account.label,
        lines: [],
        totalDebit: "0.00",
        totalCredit: "0.00",
        solde: "0.00",
      };
      accountGroups.set(code, group);
    }

    // Compute running balance
    const prevBalance = group.lines.length > 0
      ? new Decimal(group.lines[group.lines.length - 1]!.runningBalance)
      : new Decimal(0);

    const debit = new Decimal(line.debit.toString());
    const credit = new Decimal(line.credit.toString());
    const runningBalance = prevBalance.plus(debit).minus(credit);

    group.lines.push({
      id: line.id,
      date: line.journalEntry.entryDate.toISOString(),
      journalCode: line.journalEntry.journal.code,
      entryNumber: line.journalEntry.entryNumber,
      label: line.label || line.journalEntry.description,
      reference: line.journalEntry.reference,
      debit: debit.toFixed(2),
      credit: credit.toFixed(2),
      runningBalance: runningBalance.toFixed(2),
    });

    // Update totals
    group.totalDebit = new Decimal(group.totalDebit).plus(debit).toFixed(2);
    group.totalCredit = new Decimal(group.totalCredit).plus(credit).toFixed(2);
    group.solde = runningBalance.toFixed(2);
  }

  // Sort accounts by code
  const accounts = Array.from(accountGroups.values()).sort((a, b) =>
    a.accountCode.localeCompare(b.accountCode)
  );

  return NextResponse.json({ accounts });
}
