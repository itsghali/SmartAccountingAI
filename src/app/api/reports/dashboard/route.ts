import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { checkPermission } from "@/server/permissions";
import { prisma } from "@/server/prisma";
import Decimal from "decimal.js";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  const companyId = params.get("companyId");
  const fiscalYearId = params.get("fiscalYearId");

  if (!companyId || !fiscalYearId) {
    return NextResponse.json(
      { error: "companyId et fiscalYearId requis" },
      { status: 400 }
    );
  }
  if (!(await checkPermission(companyId, "canAccessReports"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Verify company belongs to user's organization
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { organizationId: true },
  });

  if (!company || company.organizationId !== session.user.organizationId) {
    return NextResponse.json({ error: "Accès interdit" }, { status: 403 });
  }

  // Get fiscal year dates for monthly breakdown
  const fiscalYear = await prisma.fiscalYear.findUnique({
    where: { id: fiscalYearId },
  });

  if (!fiscalYear) {
    return NextResponse.json(
      { error: "Exercice comptable introuvable" },
      { status: 404 }
    );
  }

  const includeDrafts = params.get("includeDrafts") === "true";
  const includePriorYear = params.get("includePriorYear") === "true";

  // Fetch all journal entry lines for this fiscal year
  const lines = await prisma.journalEntryLine.findMany({
    where: {
      companyId,
      journalEntry: {
        fiscalYearId,
        status: includeDrafts
          ? { in: ["DRAFT", "VALIDATED", "REVERSED"] }
          : { in: ["VALIDATED", "REVERSED"] },
        ...(!includePriorYear ? { NOT: { sourceModule: "PRIOR_YEAR_COPY" } } : {}),
      },
    },
    select: {
      accountCode: true,
      debit: true,
      credit: true,
      journalEntry: {
        select: {
          entryDate: true,
        },
      },
      account: {
        select: {
          code: true,
          label: true,
          classNumber: true,
        },
      },
    },
  });

  // Compute KPIs
  let treasury = new Decimal(0); // Class 5: debit - credit
  let revenue = new Decimal(0); // Class 71: credit - debit
  let expenses = new Decimal(0); // Class 6: debit - credit
  let receivables = new Decimal(0); // Account 3421: debit - credit
  let payables = new Decimal(0); // Account 4411: credit - debit

  // Monthly data for charts
  const monthlyMap = new Map<
    string,
    { revenue: Decimal; expenses: Decimal }
  >();

  // Expense breakdown by class 6 sub-categories
  const expenseBreakdown = new Map<string, { label: string; amount: Decimal }>();

  for (const line of lines) {
    const classNum = line.account.classNumber;
    const code = line.accountCode;
    const debit = new Decimal(line.debit.toString());
    const credit = new Decimal(line.credit.toString());

    // Treasury: class 5 (debit - credit = balance)
    if (classNum === 5) {
      treasury = treasury.plus(debit).minus(credit);
    }

    // Revenue: class 71 credits minus debits
    if (code.startsWith("71")) {
      revenue = revenue.plus(credit).minus(debit);
    }

    // Expenses: class 6 debits minus credits
    if (classNum === 6) {
      expenses = expenses.plus(debit).minus(credit);

      // Expense breakdown by 2-digit prefix
      const prefix = code.substring(0, 2);
      let entry = expenseBreakdown.get(prefix);
      if (!entry) {
        const labels: Record<string, string> = {
          "61": "Charges d'exploitation",
          "63": "Charges financières",
          "65": "Charges non courantes",
          "67": "Impôts sur les résultats",
          "69": "Dotations d'exploitation",
        };
        entry = {
          label: labels[prefix] || `Classe 6 - ${prefix}`,
          amount: new Decimal(0),
        };
        expenseBreakdown.set(prefix, entry);
      }
      entry.amount = entry.amount.plus(debit).minus(credit);
    }

    // Receivables: account 3421 (debit balance)
    if (code.startsWith("3421")) {
      receivables = receivables.plus(debit).minus(credit);
    }

    // Payables: account 4411 (credit balance)
    if (code.startsWith("4411")) {
      payables = payables.plus(credit).minus(debit);
    }

    // Monthly breakdown
    const entryDate = new Date(line.journalEntry.entryDate);
    const monthKey = `${entryDate.getFullYear()}-${String(entryDate.getMonth() + 1).padStart(2, "0")}`;
    let monthEntry = monthlyMap.get(monthKey);
    if (!monthEntry) {
      monthEntry = { revenue: new Decimal(0), expenses: new Decimal(0) };
      monthlyMap.set(monthKey, monthEntry);
    }

    if (code.startsWith("71")) {
      monthEntry.revenue = monthEntry.revenue.plus(credit).minus(debit);
    }
    if (classNum === 6) {
      monthEntry.expenses = monthEntry.expenses.plus(debit).minus(credit);
    }
  }

  // Build monthly array sorted by month
  const monthNames = [
    "Jan", "Fév", "Mar", "Avr", "Mai", "Jun",
    "Jul", "Aoû", "Sep", "Oct", "Nov", "Déc",
  ];

  const monthlyData = Array.from(monthlyMap.entries())
    .sort(([a], [b]) => a!.localeCompare(b!))
    .map(([key, val]) => {
      const monthIndex = parseInt(key.split("-")[1]!) - 1;
      return {
        month: monthNames[monthIndex],
        revenue: parseFloat(val.revenue.toFixed(2)),
        expenses: parseFloat(val.expenses.toFixed(2)),
      };
    });

  // Build expense breakdown array
  const expenseCategories = Array.from(expenseBreakdown.entries())
    .sort(([a], [b]) => a!.localeCompare(b!))
    .map(([, val]) => ({
      name: val.label,
      value: parseFloat(val.amount.toFixed(2)),
    }));

  const result = new Decimal(revenue).minus(expenses);

  return NextResponse.json({
    kpis: {
      treasury: parseFloat(treasury.toFixed(2)),
      revenue: parseFloat(revenue.toFixed(2)),
      expenses: parseFloat(expenses.toFixed(2)),
      result: parseFloat(result.toFixed(2)),
      receivables: parseFloat(receivables.toFixed(2)),
      payables: parseFloat(payables.toFixed(2)),
    },
    monthlyData,
    expenseCategories,
  });
}
