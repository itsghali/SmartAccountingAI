import { NextRequest, NextResponse } from "next/server";
import { SuggestionStatus } from "@prisma/client";
import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";
import { z } from "zod";
import { checkPermission } from "@/server/permissions";
import { isSuggestionStorageUnavailableError } from "@/server/suggestions/service";

const approveSchema = z.object({
  notes: z.string().max(2000).optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = session.user as { id: string; organizationId: string };
  const { id: documentId } = await params;

  try {
    const body = await request.json();
    const validation = approveSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid input", details: validation.error.format() },
        { status: 400 }
      );
    }

    const document = await prisma.document.findUnique({
      where: { id: documentId },
    });

    if (!document) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const company = await prisma.company.findFirst({
      where: {
        id: document.tenantId,
        organizationId: user.organizationId,
      },
      select: { id: true },
    });

    if (!company) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    if (!(await checkPermission(document.tenantId, "canAccessEntries"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (document.status !== "REVIEW_REQUIRED") {
      return NextResponse.json(
        { error: `Document must be in REVIEW_REQUIRED status to approve. Current: ${document.status}` },
        { status: 400 }
      );
    }

    let pendingSuggestionCount = 0;

    try {
      pendingSuggestionCount = await prisma.suggestion.count({
        where: {
          documentId,
          isCurrent: true,
          status: SuggestionStatus.PENDING,
        },
      });
    } catch (error) {
      if (!isSuggestionStorageUnavailableError(error)) {
        throw error;
      }

      console.warn(
        "[ApproveDocument] Suggestion storage unavailable, falling back to extracted field review count."
      );
      pendingSuggestionCount = await prisma.extractedField.count({
        where: {
          documentId,
          fieldName: { not: "warnings" },
          reviewStatus: "PENDING",
        },
      });
    }

    if (pendingSuggestionCount > 0) {
      return NextResponse.json(
        {
          error:
            "Every current suggestion must be approved, rejected, or corrected before the document can be approved.",
          pendingSuggestionCount,
        },
        { status: 400 }
      );
    }

    await prisma.$transaction([
      prisma.document.update({
        where: { id: documentId },
        data: {
          status: "APPROVED",
          approvedAt: new Date(),
          approvedById: user.id,
        },
      }),
      prisma.approvalDecision.create({
        data: {
          tenantId: document.tenantId,
          documentId,
          decidedById: user.id,
          decision: "APPROVE",
          notes: validation.data.notes,
        },
      }),
      prisma.auditLog.create({
        data: {
          userId: user.id,
          companyId: document.tenantId,
          action: "DOCUMENT_APPROVED",
          entityType: "Document",
          entityId: documentId,
          details: { notes: validation.data.notes },
        },
      }),
    ]);

    return NextResponse.json({
      documentId,
      status: "APPROVED",
      pendingSuggestionCount,
    });
  } catch (error) {
    console.error("Approve document error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
