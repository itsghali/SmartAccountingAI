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
  const startDate = params.get("startDate");
  const endDate = params.get("endDate");
  const status = params.get("status"); // DRAFT | VALIDATED | all

  if (!companyId || !fiscalYearId) {
    return NextResponse.json(
      { error: "companyId et fiscalYearId requis" },
      { status: 400 }
    );
  }

  // Build the where clause for journal entry lines
  const journalEntryWhere: Prisma.JournalEntryWhereInput = {
    fiscalYearId,
    journal: { companyId },
    status: status && status !== "all"
      ? (status as Prisma.JournalEntryWhereInput["status"])
      : { in: ["DRAFT", "VALIDATED"] },
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
    journalEntry: journalEntryWhere,
  };

  // Fetch all matching lines grouped by account
  const lines = await prisma.journalEntryLine.findMany({
    where: entryWhere,
    select: {
      accountCode: true,
      debit: true,
      credit: true,
      account: {
        select: {
          code: true,
          label: true,
          classNumber: true,
          accountType: true,
        },
      },
    },
  });

  // Aggregate by account code using Decimal for precision
  const accountMap = new Map<
    string,
    {
      code: string;
      label: string;
      classNumber: number;
      accountType: string;
      totalDebit: Decimal;
      totalCredit: Decimal;
    }
  >();

  for (const line of lines) {
    const code = line.accountCode;
    let entry = accountMap.get(code);
    if (!entry) {
      entry = {
        code: line.account.code,
        label: line.account.label,
        classNumber: line.account.classNumber,
        accountType: line.account.accountType,
        totalDebit: new Decimal(0),
        totalCredit: new Decimal(0),
      };
      accountMap.set(code, entry);
    }
    entry.totalDebit = entry.totalDebit.plus(new Decimal(line.debit.toString()));
    entry.totalCredit = entry.totalCredit.plus(new Decimal(line.credit.toString()));
  }

  // Build result sorted by account code
  const accounts = Array.from(accountMap.values())
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((acc) => {
      const solde = acc.totalDebit.minus(acc.totalCredit);
      return {
        code: acc.code,
        label: acc.label,
        classNumber: acc.classNumber,
        accountType: acc.accountType,
        totalDebit: acc.totalDebit.toFixed(2),
        totalCredit: acc.totalCredit.toFixed(2),
        soldeDebit: solde.isPositive() ? solde.toFixed(2) : "0.00",
        soldeCredit: solde.isNegative() ? solde.abs().toFixed(2) : "0.00",
      };
    });

  // Compute grand totals
  let grandTotalDebit = new Decimal(0);
  let grandTotalCredit = new Decimal(0);
  let grandSoldeDebit = new Decimal(0);
  let grandSoldeCredit = new Decimal(0);

  for (const acc of accounts) {
    grandTotalDebit = grandTotalDebit.plus(new Decimal(acc.totalDebit));
    grandTotalCredit = grandTotalCredit.plus(new Decimal(acc.totalCredit));
    grandSoldeDebit = grandSoldeDebit.plus(new Decimal(acc.soldeDebit));
    grandSoldeCredit = grandSoldeCredit.plus(new Decimal(acc.soldeCredit));
  }

  return NextResponse.json({
    accounts,
    totals: {
      totalDebit: grandTotalDebit.toFixed(2),
      totalCredit: grandTotalCredit.toFixed(2),
      soldeDebit: grandSoldeDebit.toFixed(2),
      soldeCredit: grandSoldeCredit.toFixed(2),
    },
  });
}
