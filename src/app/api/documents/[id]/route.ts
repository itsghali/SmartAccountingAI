import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";
import { checkPermission } from "@/server/permissions";
import { isSuggestionStorageUnavailableError } from "@/server/suggestions/service";
import { deletePrivateFile } from "@/server/storage";

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

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = session.user as { id: string; organizationId: string };
  const { id: documentId } = await params;

  try {
    const document = await prisma.document.findUnique({
      where: { id: documentId },
      select: { id: true, tenantId: true, storagePath: true },
    });

    if (!document) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const company = await prisma.company.findFirst({
      where: { id: document.tenantId, organizationId: user.organizationId },
      select: { id: true },
    });

    if (!company) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    if (!(await checkPermission(document.tenantId, "canAccessEntries"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Delete physical file (ignore if already missing)
    if (document.storagePath) {
      await deletePrivateFile(document.storagePath);
    }

    // Manually cascade: delete child records before the document
    // 1. Find all extraction runs
    const runs = await prisma.documentExtractionRun.findMany({
      where: { documentId },
      select: { id: true },
    });
    const runIds = runs.map((r) => r.id);

    if (runIds.length > 0) {
      // Delete suggestions tied to extraction runs
      await prisma.suggestion.deleteMany({
        where: { extractionRunId: { in: runIds } },
      });
      // Delete extracted fields tied to extraction runs
      await prisma.extractedField.deleteMany({
        where: { extractionRunId: { in: runIds } },
      });
      await prisma.documentExtractionRun.deleteMany({
        where: { id: { in: runIds } },
      });
    }

    // 2. Delete any remaining extracted fields directly on the document
    await prisma.extractedField.deleteMany({ where: { documentId } });

    // 3. Delete approval decisions
    await prisma.approvalDecision.deleteMany({ where: { documentId } });

    // 4. Delete the document itself
    await prisma.document.delete({ where: { id: documentId } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete document error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
