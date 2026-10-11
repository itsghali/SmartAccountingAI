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

  if (!(await checkPermission(companyId, "canAccessReports"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // ── VAT Declarations ────────────────────────────────────────────────────────
  const declarations = await prisma.vATDeclaration.findMany({
    where: { companyId, fiscalYearId },
    orderBy: [{ periodType: "asc" }, { periodIndex: "asc" }],
    select: {
      id: true,
      regime: true,
      periodType: true,
      periodIndex: true,
      startDate: true,
      endDate: true,
      totalOutputVAT: true,
      totalInputVAT: true,
      previousCredit: true,
      netVAT: true,
      isCredit: true,
      status: true,
      submissionDate: true,
      paymentDate: true,
    },
  });

  const includeDrafts = request.nextUrl.searchParams.get("includeDrafts") === "true";
  const includePriorYear = request.nextUrl.searchParams.get("includePriorYear") === "true";

  // ── Monthly VAT from journal lines ──────────────────────────────────────────
  // TVA collectée = accounts 4455x (credit > debit)
  // TVA déductible = accounts 3455x (debit > credit)
  const vatLines = await prisma.journalEntryLine.findMany({
    where: {
      companyId,
      journalEntry: {
        fiscalYearId,
        journal: { companyId },
        status: includeDrafts
          ? { in: ["DRAFT", "VALIDATED", "REVERSED"] }
          : { in: ["VALIDATED", "REVERSED"] },
        ...(!includePriorYear ? { NOT: { sourceModule: "PRIOR_YEAR_COPY" } } : {}),
      },
      OR: [
        { accountCode: { startsWith: "4455" } },
        { accountCode: { startsWith: "3455" } },
      ],
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
    },
  });

  // Group by year-month
  const monthlyMap = new Map<
    string,
    { month: string; collected: Decimal; deductible: Decimal }
  >();

  for (const line of vatLines) {
    const date = new Date(line.journalEntry.entryDate);
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

    let entry = monthlyMap.get(monthKey);
    if (!entry) {
      entry = { month: monthKey, collected: new Decimal(0), deductible: new Decimal(0) };
      monthlyMap.set(monthKey, entry);
    }

    const debit = new Decimal(line.debit.toString());
    const credit = new Decimal(line.credit.toString());

    if (line.accountCode.startsWith("4455")) {
      // TVA collectée: credit side
      entry.collected = entry.collected.plus(credit).minus(debit);
    } else if (line.accountCode.startsWith("3455")) {
      // TVA déductible: debit side
      entry.deductible = entry.deductible.plus(debit).minus(credit);
    }
  }

  const monthly = Array.from(monthlyMap.values())
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((m) => ({
      month: m.month,
      collected: m.collected.toFixed(2),
      deductible: m.deductible.toFixed(2),
      net: m.collected.minus(m.deductible).toFixed(2),
    }));

  // ── Summary totals ───────────────────────────────────────────────────────────
  let totalCollected = new Decimal(0);
  let totalDeductible = new Decimal(0);

  for (const m of monthly) {
    totalCollected = totalCollected.plus(m.collected);
    totalDeductible = totalDeductible.plus(m.deductible);
  }

  const netBalance = totalCollected.minus(totalDeductible);

  return NextResponse.json({
    declarations: declarations.map((d) => ({
      id: d.id,
      regime: d.regime,
      periodType: d.periodType,
      periodIndex: d.periodIndex,
      startDate: d.startDate.toISOString(),
      endDate: d.endDate.toISOString(),
      totalOutputVAT: d.totalOutputVAT.toString(),
      totalInputVAT: d.totalInputVAT.toString(),
      previousCredit: d.previousCredit.toString(),
      netVAT: d.netVAT.toString(),
      isCredit: d.isCredit,
      status: d.status,
      submissionDate: d.submissionDate?.toISOString() ?? null,
      paymentDate: d.paymentDate?.toISOString() ?? null,
    })),
    monthly,
    summary: {
      totalCollected: totalCollected.toFixed(2),
      totalDeductible: totalDeductible.toFixed(2),
      netBalance: netBalance.toFixed(2),
    },
  });
}
