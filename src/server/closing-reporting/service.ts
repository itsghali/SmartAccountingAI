import { AgentType, VATDeclarationStatus } from "@prisma/client";
import Decimal from "decimal.js";
import { agentRunner } from "@/server/agents";
import {
  closingReportingOutputSchema,
  type ClosingReportingOutput,
} from "@/server/agents/schemas";
import {
  computeTrialBalance,
  type AccountBalance,
} from "@/server/calculations/balance";
import { prisma } from "@/server/prisma";

const CLOSE_REPORTING_PROMPT =
  "Préparez une analyse de clôture périodique. Vérifiez la cohérence du grand livre, identifiez les rapprochements prioritaires et générez des brouillons de reporting ainsi qu'une checklist de clôture sans proposer de validation automatique.";

const GOVERNANCE_CONSTRAINT =
  "All closing entries are committed to the core only under human approval.";

const DEFAULT_REPORTING_REQUIREMENTS = [
  "Prepare a draft trial balance package for the selected fiscal year.",
  "Prepare draft balance-sheet and income-statement highlights from validated ledger data.",
  "Generate reconciliation prompts for customer, supplier, bank, VAT, and fixed-asset follow-up.",
  "Produce a close checklist that clearly separates blockers from items ready for human review.",
] as const;

function amount(value: Decimal.Value): number {
  return new Decimal(value).toDecimalPlaces(2).toNumber();
}

function isPrefixMatch(accountCode: string, prefixes: string[]) {
  return prefixes.some((prefix) => accountCode.startsWith(prefix));
}

function sumDebit(accounts: AccountBalance[], prefixes: string[]) {
  return accounts.reduce(
    (total, account) =>
      isPrefixMatch(account.accountCode, prefixes)
        ? total.plus(account.totalDebit)
        : total,
    new Decimal(0)
  );
}

function sumCredit(accounts: AccountBalance[], prefixes: string[]) {
  return accounts.reduce(
    (total, account) =>
      isPrefixMatch(account.accountCode, prefixes)
        ? total.plus(account.totalCredit)
        : total,
    new Decimal(0)
  );
}

function sumNetDebit(accounts: AccountBalance[], prefixes: string[]) {
  return sumDebit(accounts, prefixes).minus(sumCredit(accounts, prefixes));
}

function sumNetCredit(accounts: AccountBalance[], prefixes: string[]) {
  return sumCredit(accounts, prefixes).minus(sumDebit(accounts, prefixes));
}

function computeFinancialStatementSnapshot(accounts: AccountBalance[]) {
  const immobilisationsBrut = sumDebit(accounts, ["2"]);
  const amortisations = sumCredit(accounts, ["28", "29"]);
  const immobilisationsNet = immobilisationsBrut.minus(amortisations);
  const actifCirculantNet = sumNetDebit(accounts, ["3"]);
  const tresorerieActifNet = sumNetDebit(accounts, ["51", "516"]);
  const totalActif = immobilisationsNet
    .plus(actifCirculantNet)
    .plus(tresorerieActifNet);

  const financementPermanentNet = sumNetCredit(accounts, ["1"]);
  const passifCirculantNet = sumNetCredit(accounts, ["4"]);
  const tresoreriePassifNet = sumNetCredit(accounts, ["55"]);
  const totalPassif = financementPermanentNet
    .plus(passifCirculantNet)
    .plus(tresoreriePassifNet);

  const produitsExploitation = sumNetCredit(accounts, ["71"]);
  const chargesExploitation = sumNetDebit(accounts, ["61"]);
  const resultatExploitation = produitsExploitation.minus(chargesExploitation);

  const produitsFinanciers = sumNetCredit(accounts, ["73"]);
  const chargesFinancieres = sumNetDebit(accounts, ["63"]);
  const resultatFinancier = produitsFinanciers.minus(chargesFinancieres);

  const produitsNonCourants = sumNetCredit(accounts, ["75"]);
  const chargesNonCourantes = sumNetDebit(accounts, ["65"]);
  const resultatNonCourant = produitsNonCourants.minus(chargesNonCourantes);

  const impotsSurResultats = sumNetDebit(accounts, ["67"]);
  const resultatCourant = resultatExploitation.plus(resultatFinancier);
  const resultatNet = resultatCourant.plus(resultatNonCourant).minus(impotsSurResultats);

  return {
    totalActif,
    totalPassif,
    balanceGap: totalActif.minus(totalPassif),
    resultatExploitation,
    resultatCourant,
    resultatNet,
  };
}

