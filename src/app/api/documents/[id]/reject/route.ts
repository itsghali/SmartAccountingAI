import { NextRequest, NextResponse } from "next/server";
import { SuggestionStatus } from "@prisma/client";
import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";
import { z } from "zod";
import { checkPermission } from "@/server/permissions";
import {
  bulkReviewSuggestions,
  isSuggestionStorageUnavailableError,
  supersedeDocumentSuggestions,
} from "@/server/suggestions/service";

const rejectSchema = z.object({
  notes: z.string().min(1).max(2000),
  sendBack: z.boolean().optional(),
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
    const validation = rejectSchema.safeParse(body);

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

    if (document.status !== "REVIEW_REQUIRED" && document.status !== "APPROVED") {
      return NextResponse.json(
        { error: `Document cannot be rejected in status: ${document.status}` },
        { status: 400 }
      );
    }

    const decision = validation.data.sendBack ? "SEND_BACK" : "REJECT";
    const newStatus = validation.data.sendBack ? "UPLOADED" : "REJECTED";

    if (validation.data.sendBack) {
      try {
        await supersedeDocumentSuggestions(
          documentId,
          user.id,
          validation.data.notes
        );
      } catch (error) {
        if (!isSuggestionStorageUnavailableError(error)) {
          throw error;
        }

        console.warn(
          "[RejectDocument] Suggestion storage unavailable, skipping suggestion supersede."
        );
      }
    } else {
      try {
        const pendingSuggestions = await prisma.suggestion.findMany({
          where: {
            documentId,
            isCurrent: true,
            status: SuggestionStatus.PENDING,
          },
          select: { id: true },
        });

        if (pendingSuggestions.length > 0) {
          await bulkReviewSuggestions({
            companyId: document.tenantId,
            suggestionIds: pendingSuggestions.map((suggestion) => suggestion.id),
            reviewedById: user.id,
            status: SuggestionStatus.REJECTED,
            notes: validation.data.notes,
          });
        }
      } catch (error) {
        if (!isSuggestionStorageUnavailableError(error)) {
          throw error;
        }

        console.warn(
          "[RejectDocument] Suggestion storage unavailable, skipping pending suggestion rejection."
        );
      }
    }

    await prisma.$transaction([
      prisma.document.update({
        where: { id: documentId },
        data: {
          status: newStatus,
          approvedAt: null,
          approvedById: null,
        },
      }),
      prisma.approvalDecision.create({
        data: {
          tenantId: document.tenantId,
          documentId,
          decidedById: user.id,
          decision,
          notes: validation.data.notes,
        },
      }),
      prisma.auditLog.create({
        data: {
          userId: user.id,
          companyId: document.tenantId,
          action: "DOCUMENT_REJECTED",
          entityType: "Document",
          entityId: documentId,
          details: { decision, notes: validation.data.notes },
        },
      }),
    ]);

    return NextResponse.json({ documentId, status: newStatus });
  } catch (error) {
    console.error("Reject document error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
