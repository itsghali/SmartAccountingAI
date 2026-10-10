import { NextRequest, NextResponse } from "next/server";
import { AgentType, Prisma } from "@prisma/client";
import { z } from "zod";
import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";

const querySchema = z.object({
  companyId: z.string().min(1),
  fiscalYearId: z.string().min(1).optional(),
  agentType: z.nativeEnum(AgentType).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = session.user as { organizationId: string };
  const validation = querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams.entries())
  );

  if (!validation.success) {
    return NextResponse.json(
      { error: "Invalid query", details: validation.error.format() },
      { status: 400 }
    );
  }

  const { companyId, fiscalYearId, agentType, limit = 20 } = validation.data;

  try {
    const company = await prisma.company.findFirst({
      where: {
        id: companyId,
        organizationId: user.organizationId,
      },
      select: { id: true },
    });

    if (!company) {
      return NextResponse.json(
        { error: "Company not found or access denied" },
        { status: 404 }
      );
    }

    const where: Prisma.AgentRunWhereInput = {
      companyId,
      ...(agentType && { agentType }),
      ...(fiscalYearId
        ? {
            inputSnapshot: {
              path: ["inputData", "fiscalYearId"],
              equals: fiscalYearId,
            },
          }
        : {}),
    };

    const runs = await prisma.agentRun.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        agentType: true,
        status: true,
        modelVersion: true,
        createdAt: true,
        completedAt: true,
        durationMs: true,
      },
    });

    return NextResponse.json({ runs });
  } catch (error) {
    console.error("Agent runs fetch error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