async function getAgedBalanceSnapshot(companyId: string, fiscalYearId: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const lines = await prisma.journalEntryLine.findMany({
    where: {
      companyId,
      isLettered: false,
      journalEntry: {
        fiscalYearId,
        journal: { companyId },
        status: { in: ["DRAFT", "VALIDATED"] },
      },
      OR: [
        { accountCode: { startsWith: "342" } },
        { accountCode: { startsWith: "441" } },
      ],
    },
    select: {
      accountCode: true,
      debit: true,
      credit: true,
      tiersName: true,
      dueDate: true,
      journalEntry: {
        select: {
          entryDate: true,
        },
      },
    },
  });

  const rowsMap = new Map<
    string,
    {
      tiersName: string;
      accountCode: string;
      accountType: "client" | "fournisseur";
      totalBalance: Decimal;
      overdueAmount: Decimal;
    }
  >();

  for (const line of lines) {
    const accountType: "client" | "fournisseur" = line.accountCode.startsWith("342")
      ? "client"
      : "fournisseur";
    const tiersName = line.tiersName ?? "Sans tiers";
    const key = `${tiersName}|${line.accountCode}`;
    const debit = new Decimal(line.debit.toString());
    const credit = new Decimal(line.credit.toString());
    const balance =
      accountType === "client" ? debit.minus(credit) : credit.minus(debit);
    const dueDate = line.dueDate ?? line.journalEntry.entryDate;
    const overdueDays = Math.floor(
      (today.getTime() - new Date(dueDate).setHours(0, 0, 0, 0)) /
        (1000 * 60 * 60 * 24)
    );

    const existing = rowsMap.get(key) ?? {
      tiersName,
      accountCode: line.accountCode,
      accountType,
      totalBalance: new Decimal(0),
      overdueAmount: new Decimal(0),
    };

    existing.totalBalance = existing.totalBalance.plus(balance);
    if (overdueDays > 0) {
      existing.overdueAmount = existing.overdueAmount.plus(balance);
    }

    rowsMap.set(key, existing);
  }

  const rows = [...rowsMap.values()]
    .filter((row) => !row.totalBalance.isZero())
    .sort(
      (left, right) =>
        right.overdueAmount.abs().comparedTo(left.overdueAmount.abs()) ||
        right.totalBalance.abs().comparedTo(left.totalBalance.abs())
    );

  const totalReceivables = rows
    .filter((row) => row.accountType === "client")
    .reduce((total, row) => total.plus(row.totalBalance), new Decimal(0));
  const totalPayables = rows
    .filter((row) => row.accountType === "fournisseur")
    .reduce((total, row) => total.plus(row.totalBalance), new Decimal(0));
  const totalOverdue = rows.reduce(
    (total, row) => total.plus(row.overdueAmount),
    new Decimal(0)
  );

  return {
    agedBalanceSummary: {
      totalReceivables: amount(totalReceivables),
      totalPayables: amount(totalPayables),
      totalOverdue: amount(totalOverdue),
      rowsCount: rows.length,
    },
    largestOpenItems: rows.slice(0, 8).map((row) => ({
      tiersName: row.tiersName,
      accountCode: row.accountCode,
      accountType: row.accountType,
      totalBalance: amount(row.totalBalance),
      overdueAmount: amount(row.overdueAmount),
    })),
    tiersReconciliation: {
      unletteredCustomerLines: lines.filter((line) =>
        line.accountCode.startsWith("342")
      ).length,
      unletteredSupplierLines: lines.filter((line) =>
        line.accountCode.startsWith("441")
      ).length,
    },
  };
}

