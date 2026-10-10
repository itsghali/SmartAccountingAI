import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";
import { z } from "zod";

const createPostSchema = z.object({
  code: z.string().min(1, "Le code est requis"),
  label: z.string().min(1, "Le libellé est requis"),
  parentId: z.string().optional().nullable(),
});

// GET /api/analytical/grids/[id]/posts
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id } = await params;

  const posts = await prisma.analyticalPost.findMany({
    where: { gridId: id },
    orderBy: { code: "asc" },
  });

  return NextResponse.json(posts);
}

// POST /api/analytical/grids/[id]/posts
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { id } = await params;

  const grid = await prisma.analyticalGrid.findUnique({ where: { id } });
  if (!grid) return NextResponse.json({ error: "Grille introuvable" }, { status: 404 });

  const body = await request.json();
  const parsed = createPostSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
  }

  const { code, label, parentId } = parsed.data;

  const post = await prisma.analyticalPost.create({
    data: {
      gridId: id,
      code,
      label,
      parentId: parentId || null,
    },
  });

  return NextResponse.json(post, { status: 201 });
}
