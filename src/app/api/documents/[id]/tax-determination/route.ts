import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";
import {
  generateDocumentTaxDetermination,
  getCurrentDocumentTaxDetermination,
} from "@/server/tax-support/service";

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
    const document = await prisma.document.findUnique({
      where: { id: documentId },
      select: {
        tenantId: true,
      },
    });

    if (!document) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const companyAccess = await prisma.userCompanyAccess.findUnique({
      where: {
        userId_companyId: {
          userId: user.id,
          companyId: document.tenantId,
        },
      },
      select: {
        canAccessVAT: true,
      },
    });

    if (!companyAccess?.canAccessVAT) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const determination = await getCurrentDocumentTaxDetermination(
      documentId,
      user.organizationId
    );
    return NextResponse.json({ determination });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal Server Error";
    // Error logged internally
    const status =
      message === "Document not found."
        ? 404
        : message === "Access denied."
          ? 403
          : 500;

    return NextResponse.json({ error: message }, { status });
  }
}

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
    const document = await prisma.document.findUnique({
      where: { id: documentId },
      select: {
        tenantId: true,
      },
    });

    if (!document) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    const companyAccess = await prisma.userCompanyAccess.findUnique({
      where: {
        userId_companyId: {
          userId: user.id,
          companyId: document.tenantId,
        },
      },
      select: {
        canAccessVAT: true,
      },
    });

    if (!companyAccess?.canAccessVAT) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const determination = await generateDocumentTaxDetermination({
      documentId,
      organizationId: user.organizationId,
      userId: user.id,
    });

    await prisma.auditLog.create({
      data: {
        userId: user.id,
        companyId: document.tenantId,
        action: "DOCUMENT_TAX_DETERMINATION_GENERATED",
        entityType: "Document",
        entityId: documentId,
        details: {
          determinationSuggestionId: determination?.id ?? null,
        },
      },
    });

    return NextResponse.json({ determination });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal Server Error";
    // Error logged internally
    const status =
      message === "Document not found."
        ? 404
        : message === "Access denied."
          ? 403
          : message.includes("approved documents")
            ? 400
            : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