async function getBankReconciliationSnapshot(
  companyId: string,
  startDate: Date,
  endDate: Date
) {
  const lines = await prisma.bankStatementLine.findMany({
    where: {
      isReconciled: false,
      transactionDate: {
        gte: startDate,
        lte: endDate,
      },
      bankStatement: {
        companyId,
      },
    },
    orderBy: {
      transactionDate: "desc",
    },
    select: {
      description: true,
      transactionDate: true,
      debit: true,
      credit: true,
    },
  });

  const unreconciledMovementTotal = lines.reduce((total, line) => {
    const debit = new Decimal(line.debit.toString());
    const credit = new Decimal(line.credit.toString());
    return total.plus(Decimal.max(debit, credit));
  }, new Decimal(0));

  return {
    unreconciledLineCount: lines.length,
    unreconciledMovementTotal: amount(unreconciledMovementTotal),
    sampleLines: lines.slice(0, 5).map((line) => ({
      description: line.description,
      transactionDate: line.transactionDate.toISOString(),
      amount: amount(
        Decimal.max(
          new Decimal(line.debit.toString()),
          new Decimal(line.credit.toString())
        )
      ),
    })),
  };
}

async function buildPeriodSnapshot(
  companyId: string,
  fiscalYear: {
    id: string;
    label: string;
    startDate: Date;
    endDate: Date;
    status: string;
  }
) {
  const trialBalance = await computeTrialBalance(
    companyId,
    fiscalYear.id,
    undefined,
    undefined,
    "VALIDATED"
  );

  const [
    draftEntries,
    validatedCount,
    closingCount,
    lastValidatedEntry,
    pendingSuggestionCount,
    pendingFixedAssetAmortizations,
    vatDeclarations,
    taxPackage,
    agedBalance,
    bankReconciliation,
  ] = await Promise.all([
    prisma.journalEntry.findMany({
      where: {
        fiscalYearId: fiscalYear.id,
        journal: { companyId },
        status: "DRAFT",
      },
      select: {
        id: true,
        totalDebit: true,
        totalCredit: true,
      },
    }),
    prisma.journalEntry.count({
      where: {
        fiscalYearId: fiscalYear.id,
        journal: { companyId },
        status: "VALIDATED",
      },
    }),
    prisma.journalEntry.count({
      where: {
        fiscalYearId: fiscalYear.id,
        journal: {
          companyId,
          type: "CLOSING",
        },
        status: {
          in: ["DRAFT", "VALIDATED"],
        },
      },
    }),
    prisma.journalEntry.findFirst({
      where: {
        fiscalYearId: fiscalYear.id,
        journal: { companyId },
        status: "VALIDATED",
      },
      orderBy: {
        entryDate: "desc",
      },
      select: {
        entryDate: true,
      },
    }),
    prisma.suggestion.count({
      where: {
        companyId,
        isCurrent: true,
        status: "PENDING",
      },
    }),
    prisma.fixedAssetAmortization.count({
      where: {
        fiscalYearId: fiscalYear.id,
        isPosted: false,
      },
    }),
    prisma.vATDeclaration.findMany({
      where: {
        companyId,
        fiscalYearId: fiscalYear.id,
      },
      select: {
        status: true,
      },
    }),
    prisma.taxPackage.findUnique({
      where: {
        companyId_fiscalYearId: {
          companyId,
          fiscalYearId: fiscalYear.id,
        },
      },
      select: {
        status: true,
      },
    }),
    getAgedBalanceSnapshot(companyId, fiscalYear.id),
    getBankReconciliationSnapshot(
      companyId,
      fiscalYear.startDate,
      fiscalYear.endDate
    ),
  ]);

  const financialStatements = computeFinancialStatementSnapshot(trialBalance.accounts);
  const trialBalanceDifference = trialBalance.totalDebit.minus(trialBalance.totalCredit);
  const draftImbalanceCount = draftEntries.filter((entry) => {
    const totalDebit = new Decimal(entry.totalDebit.toString());
    const totalCredit = new Decimal(entry.totalCredit.toString());
    return !totalDebit.equals(totalCredit);
  }).length;

  const vatStatusCounts = vatDeclarations.reduce<Record<VATDeclarationStatus, number>>(
    (counts, declaration) => {
      counts[declaration.status] += 1;
      return counts;
    },
    {
      DRAFT: 0,
      COMPUTED: 0,
      VALIDATED: 0,
      SUBMITTED: 0,
      PAID: 0,
    }
  );

  return {
    fiscalYear: {
      id: fiscalYear.id,
      label: fiscalYear.label,
      startDate: fiscalYear.startDate.toISOString(),
      endDate: fiscalYear.endDate.toISOString(),
      status: fiscalYear.status,
    },
    ledgerState: {
      entries: {
        validatedCount,
        draftCount: draftEntries.length,
        closingCount,
        draftImbalanceCount,
        lastValidatedEntryDate: lastValidatedEntry?.entryDate.toISOString() ?? null,
      },
      trialBalance: {
        totalDebit: amount(trialBalance.totalDebit),
        totalCredit: amount(trialBalance.totalCredit),
        difference: amount(trialBalanceDifference),
        balanced: trialBalanceDifference.abs().lte(0.01),
        topAccounts: [...trialBalance.accounts]
          .sort((left, right) => {
            const leftMagnitude = Decimal.max(left.soldeDebit, left.soldeCredit);
            const rightMagnitude = Decimal.max(right.soldeDebit, right.soldeCredit);
            return rightMagnitude.comparedTo(leftMagnitude);
          })
          .slice(0, 12)
          .map((account) => ({
            accountCode: account.accountCode,
            accountLabel: account.accountLabel,
            soldeDebit: amount(account.soldeDebit),
            soldeCredit: amount(account.soldeCredit),
          })),
      },
      financialStatements: {
        totalActif: amount(financialStatements.totalActif),
        totalPassif: amount(financialStatements.totalPassif),
        balanceGap: amount(financialStatements.balanceGap),
        resultatExploitation: amount(financialStatements.resultatExploitation),
        resultatCourant: amount(financialStatements.resultatCourant),
        resultatNet: amount(financialStatements.resultatNet),
      },
      compliance: {
        pendingSuggestionCount,
        pendingFixedAssetAmortizations,
        draftVatDeclarations: vatStatusCounts.DRAFT,
        computedVatDeclarations: vatStatusCounts.COMPUTED,
        taxPackageStatus: taxPackage?.status ?? null,
      },
    },
    openItems: {
      ...agedBalance,
      bankReconciliation,
    },
  };
}

