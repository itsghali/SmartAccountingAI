import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";
import { checkPermission } from "@/server/permissions";
import { isSuggestionStorageUnavailableError } from "@/server/suggestions/service";

export async function GET(
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
    let document;

    try {
      document = await prisma.document.findUnique({
        where: { id: documentId },
        include: {
          extractionRuns: {
            orderBy: { createdAt: "desc" },
            include: {
              fields: {
                where: { isCurrent: true },
                orderBy: { fieldName: "asc" },
              },
            },
          },
          extractedFields: {
            where: { isCurrent: true },
            orderBy: { fieldName: "asc" },
          },
          approvalDecisions: {
            orderBy: { createdAt: "desc" },
            include: {
              decidedBy: {
                select: { id: true, firstName: true, lastName: true, email: true },
              },
            },
          },
          uploadedBy: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
          approvedBy: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
        },
      });
    } catch (error) {
      if (!isSuggestionStorageUnavailableError(error)) {
        throw error;
      }

      console.warn(
        "[GetDocument] Suggestion storage unavailable, falling back to legacy document query."
      );
      document = await prisma.document.findUnique({
        where: { id: documentId },
        include: {
          extractionRuns: {
            orderBy: { createdAt: "desc" },
            include: {
              fields: {
                orderBy: { fieldName: "asc" },
              },
            },
          },
          extractedFields: {
            orderBy: { fieldName: "asc" },
          },
          approvalDecisions: {
            orderBy: { createdAt: "desc" },
            include: {
              decidedBy: {
                select: { id: true, firstName: true, lastName: true, email: true },
              },
            },
          },
          uploadedBy: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
          approvedBy: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
        },
      });
    }

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

    return NextResponse.json({ document });
  } catch (error) {
    console.error("Get document error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
