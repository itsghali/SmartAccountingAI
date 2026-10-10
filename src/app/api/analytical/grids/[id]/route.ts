import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";

// GET /api/analytical/grids/[id] — fetch grid with posts (flat list)
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id } = await params;

  const grid = await prisma.analyticalGrid.findUnique({
    where: { id },
    include: {
      posts: {
        orderBy: { code: "asc" },
      },
    },
  });

  if (!grid) return NextResponse.json({ error: "Grille introuvable" }, { status: 404 });

  return NextResponse.json(grid);
}

// PATCH /api/analytical/grids/[id] — toggle isActive or update label
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id } = await params;
  const body = await request.json();

  const grid = await prisma.analyticalGrid.update({
    where: { id },
    data: {
      ...(typeof body.isActive === "boolean" ? { isActive: body.isActive } : {}),
      ...(body.label ? { label: body.label } : {}),
    },
    include: {
      _count: { select: { posts: true } },
    },
  });

  return NextResponse.json(grid);
}
