import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { checkPermission } from "@/server/permissions";
import { prisma } from "@/server/prisma";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id } = await params;
  const declaration = await prisma.vATDeclaration.findUnique({ where: { id } });
  if (!declaration) {
    return NextResponse.json({ error: "Déclaration TVA introuvable" }, { status: 404 });
  }

  if (!(await checkPermission(declaration.companyId, "canAccessVAT"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();

  if (body.action === "validate") {
    const updated = await prisma.vATDeclaration.update({
      where: { id },
      data: { status: "VALIDATED" },
    });
    return NextResponse.json(updated);
  }

  if (body.action === "submit") {
    const updated = await prisma.vATDeclaration.update({
      where: { id },
      data: { status: "SUBMITTED", submissionDate: new Date() },
    });
    return NextResponse.json(updated);
  }

  if (body.action === "pay") {
    const updated = await prisma.vATDeclaration.update({
      where: { id },
      data: {
        status: "PAID",
        paymentDate: new Date(),
        paymentReference: body.paymentReference,
      },
    });
    return NextResponse.json(updated);
  }

  return NextResponse.json({ error: "Action non reconnue" }, { status: 400 });
}

