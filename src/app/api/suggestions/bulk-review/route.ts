import { NextRequest, NextResponse } from "next/server";
import { SuggestionStatus } from "@prisma/client";
import { z } from "zod";
import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";
import { bulkReviewSuggestions } from "@/server/suggestions/service";

const bulkReviewSchema = z.object({
  companyId: z.string().min(1),
  suggestionIds: z.array(z.string().min(1)).min(1).max(500),
  status: z.enum(["APPROVED", "REJECTED"]),
  notes: z.string().max(2000).optional(),
});

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = session.user as { id: string; organizationId: string };

  try {
    const body = await request.json();
    const validation = bulkReviewSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid input", details: validation.error.format() },
        { status: 400 }
      );
    }

    const company = await prisma.company.findFirst({
      where: {
        id: validation.data.companyId,
        organizationId: user.organizationId,
      },
      select: { id: true },
    });

    if (!company) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const suggestions = await prisma.suggestion.findMany({
      where: {
        id: { in: validation.data.suggestionIds },
        companyId: validation.data.companyId,
        isCurrent: true,
      },
      select: { id: true },
    });

    if (suggestions.length !== validation.data.suggestionIds.length) {
      return NextResponse.json(
        { error: "One or more suggestions are missing or already historical" },
        { status: 400 }
      );
    }

    const updatedSuggestions = await bulkReviewSuggestions({
      companyId: validation.data.companyId,
      suggestionIds: validation.data.suggestionIds,
      reviewedById: user.id,
      status: validation.data.status as Exclude<SuggestionStatus, "CORRECTED">,
      notes: validation.data.notes,
    });

    await prisma.auditLog.create({
      data: {
        userId: user.id,
        companyId: validation.data.companyId,
        action: "SUGGESTION_BULK_REVIEW",
        entityType: "Suggestion",
        details: {
          suggestionIds: validation.data.suggestionIds,
          status: validation.data.status,
          notes: validation.data.notes ?? null,
        },
      },
    });

    return NextResponse.json({
      count: updatedSuggestions.length,
      suggestions: updatedSuggestions,
    });
  } catch (error) {
    console.error("Bulk review suggestions error:", error);
    // Error logged internally
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
