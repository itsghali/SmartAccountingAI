import { prisma } from "@/server/prisma";
import { VATperiodType } from "@prisma/client";
import { computeVATDeclaration } from "./vat";
import Decimal from "decimal.js";

export async function syncVATDeclarationForDate(companyId: string, fiscalYearId: string, entryDate: Date) {
  try {
    const fiscalYear = await prisma.fiscalYear.findUnique({ where: { id: fiscalYearId } });
    if (!fiscalYear) return;

    // For now we assume MONTHLY. In a real app we'd check company settings for VAT regime.
    const periodType = VATperiodType.MONTHLY; 
    
    // Calculate periodIndex based on entryDate and fiscalYear.startDate
    // Both are dates. The difference in months:
    const monthDiff = (entryDate.getFullYear() - fiscalYear.startDate.getFullYear()) * 12 + (entryDate.getMonth() - fiscalYear.startDate.getMonth());
    const startPeriodIndex = monthDiff + 1;
    
    if (startPeriodIndex < 1 || startPeriodIndex > 12) return; // Out of bounds for this fiscal year

    for (let periodIndex = startPeriodIndex; periodIndex <= 12; periodIndex++) {
      // Check if the declaration exists and is already validated
      const existingDeclaration = await prisma.vATDeclaration.findUnique({
        where: {
          companyId_fiscalYearId_periodType_periodIndex: {
            companyId,
            fiscalYearId,
            periodType,
            periodIndex
          }
        }
      });

      if (existingDeclaration && existingDeclaration.status !== "DRAFT" && existingDeclaration.status !== "COMPUTED") {
        // It's validated/submitted/paid, we should NOT automatically overwrite it.
        // We also shouldn't blindly propagate changes through it, because the human validated numbers are locked.
        // But if they are locked, they define the new previousCredit for the next period.
        continue;
      }

      const year = fiscalYear.startDate.getFullYear();
      const month = fiscalYear.startDate.getMonth() + periodIndex - 1;
      const startDate = new Date(year, month, 1);
      const endDate = new Date(year, month + 1, 0);

      const previousDeclaration = await prisma.vATDeclaration.findFirst({
        where: {
          companyId,
          fiscalYearId,
          periodType,
          periodIndex: periodIndex - 1,
          isCredit: true,
        },
      });

      const previousCredit = previousDeclaration
        ? new Decimal(previousDeclaration.netVAT.toString())
        : new Decimal(0);

      const result = await computeVATDeclaration(
        companyId,
        fiscalYearId,
        startDate,
        endDate,
        previousCredit
      );

      await prisma.vATDeclaration.upsert({
        where: {
          companyId_fiscalYearId_periodType_periodIndex: {
            companyId,
            fiscalYearId,
            periodType,
            periodIndex,
          },
        },
        update: {
          startDate,
          endDate,
          outputVAT20: result.outputVAT20.toNumber(),
          outputVAT14: result.outputVAT14.toNumber(),
          outputVAT10: result.outputVAT10.toNumber(),
          outputVAT7: result.outputVAT7.toNumber(),
          totalOutputVAT: result.totalOutputVAT.toNumber(),
          inputVATAssets: result.inputVATAssets.toNumber(),
          inputVATExpenses: result.inputVATExpenses.toNumber(),
          totalInputVAT: result.totalInputVAT.toNumber(),
          netVAT: result.netVAT.toNumber(),
          isCredit: result.isCredit,
          status: "COMPUTED",
        },
        create: {
          companyId,
          fiscalYearId,
          periodType,
          periodIndex,
          startDate,
          endDate,
          regime: "DEBIT",
          outputVAT20: result.outputVAT20.toNumber(),
          outputVAT14: result.outputVAT14.toNumber(),
          outputVAT10: result.outputVAT10.toNumber(),
          outputVAT7: result.outputVAT7.toNumber(),
          totalOutputVAT: result.totalOutputVAT.toNumber(),
          inputVATAssets: result.inputVATAssets.toNumber(),
          inputVATExpenses: result.inputVATExpenses.toNumber(),
          totalInputVAT: result.totalInputVAT.toNumber(),
          netVAT: result.netVAT.toNumber(),
          isCredit: result.isCredit,
          status: "COMPUTED",
        },
      });
    }
  } catch (error) {
    console.error("Failed to auto-sync VAT:", error);
  }
}