async function resolveFiscalYear(companyId: string, fiscalYearId?: string) {
  if (fiscalYearId) {
    return prisma.fiscalYear.findFirst({
      where: {
        id: fiscalYearId,
        companyId,
      },
      select: {
        id: true,
        label: true,
        startDate: true,
        endDate: true,
        status: true,
      },
    });
  }

  return prisma.fiscalYear.findFirst({
    where: {
      companyId,
    },
    orderBy: [{ isDefault: "desc" }, { startDate: "desc" }],
    select: {
      id: true,
      label: true,
      startDate: true,
      endDate: true,
      status: true,
    },
  });
}

export interface RunClosingReportingInput {
  companyId: string;
  userId: string;
  fiscalYearId?: string;
  userPrompt?: string;
}

export interface ClosingReportingResponse {
  runId: string;
  modelVersion: string;
  durationMs: number;
  summary: string;
  suggestions: ClosingReportingOutput["suggestions"];
  governance: ClosingReportingOutput["governance"];
  snapshot: {
    fiscalYear: {
      id: string;
      label: string;
      startDate: string;
      endDate: string;
      status: string;
    };
    ledgerState: {
      entries: {
        validatedCount: number;
        draftCount: number;
        closingCount: number;
        draftImbalanceCount: number;
        lastValidatedEntryDate: string | null;
      };
      trialBalance: {
        totalDebit: number;
        totalCredit: number;
        difference: number;
        balanced: boolean;
        topAccounts: Array<{
          accountCode: string;
          accountLabel: string;
          soldeDebit: number;
          soldeCredit: number;
        }>;
      };
      financialStatements: {
        totalActif: number;
        totalPassif: number;
        balanceGap: number;
        resultatExploitation: number;
        resultatCourant: number;
        resultatNet: number;
      };
      compliance: {
        pendingSuggestionCount: number;
        pendingFixedAssetAmortizations: number;
        draftVatDeclarations: number;
        computedVatDeclarations: number;
        taxPackageStatus: string | null;
      };
    };
    openItems: {
      agedBalanceSummary: {
        totalReceivables: number;
        totalPayables: number;
        totalOverdue: number;
        rowsCount: number;
      };
      largestOpenItems: Array<{
        tiersName: string;
        accountCode: string;
        accountType: "client" | "fournisseur";
        totalBalance: number;
        overdueAmount: number;
      }>;
      bankReconciliation: {
        unreconciledLineCount: number;
        unreconciledMovementTotal: number;
        sampleLines: Array<{
          description: string;
          transactionDate: string;
          amount: number;
        }>;
      };
      tiersReconciliation: {
        unletteredCustomerLines: number;
        unletteredSupplierLines: number;
      };
    };
    priorPeriod: {
      label: string;
      totalActif: number;
      totalPassif: number;
      balanceGap: number;
      resultatNet: number;
      totalOverdue: number;
    } | null;
    reportingRequirements: string[];
    governanceConstraint: string;
  };
}

