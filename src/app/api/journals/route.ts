import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { checkPermission } from "@/server/permissions";
import { prisma } from "@/server/prisma";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const companyId = request.nextUrl.searchParams.get("companyId");
  if (!companyId) return NextResponse.json({ error: "companyId requis" }, { status: 400 });
  if (!(await checkPermission(companyId, "canAccessSetup"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });


  const journals = await prisma.journal.findMany({
    where: { companyId, isActive: true },
    orderBy: { code: "asc" },
  });

  return NextResponse.json(journals);
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const body = await request.json();
  const { companyId, code, label, type, defaultCounterpartAccountCode } = body;

  if (!companyId || !code || !label || !type) {
    return NextResponse.json({ error: "Champs requis manquants" }, { status: 400 });
  }

  if (!(await checkPermission(companyId, "canAccessSetup"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const existing = await prisma.journal.findUnique({
    where: { companyId_code: { companyId, code } },
  });
  if (existing) {
    return NextResponse.json({ error: "Ce code journal existe déjà" }, { status: 409 });
  }

  const journal = await prisma.journal.create({
    data: { companyId, code, label, type, defaultCounterpartAccountCode },
  });

  return NextResponse.json(journal, { status: 201 });
}
