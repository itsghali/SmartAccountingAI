import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";
import Decimal from "decimal.js";

interface AgedTiersEntry {
  tiersName: string;
  accountCode: string;
  accountType: "client" | "fournisseur";
  totalBalance: Decimal;
  current: Decimal;
  days_0_30: Decimal;
  days_31_60: Decimal;
  days_61_90: Decimal;
  days_90_plus: Decimal;
}

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

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Fetch unlettered lines on accounts starting with 342 or 441
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

  // Bucket helper: returns number of days overdue (negative = not yet due)
  function daysOverdue(line: { dueDate: Date | null; journalEntry: { entryDate: Date } }): number {
    const referenceDate = line.dueDate ?? line.journalEntry.entryDate;
    const diff = today.getTime() - new Date(referenceDate).setHours(0, 0, 0, 0);
    return Math.floor(diff / (1000 * 60 * 60 * 24));
  }

  // Map: key = tiersName + "|" + accountCode
  const tiersMap = new Map<string, AgedTiersEntry>();

  for (const line of lines) {
    const tiers = line.tiersName ?? "Sans tiers";
    const key = `${tiers}|${line.accountCode}`;
    const accountType: "client" | "fournisseur" = line.accountCode.startsWith("342")
      ? "client"
      : "fournisseur";

    let entry = tiersMap.get(key);
    if (!entry) {
      entry = {
        tiersName: tiers,
        accountCode: line.accountCode,
        accountType,
        totalBalance: new Decimal(0),
        current: new Decimal(0),
        days_0_30: new Decimal(0),
        days_31_60: new Decimal(0),
        days_61_90: new Decimal(0),
        days_90_plus: new Decimal(0),
      };
      tiersMap.set(key, entry);
    }

    // For clients (342x): balance = debit - credit
    // For fournisseurs (441x): balance = credit - debit
    const debit = new Decimal(line.debit.toString());
    const credit = new Decimal(line.credit.toString());
    const lineBalance =
      accountType === "client"
        ? debit.minus(credit)
        : credit.minus(debit);

    entry.totalBalance = entry.totalBalance.plus(lineBalance);

    const overdueDays = daysOverdue(line);

    if (overdueDays <= 0) {
      entry.current = entry.current.plus(lineBalance);
    } else if (overdueDays <= 30) {
      entry.days_0_30 = entry.days_0_30.plus(lineBalance);
    } else if (overdueDays <= 60) {
      entry.days_31_60 = entry.days_31_60.plus(lineBalance);
    } else if (overdueDays <= 90) {
      entry.days_61_90 = entry.days_61_90.plus(lineBalance);
    } else {
      entry.days_90_plus = entry.days_90_plus.plus(lineBalance);
    }
  }

  const rows = Array.from(tiersMap.values())
    .filter((e) => !e.totalBalance.isZero())
    .sort((a, b) => a.accountCode.localeCompare(b.accountCode) || a.tiersName.localeCompare(b.tiersName))
    .map((e) => ({
      tiersName: e.tiersName,
      accountCode: e.accountCode,
      accountType: e.accountType,
      totalBalance: e.totalBalance.toFixed(2),
      current: e.current.toFixed(2),
      days_0_30: e.days_0_30.toFixed(2),
      days_31_60: e.days_31_60.toFixed(2),
      days_61_90: e.days_61_90.toFixed(2),
      days_90_plus: e.days_90_plus.toFixed(2),
    }));

  // Compute summary totals
  let totalReceivables = new Decimal(0);
  let totalPayables = new Decimal(0);
  let totalOverdue = new Decimal(0);

  for (const r of rows) {
    const bal = new Decimal(r.totalBalance);
    if (r.accountType === "client") {
      totalReceivables = totalReceivables.plus(bal);
    } else {
      totalPayables = totalPayables.plus(bal);
    }
    const overdue = new Decimal(r.days_0_30)
      .plus(r.days_31_60)
      .plus(r.days_61_90)
      .plus(r.days_90_plus);
    totalOverdue = totalOverdue.plus(overdue);
  }

  return NextResponse.json({
    rows,
    summary: {
      totalReceivables: totalReceivables.toFixed(2),
      totalPayables: totalPayables.toFixed(2),
      totalOverdue: totalOverdue.toFixed(2),
    },
    asOf: today.toISOString(),
  });
}
