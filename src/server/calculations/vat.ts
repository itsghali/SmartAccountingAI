import Decimal from "decimal.js";
import { prisma } from "@/server/prisma";

export interface VATComputationResult {
  taxableRevenue20: Decimal;
  taxableRevenue14: Decimal;
  taxableRevenue10: Decimal;
  taxableRevenue7: Decimal;
  exemptRevenue: Decimal;
  outputVAT20: Decimal;
  outputVAT14: Decimal;
  outputVAT10: Decimal;
  outputVAT7: Decimal;
  totalOutputVAT: Decimal;
  inputVATAssets: Decimal;
  inputVATExpenses: Decimal;
  totalInputVAT: Decimal;
  previousCredit: Decimal;
  netVAT: Decimal;
  isCredit: boolean;
}

export async function computeVATDeclaration(
  companyId: string,
  fiscalYearId: string,
  startDate: Date,
  endDate: Date,
  previousCredit: Decimal = new Decimal(0)
): Promise<VATComputationResult> {
  // Get all validated entries in the period
  const entries = await prisma.journalEntry.findMany({
    where: {
      fiscalYearId,
      journal: { companyId },
      status: "VALIDATED",
      entryDate: { gte: startDate, lte: endDate },
    },
    include: {
      lines: {
        include: { account: true },
      },
    },
  });

  let outputVAT20 = new Decimal(0);
  let outputVAT14 = new Decimal(0);
  let outputVAT10 = new Decimal(0);
  let outputVAT7 = new Decimal(0);
  let inputVATAssets = new Decimal(0);
  let inputVATExpenses = new Decimal(0);

  for (const entry of entries) {
    for (const line of entry.lines) {
      const { account } = line;
      const amount = new Decimal(line.credit.toString()).minus(line.debit.toString());

      if (account.vatType === "VAT_COLLECTED") {
        const rate = account.vatRate ? new Decimal(account.vatRate.toString()) : new Decimal(0);
        if (rate.eq(20)) outputVAT20 = outputVAT20.plus(amount);
        else if (rate.eq(14)) outputVAT14 = outputVAT14.plus(amount);
        else if (rate.eq(10)) outputVAT10 = outputVAT10.plus(amount);
        else if (rate.eq(7)) outputVAT7 = outputVAT7.plus(amount);
      }

      if (account.vatType === "VAT_DEDUCTIBLE_ASSETS") {
        inputVATAssets = inputVATAssets.plus(
          new Decimal(line.debit.toString()).minus(line.credit.toString())
        );
      }

      if (account.vatType === "VAT_DEDUCTIBLE_EXPENSES") {
        inputVATExpenses = inputVATExpenses.plus(
          new Decimal(line.debit.toString()).minus(line.credit.toString())
        );
      }
    }
  }

  const totalOutputVAT = outputVAT20.plus(outputVAT14).plus(outputVAT10).plus(outputVAT7);
  const totalInputVAT = inputVATAssets.plus(inputVATExpenses);
  const rawNet = totalOutputVAT.minus(totalInputVAT).minus(previousCredit);

  // Compute taxable revenue by back-calculating from VAT amounts
  const taxableRevenue20 = outputVAT20.div("0.20");
  const taxableRevenue14 = outputVAT14.div("0.14");
  const taxableRevenue10 = outputVAT10.div("0.10");
  const taxableRevenue7 = outputVAT7.div("0.07");

  return {
    taxableRevenue20,
    taxableRevenue14,
    taxableRevenue10,
    taxableRevenue7,
    exemptRevenue: new Decimal(0),
    outputVAT20,
    outputVAT14,
    outputVAT10,
    outputVAT7,
    totalOutputVAT,
    inputVATAssets,
    inputVATExpenses,
    totalInputVAT,
    previousCredit,
    netVAT: rawNet.abs(),
    isCredit: rawNet.lt(0),
  };
}
