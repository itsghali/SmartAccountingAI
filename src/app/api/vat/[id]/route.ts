import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id } = await params;
  const body = await request.json();

  if (body.action === "validate") {
    const declaration = await prisma.vATDeclaration.update({
      where: { id },
      data: { status: "VALIDATED" },
    });
    return NextResponse.json(declaration);
  }

  if (body.action === "submit") {
    const declaration = await prisma.vATDeclaration.update({
      where: { id },
      data: { status: "SUBMITTED", submissionDate: new Date() },
    });
    return NextResponse.json(declaration);
  }

  if (body.action === "pay") {
    const declaration = await prisma.vATDeclaration.update({
      where: { id },
      data: {
        status: "PAID",
        paymentDate: new Date(),
        paymentReference: body.paymentReference,
      },
    });
    return NextResponse.json(declaration);
  }

  return NextResponse.json({ error: "Action non reconnue" }, { status: 400 });
}
