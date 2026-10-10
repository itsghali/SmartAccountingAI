import { prisma } from "@/server/prisma";
import Decimal from "decimal.js";
import {
  AgentContext,
  TenantConfig,
  JurisdictionContext,
  HistoricalPatterns,
} from "../types";

export interface ContextBuildOptions {
  includeHistoricalPatterns?: boolean;
  patternLimit?: number;
  fiscalYearId?: string;
}

export class ContextBuilder {
  async buildContext(
    companyId: string,
    userId: string,
    userPrompt: string,
    inputData: Record<string, unknown> = {},
    options: ContextBuildOptions = {}
  ): Promise<AgentContext> {
    const [tenant, jurisdiction] = await Promise.all([
      this.buildTenantConfig(companyId, userId, options.fiscalYearId),
      this.buildJurisdictionContext(companyId),
    ]);

    let patterns: HistoricalPatterns | undefined;
    if (options.includeHistoricalPatterns) {
      patterns = await this.buildHistoricalPatterns(
        companyId,
        options.fiscalYearId,
        options.patternLimit || 10
      );
    }

    return {
      tenant,
      jurisdiction,
      patterns,
      userPrompt,
      inputData,
    };
  }

  private async buildTenantConfig(
    companyId: string,
    userId: string,
    fiscalYearId?: string
  ): Promise<TenantConfig> {
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: {
        id: true,
        organizationId: true,
        name: true,
        legalForm: true,
        chartType: true,
        currency: true,
        ice: true,
        rc: true,
        patente: true,
        fiscalYears: {
          where: fiscalYearId ? { id: fiscalYearId } : { isDefault: true },
          take: 1,
          select: {
            id: true,
            label: true,
            startDate: true,
            endDate: true,
            status: true,
          },
        },
      },
    });

    if (!company) {
      throw new Error(`Company not found: ${companyId}`);
    }

    return {
      companyId: company.id,
      organizationId: company.organizationId,
      userId,
      company: {
        name: company.name,
        legalForm: company.legalForm,
        chartType: company.chartType,
        currency: company.currency,
        ice: company.ice,
        rc: company.rc,
        patente: company.patente,
      },
      fiscalYear: company.fiscalYears[0] || null,
    };
  }

  private async buildJurisdictionContext(
    companyId: string
  ): Promise<JurisdictionContext> {
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: {
        chartType: true,
        vatDeclarations: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            regime: true,
            periodType: true,
          },
        },
      },
    });

    if (!company) {
      throw new Error(`Company not found: ${companyId}`);
    }

    const latestVat = company.vatDeclarations[0];

    return {
      country: "MA",
      regime: latestVat?.regime,
      vatPeriodicity: latestVat?.periodType,
      chartType: company.chartType,
    };
  }

  private async buildHistoricalPatterns(
    companyId: string,
    fiscalYearId: string | undefined,
    limit: number
  ): Promise<HistoricalPatterns> {
    const fyFilter = fiscalYearId ? { fiscalYearId } : {};

    const [commonAccounts, recentEntries, vatDeclarations] = await Promise.all([
      this.getCommonAccounts(companyId, limit),
      this.getRecentEntries(companyId, fyFilter, limit),
      prisma.vATDeclaration.findMany({
        where: { companyId },
        orderBy: { createdAt: "desc" },
        take: 6,
        select: {
          taxableRevenue20: true,
          taxableRevenue14: true,
          taxableRevenue10: true,
          taxableRevenue7: true,
        },
      }),
    ]);

    const vatRatesUsed = [7, 10, 14, 20].filter((rate) =>
      vatDeclarations.some(
        (d) =>
          (rate === 20 && d.taxableRevenue20.gt(0)) ||
          (rate === 14 && d.taxableRevenue14.gt(0)) ||
          (rate === 10 && d.taxableRevenue10.gt(0)) ||
          (rate === 7 && d.taxableRevenue7.gt(0))
      )
    );

    const avgRevenue =
      vatDeclarations.length > 0
        ? vatDeclarations
            .reduce(
              (sum, d) =>
                sum
                  .add(d.taxableRevenue20)
                  .add(d.taxableRevenue14)
                  .add(d.taxableRevenue10)
                  .add(d.taxableRevenue7),
              new Decimal(0)
            )
            .div(vatDeclarations.length)
        : undefined;

    return {
      commonAccounts,
      recentEntries,
      vatRatesUsed,
      averageMonthlyRevenue: avgRevenue,
    };
  }

  private async getCommonAccounts(
    companyId: string,
    limit: number
  ): Promise<HistoricalPatterns["commonAccounts"]> {
    const lines = await prisma.journalEntryLine.findMany({
      where: {
        companyId,
        journalEntry: { status: "VALIDATED" },
      },
      select: {
        accountCode: true,
        account: { select: { label: true } },
      },
      take: 1000,
    });

    const usageMap = new Map<string, { label: string; count: number }>();
    for (const line of lines) {
      const existing = usageMap.get(line.accountCode);
      if (existing) {
        existing.count++;
      } else {
        usageMap.set(line.accountCode, { label: line.account.label, count: 1 });
      }
    }

    return Array.from(usageMap.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, limit)
      .map(([code, data]) => ({
        code,
        label: data.label,
        usageCount: data.count,
      }));
  }

  private async getRecentEntries(
    companyId: string,
    fyFilter: Record<string, string | undefined>,
    limit: number
  ): Promise<HistoricalPatterns["recentEntries"]> {
    // fyFilter may contain { fiscalYearId } or be empty. For filtering on a required
    // to-one relation (fiscalYear) use the `is` operator with an object matching
    // FiscalYear fields. Do not pass unknown keys directly at the relation level.
    const fiscalYearWhere: Record<string, unknown> = { companyId };
    if (fyFilter && typeof fyFilter.fiscalYearId === "string") {
      fiscalYearWhere.id = fyFilter.fiscalYearId;
    }

    const entries = await prisma.journalEntry.findMany({
      where: {
        fiscalYear: { is: fiscalYearWhere },
        status: "VALIDATED",
      },
      orderBy: { entryDate: "desc" },
      take: limit,
      select: {
        description: true,
        entryDate: true,
        lines: {
          select: {
            accountCode: true,
            debit: true,
            credit: true,
          },
        },
      },
    });

    return entries.map((e) => ({
      description: e.description,
      accountCodes: e.lines.map((l) => l.accountCode),
      totalAmount: e.lines.reduce(
        (sum, l) => sum.add(l.debit).add(l.credit),
        new Decimal(0)
      ),
      date: e.entryDate,
    }));
  }

  sanitizeForAgent(context: AgentContext): Record<string, unknown> {
    const sanitized: Record<string, unknown> = {
      tenant: {
        company: {
          name: context.tenant.company.name,
          legalForm: context.tenant.company.legalForm,
          chartType: context.tenant.company.chartType,
          currency: context.tenant.company.currency,
        },
        fiscalYear: context.tenant.fiscalYear
          ? {
              label: context.tenant.fiscalYear.label,
              startDate: context.tenant.fiscalYear.startDate.toISOString(),
              endDate: context.tenant.fiscalYear.endDate.toISOString(),
              status: context.tenant.fiscalYear.status,
            }
          : null,
      },
      jurisdiction: context.jurisdiction,
    };

    if (context.patterns) {
      sanitized.patterns = {
        commonAccounts: context.patterns.commonAccounts,
        vatRatesUsed: context.patterns.vatRatesUsed,
        averageMonthlyRevenue: context.patterns.averageMonthlyRevenue?.toNumber(),
        recentEntryDescriptions: context.patterns.recentEntries.map(
          (e) => e.description
        ),
      };
    }

    return sanitized;
  }
}

export const contextBuilder = new ContextBuilder();
