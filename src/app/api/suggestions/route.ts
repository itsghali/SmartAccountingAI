import { NextRequest, NextResponse } from "next/server";
import { AgentType, Prisma, SuggestionStatus } from "@prisma/client";
import { z } from "zod";
import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";

const querySchema = z.object({
  companyId: z.string().min(1),
  fiscalYearId: z.string().min(1).optional(),
  status: z.nativeEnum(SuggestionStatus).optional(),
  agentType: z.nativeEnum(AgentType).optional(),
  documentId: z.string().optional(),
  search: z.string().optional(),
  currentOnly: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value !== "false"),
  limit: z.coerce.number().int().min(1).max(200).optional(),
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

  const {
    companyId,
    fiscalYearId,
    status,
    agentType,
    documentId,
    search,
    currentOnly = true,
    limit = 100,
  } = validation.data;

  try {
    const company = await prisma.company.findFirst({
      where: {
        id: companyId,
        organizationId: user.organizationId,
      },
      select: { id: true },
    });

    if (!company) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const baseWhere: Prisma.SuggestionWhereInput = {
      companyId,
      ...(agentType && { agentType }),
      ...(documentId && { documentId }),
      ...(fiscalYearId
        ? {
            agentRun: {
              inputSnapshot: {
                path: ["inputData", "fiscalYearId"],
                equals: fiscalYearId,
              },
            },
          }
        : {}),
      ...(currentOnly ? { isCurrent: true } : {}),
      ...(search
        ? {
            OR: [
              { label: { contains: search, mode: "insensitive" } },
              { sourceKey: { contains: search, mode: "insensitive" } },
              {
                document: {
                  originalFilename: {
                    contains: search,
                    mode: "insensitive",
                  },
                },
              },
            ],
          }
        : {}),
    };

    const [suggestions, total, pending, approved, rejected, corrected] =
      await Promise.all([
        prisma.suggestion.findMany({
          where: {
            ...baseWhere,
            ...(status && { status }),
          },
          include: {
            document: {
              select: {
                id: true,
                originalFilename: true,
                status: true,
              },
            },
            agentRun: {
              select: {
                id: true,
                agentType: true,
                createdAt: true,
                modelVersion: true,
              },
            },
            reviewedBy: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
              },
            },
            reviewEvents: {
              orderBy: { createdAt: "desc" },
              include: {
                reviewedBy: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                  },
                },
              },
            },
          },
          orderBy: [{ status: "asc" }, { createdAt: "desc" }],
          take: limit,
        }),
        prisma.suggestion.count({ where: baseWhere }),
        prisma.suggestion.count({
          where: { ...baseWhere, status: SuggestionStatus.PENDING },
        }),
        prisma.suggestion.count({
          where: { ...baseWhere, status: SuggestionStatus.APPROVED },
        }),
        prisma.suggestion.count({
          where: { ...baseWhere, status: SuggestionStatus.REJECTED },
        }),
        prisma.suggestion.count({
          where: { ...baseWhere, status: SuggestionStatus.CORRECTED },
        }),
      ]);

    return NextResponse.json({
      suggestions,
      summary: {
        total,
        pending,
        approved,
        rejected,
        corrected,
      },
    });
  } catch (error) {
    console.error("Get suggestions error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
