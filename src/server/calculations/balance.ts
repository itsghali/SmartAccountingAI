import Decimal from "decimal.js";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/prisma";

export interface AccountBalance {
  accountCode: string;
  accountLabel: string;
  classNumber: number;
  totalDebit: Decimal;
  totalCredit: Decimal;
  soldeDebit: Decimal;
  soldeCredit: Decimal;
}

export interface TrialBalanceResult {
  accounts: AccountBalance[];
  totalDebit: Decimal;
  totalCredit: Decimal;
  totalSoldeDebit: Decimal;
  totalSoldeCredit: Decimal;
}

export async function computeTrialBalance(
  companyId: string,
  fiscalYearId: string,
  startDate?: Date,
  endDate?: Date,
  statusFilter?: "VALIDATED" | "DRAFT" | "ALL" | undefined,
  includePriorYearCopy: boolean = false
): Promise<TrialBalanceResult> {
  let statusCondition: Prisma.EnumEntryStatusFilter | { in: ("VALIDATED" | "REVERSED")[] } | "DRAFT" | undefined;
  if (statusFilter === "DRAFT") {
    statusCondition = "DRAFT";
  } else if (statusFilter === "ALL") {
    statusCondition = undefined;
  } else {
    // Default or "VALIDATED": include all finalized/committed entries
    statusCondition = { in: ["VALIDATED", "REVERSED"] };
  }

  const whereClause: Prisma.JournalEntryLineWhereInput = {
    journalEntry: {
      fiscalYearId,
      journal: { companyId },
      ...(startDate && endDate
        ? { entryDate: { gte: startDate, lte: endDate } }
        : {}),
      ...(statusCondition ? { status: statusCondition } : {}),
      ...(!includePriorYearCopy ? { NOT: { sourceModule: "PRIOR_YEAR_COPY" } } : {}),
    },
    companyId,
  };

  const groupedLines = await prisma.journalEntryLine.groupBy({
    by: ["accountCode", "companyId"],
    where: whereClause,
    _sum: {
      debit: true,
      credit: true,
    },
  });

  // Fetch account details for the grouped codes
  const accountCodes = groupedLines.map((g) => g.accountCode);
  const accountsData = await prisma.account.findMany({
    where: { companyId, code: { in: accountCodes } },
    select: { code: true, label: true, classNumber: true },
  });
  
  const accountMap = new Map(accountsData.map((a) => [a.code, a]));

  const balanceMap = new Map<string, AccountBalance>();

  for (const group of groupedLines) {
    const account = accountMap.get(group.accountCode);
    if (!account) continue;

    const key = group.accountCode;
    const totalDebit = new Decimal(group._sum.debit?.toString() || 0);
    const totalCredit = new Decimal(group._sum.credit?.toString() || 0);
    const solde = totalDebit.minus(totalCredit);

    balanceMap.set(key, {
      accountCode: key,
      accountLabel: account.label,
      classNumber: account.classNumber,
      totalDebit,
      totalCredit,
      soldeDebit: solde.gt(0) ? solde : new Decimal(0),
      soldeCredit: solde.lt(0) ? solde.abs() : new Decimal(0),
    });
  }

  const accounts = Array.from(balanceMap.values()).sort((a, b) =>
    a.accountCode.localeCompare(b.accountCode)
  );

  const totalDebit = accounts.reduce((sum, a) => sum.plus(a.totalDebit), new Decimal(0));
  const totalCredit = accounts.reduce((sum, a) => sum.plus(a.totalCredit), new Decimal(0));
  const totalSoldeDebit = accounts.reduce((sum, a) => sum.plus(a.soldeDebit), new Decimal(0));
  const totalSoldeCredit = accounts.reduce((sum, a) => sum.plus(a.soldeCredit), new Decimal(0));

  return { accounts, totalDebit, totalCredit, totalSoldeDebit, totalSoldeCredit };
}
