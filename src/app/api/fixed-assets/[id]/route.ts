import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id } = await params;
  const asset = await prisma.fixedAsset.findUnique({
    where: { id },
    include: {
      assetAccount: { select: { code: true, label: true } },
      amortizationAccount: { select: { code: true, label: true } },
      dotationAccount: { select: { code: true, label: true } },
      amortizationSchedule: {
        orderBy: { year: "asc" },
        include: { fiscalYear: { select: { label: true } } },
      },
    },
  });

  if (!asset) return NextResponse.json({ error: "Immobilisation introuvable" }, { status: 404 });

  return NextResponse.json(asset);
}