export async function runClosingReporting({
  companyId,
  userId,
  fiscalYearId,
  userPrompt,
}: RunClosingReportingInput): Promise<ClosingReportingResponse> {
  const currentFiscalYear = await resolveFiscalYear(companyId, fiscalYearId);

  if (!currentFiscalYear) {
    throw new Error("Fiscal year not found for this company.");
  }

  const previousFiscalYear = await prisma.fiscalYear.findFirst({
    where: {
      companyId,
      endDate: {
        lt: currentFiscalYear.startDate,
      },
    },
    orderBy: {
      endDate: "desc",
    },
    select: {
      id: true,
      label: true,
      startDate: true,
      endDate: true,
      status: true,
    },
  });

  const [currentSnapshot, previousSnapshot] = await Promise.all([
    buildPeriodSnapshot(companyId, currentFiscalYear),
    previousFiscalYear
      ? buildPeriodSnapshot(companyId, previousFiscalYear)
      : Promise.resolve(null),
  ]);

  const priorPeriod = previousSnapshot
    ? {
        label: previousSnapshot.fiscalYear.label,
        totalActif: previousSnapshot.ledgerState.financialStatements.totalActif,
        totalPassif: previousSnapshot.ledgerState.financialStatements.totalPassif,
        balanceGap: previousSnapshot.ledgerState.financialStatements.balanceGap,
        resultatNet: previousSnapshot.ledgerState.financialStatements.resultatNet,
        totalOverdue: previousSnapshot.openItems.agedBalanceSummary.totalOverdue,
      }
    : null;

  const reportingRequirements = [...DEFAULT_REPORTING_REQUIREMENTS];
  const inputData = {
    fiscalYearId: currentSnapshot.fiscalYear.id,
    fiscalYear: currentSnapshot.fiscalYear,
    ledgerState: currentSnapshot.ledgerState,
    openItems: currentSnapshot.openItems,
    priorPeriod,
    reportingRequirements,
    governanceConstraint: GOVERNANCE_CONSTRAINT,
  };

  const result = await agentRunner.run(companyId, userId, {
    agentType: AgentType.CLOSING_REPORTING,
    userPrompt: userPrompt?.trim() || CLOSE_REPORTING_PROMPT,
    inputData,
  });

  if (!result.success || !result.output) {
    throw new Error(result.error || "Closing & reporting analysis failed.");
  }

  const output = closingReportingOutputSchema.parse(result.output);

  return {
    runId: result.runId,
    modelVersion: result.modelVersion,
    durationMs: result.durationMs,
    summary: output.summary,
    suggestions: output.suggestions,
    governance: output.governance,
    snapshot: {
      fiscalYear: currentSnapshot.fiscalYear,
      ledgerState: currentSnapshot.ledgerState,
      openItems: currentSnapshot.openItems,
      priorPeriod,
      reportingRequirements,
      governanceConstraint: GOVERNANCE_CONSTRAINT,
    },
  };
}
