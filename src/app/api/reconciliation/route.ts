import { NextRequest, NextResponse } from "next/server";
import type { LettrageGroup, Prisma } from "@prisma/client";
import { auth } from "@/server/auth";
import { checkPermission } from "@/server/permissions";
import { prisma } from "@/server/prisma";
import Decimal from "decimal.js";

// Generate the next lettrage code for an account (A, B, ..., Z, AA, AB, ...)
function getNextLettrageCode(existingCodes: string[]): string {
  if (existingCodes.length === 0) return "A";

  const sortedCodes = [...existingCodes].sort((a, b) => {
    if (a.length !== b.length) return a.length - b.length;
    return a.localeCompare(b);
  });

  const lastCode = sortedCodes[sortedCodes.length - 1]!;

  // Increment the code like an alphabetic counter
  const chars = lastCode.split("");
  let carry = true;
  for (let i = chars.length - 1; i >= 0 && carry; i--) {
    const code = chars[i]!.charCodeAt(0) - 65; // 0-25
    if (code < 25) {
      chars[i] = String.fromCharCode(65 + code + 1);
      carry = false;
    } else {
      chars[i] = "A";
    }
  }
  if (carry) {
    chars.unshift("A");
  }
  return chars.join("");
}

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const params = request.nextUrl.searchParams;
  const companyId = params.get("companyId");
  const fiscalYearId = params.get("fiscalYearId");
  const accountCode = params.get("accountCode");
  const showLettered = params.get("showLettered") === "true";

  if (!companyId) return NextResponse.json({ error: "companyId requis" }, { status: 400 });
  if (!fiscalYearId) return NextResponse.json({ error: "fiscalYearId requis" }, { status: 400 });
  if (!accountCode) return NextResponse.json({ error: "accountCode requis" }, { status: 400 });

  if (!(await checkPermission(companyId, "canAccessEntries"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const where: Prisma.JournalEntryLineWhereInput = {
    companyId,
    accountCode,
    journalEntry: {
      fiscalYearId,
      journal: { companyId },
    },
  };

  if (!showLettered) {
    where.isLettered = false;
  }

  const lines = await prisma.journalEntryLine.findMany({
    where,
    select: {
      id: true,
      lineNumber: true,
      accountCode: true,
      label: true,
      debit: true,
      credit: true,
      tiersName: true,
      dueDate: true,
      lettrageCode: true,
      isLettered: true,
      journalEntry: {
        select: {
          id: true,
          entryNumber: true,
          entryDate: true,
          reference: true,
          journal: {
            select: {
              code: true,
              label: true,
            },
          },
        },
      },
    },
    orderBy: [
      { journalEntry: { entryDate: "asc" } },
      { journalEntry: { entryNumber: "asc" } },
      { lineNumber: "asc" },
    ],
  });

  // Fetch lettrage groups for this account if showing lettered
  let lettrageGroups: LettrageGroup[] = [];
  if (showLettered) {
    const visibleCodes = [
      ...new Set(
        lines
          .map((line) => line.lettrageCode)
          .filter((code): code is string => typeof code === "string" && code.length > 0)
      ),
    ];
    lettrageGroups = await prisma.lettrageGroup.findMany({
      where: { companyId, accountCode, code: { in: visibleCodes } },
      orderBy: { code: "asc" },
    });
  }

  return NextResponse.json({ lines, lettrageGroups });
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const body = await request.json();
  const { companyId, fiscalYearId, accountCode, lineIds } = body;

  if (!companyId) return NextResponse.json({ error: "companyId requis" }, { status: 400 });
  if (!fiscalYearId) return NextResponse.json({ error: "fiscalYearId requis" }, { status: 400 });
  if (!accountCode) return NextResponse.json({ error: "accountCode requis" }, { status: 400 });
  if (!lineIds || !Array.isArray(lineIds) || lineIds.length === 0) {
    return NextResponse.json({ error: "lineIds requis (tableau non vide)" }, { status: 400 });
  }

  if (!(await checkPermission(companyId, "canAccessEntries"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Fetch the selected lines
  const lines = await prisma.journalEntryLine.findMany({
    where: {
      id: { in: lineIds },
      companyId,
      accountCode,
      journalEntry: {
        fiscalYearId,
        journal: { companyId },
      },
    },
  });

  if (lines.length !== lineIds.length) {
    return NextResponse.json(
      { error: "Certaines lignes sont introuvables ou appartiennent à un autre compte/société" },
      { status: 400 }
    );
  }

  // Check none are already lettered
  const alreadyLettered = lines.filter((l) => l.isLettered);
  if (alreadyLettered.length > 0) {
    return NextResponse.json(
      { error: "Certaines lignes sont déjà lettrées" },
      { status: 400 }
    );
  }

  // Sum debits and credits
  const totalDebit = lines.reduce((acc, l) => acc.plus(new Decimal(l.debit.toString())), new Decimal(0));
  const totalCredit = lines.reduce((acc, l) => acc.plus(new Decimal(l.credit.toString())), new Decimal(0));
  const remainder = totalDebit.minus(totalCredit).abs();
  const isPartial = !totalDebit.eq(totalCredit);

  // Get next available lettrage code
  const existingGroups = await prisma.lettrageGroup.findMany({
    where: { companyId, accountCode },
    select: { code: true },
  });
  const existingCodes = existingGroups.map((g) => g.code);
  const nextCode = getNextLettrageCode(existingCodes);

  // Create lettrage group and update lines in a transaction
  const [lettrageGroup] = await prisma.$transaction([
    prisma.lettrageGroup.create({
      data: {
        companyId,
        accountCode,
        code: nextCode,
        isPartial,
        totalDebit: totalDebit.toDecimalPlaces(2),
        totalCredit: totalCredit.toDecimalPlaces(2),
        remainder: remainder.toDecimalPlaces(2),
      },
    }),
    prisma.journalEntryLine.updateMany({
      where: { id: { in: lineIds } },
      data: {
        lettrageCode: nextCode,
        isLettered: true,
      },
    }),
  ]);

  return NextResponse.json({ lettrageGroup, code: nextCode, isPartial }, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const params = request.nextUrl.searchParams;
  const companyId = params.get("companyId");
  const fiscalYearId = params.get("fiscalYearId");
  const lettrageCode = params.get("lettrageCode");
  const accountCode = params.get("accountCode");

  if (!companyId) return NextResponse.json({ error: "companyId requis" }, { status: 400 });
  if (!fiscalYearId) return NextResponse.json({ error: "fiscalYearId requis" }, { status: 400 });
  if (!lettrageCode) return NextResponse.json({ error: "lettrageCode requis" }, { status: 400 });
  if (!accountCode) return NextResponse.json({ error: "accountCode requis" }, { status: 400 });

  if (!(await checkPermission(companyId, "canAccessEntries"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Delete lettrage group and reset lines in a transaction
  await prisma.$transaction(async (tx) => {
    await tx.journalEntryLine.updateMany({
      where: {
        companyId,
        accountCode,
        lettrageCode,
        journalEntry: {
          fiscalYearId,
          journal: { companyId },
        },
      },
      data: {
        lettrageCode: null,
        isLettered: false,
      },
    });

    const remainingLines = await tx.journalEntryLine.count({
      where: { companyId, accountCode, lettrageCode },
    });

    if (remainingLines === 0) {
      await tx.lettrageGroup.deleteMany({
        where: { companyId, accountCode, code: lettrageCode },
      });
    }
  });

  return NextResponse.json({ success: true });
}
