import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { checkPermission } from "@/server/permissions";
import { prisma } from "@/server/prisma";
import { z } from "zod";


const createGridSchema = z.object({
  companyId: z.string().min(1),
  code: z.string().min(1, "Le code est requis"),
  label: z.string().min(1, "Le libellé est requis"),
});

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const companyId = request.nextUrl.searchParams.get("companyId");
  if (!companyId) return NextResponse.json({ error: "companyId requis" }, { status: 400 });
  if (!(await checkPermission(companyId, "canAccessAnalytical"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });


  const grids = await prisma.analyticalGrid.findMany({
    where: { companyId },
    include: {
      _count: { select: { posts: true } },
    },
    orderBy: { code: "asc" },
  });

  return NextResponse.json(grids);
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const body = await request.json();
  const parsed = createGridSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
  }

  const { companyId, code, label } = parsed.data;
  if (!(await checkPermission(companyId, "canAccessAnalytical"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const existing = await prisma.analyticalGrid.findUnique({
    where: { companyId_code: { companyId, code } },
  });
  if (existing) {
    return NextResponse.json({ error: "Ce code de grille existe déjà" }, { status: 409 });
  }

  const grid = await prisma.analyticalGrid.create({
    data: { companyId, code, label },
    include: {
      _count: { select: { posts: true } },
    },
  });

  return NextResponse.json(grid, { status: 201 });
}
