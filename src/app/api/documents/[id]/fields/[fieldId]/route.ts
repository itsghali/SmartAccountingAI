import { NextRequest, NextResponse } from "next/server";
import { SuggestionStatus } from "@prisma/client";
import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";
import { z } from "zod";
import {
  isSuggestionStorageUnavailableError,
  reviewSuggestion,
} from "@/server/suggestions/service";

const patchFieldSchema = z.object({
  correctedValue: z.unknown().optional(),
  reviewStatus: z
    .enum(["PENDING", "APPROVED", "REJECTED", "CORRECTED"])
    .optional(),
  notes: z.string().max(2000).optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; fieldId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = session.user as { id: string; organizationId: string };
  const { id: documentId, fieldId } = await params;

  try {
    const body = await request.json();
    const validation = patchFieldSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid input", details: validation.error.format() },
        { status: 400 }
      );
    }

    const field = await prisma.extractedField.findFirst({
      where: { id: fieldId, documentId },
    });

    if (!field) {
      return NextResponse.json({ error: "Field not found" }, { status: 404 });
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

    const nextStatus =
      validation.data.reviewStatus ??
      (validation.data.correctedValue !== undefined ? "CORRECTED" : undefined);

    if (!nextStatus) {
      return NextResponse.json(
        { error: "Either reviewStatus or correctedValue must be provided" },
        { status: 400 }
      );
    }

    let linkedSuggestion: { id: string; isCurrent: boolean } | null = null;

    try {
      linkedSuggestion = await prisma.suggestion.findFirst({
        where: {
          extractedFieldId: fieldId,
        },
        select: {
          id: true,
          isCurrent: true,
        },
      });
    } catch (error) {
      if (!isSuggestionStorageUnavailableError(error)) {
        throw error;
      }

      console.warn(
        "[PatchDocumentField] Suggestion storage unavailable, falling back to legacy field review."
      );
    }

    if (linkedSuggestion?.isCurrent) {
      const updatedSuggestion = await reviewSuggestion({
        suggestionId: linkedSuggestion.id,
        reviewedById: user.id,
        status: nextStatus as SuggestionStatus,
        correctedValue: validation.data.correctedValue,
        notes: validation.data.notes,
      });

      await prisma.auditLog.create({
        data: {
          userId: user.id,
          companyId: document.tenantId,
          action: "FIELD_REVIEWED",
          entityType: "ExtractedField",
          entityId: fieldId,
          details: {
            documentId,
            fieldName: field.fieldName,
            originalValue: field.fieldValue,
            correctedValue: validation.data.correctedValue ?? null,
            reviewStatus: nextStatus,
            notes: validation.data.notes ?? null,
            suggestionId: linkedSuggestion.id,
          },
        },
      });

      return NextResponse.json({ suggestion: updatedSuggestion });
    }

    const legacyStatusMap: Record<typeof nextStatus, string> = {
      PENDING: "PENDING",
      APPROVED: "ACCEPTED",
      REJECTED: "REVIEWED",
      CORRECTED: "CORRECTED",
    };

    const updateData: Record<string, unknown> = {
      reviewStatus: legacyStatusMap[nextStatus],
    };

    if (nextStatus === "CORRECTED") {
      updateData.correctedValue = validation.data.correctedValue;
      updateData.correctedById = user.id;
      updateData.correctedAt = new Date();
    } else {
      updateData.correctedValue = null;
      updateData.correctedById = null;
      updateData.correctedAt = null;
    }

    const updatedField = await prisma.extractedField.update({
      where: { id: fieldId },
      data: updateData,
    });

    await prisma.auditLog.create({
      data: {
        userId: user.id,
        companyId: document.tenantId,
        action: "FIELD_CORRECTED",
        entityType: "ExtractedField",
        entityId: fieldId,
        details: {
          documentId,
          fieldName: field.fieldName,
          originalValue: field.fieldValue,
          correctedValue: validation.data.correctedValue ?? null,
          reviewStatus: nextStatus,
          notes: validation.data.notes ?? null,
        },
      },
    });

    return NextResponse.json({ field: updatedField });
  } catch (error) {
    console.error("Patch field error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
