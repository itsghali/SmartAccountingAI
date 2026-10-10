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
  statusFilter?: "VALIDATED" | "DRAFT" | undefined
): Promise<TrialBalanceResult> {
  const whereClause: Prisma.JournalEntryLineWhereInput = {
    journalEntry: {
      fiscalYearId,
      journal: { companyId },
      ...(startDate && endDate
        ? { entryDate: { gte: startDate, lte: endDate } }
        : {}),
      ...(statusFilter ? { status: statusFilter } : {}),
    },
    companyId,
  };

  const lines = await prisma.journalEntryLine.findMany({
    where: whereClause,
    include: { account: true },
  });

  const balanceMap = new Map<string, AccountBalance>();

  for (const line of lines) {
    const key = line.accountCode;
    const existing = balanceMap.get(key) || {
      accountCode: line.accountCode,
      accountLabel: line.account.label,
      classNumber: line.account.classNumber,
      totalDebit: new Decimal(0),
      totalCredit: new Decimal(0),
      soldeDebit: new Decimal(0),
      soldeCredit: new Decimal(0),
    };

    existing.totalDebit = existing.totalDebit.plus(line.debit.toString());
    existing.totalCredit = existing.totalCredit.plus(line.credit.toString());

    const solde = existing.totalDebit.minus(existing.totalCredit);
    existing.soldeDebit = solde.gt(0) ? solde : new Decimal(0);
    existing.soldeCredit = solde.lt(0) ? solde.abs() : new Decimal(0);

    balanceMap.set(key, existing);
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
