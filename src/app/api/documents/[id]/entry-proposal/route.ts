import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";
import {
  generateDocumentEntryProposal,
  getCurrentDocumentEntryProposal,
} from "@/server/accounting-entry-preparer/service";

const createProposalSchema = z.object({
  fiscalYearId: z.string().optional(),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = session.user as { organizationId: string };
  const { id: documentId } = await params;

  try {
    const proposal = await getCurrentDocumentEntryProposal(
      documentId,
      user.organizationId
    );

    return NextResponse.json({ proposal });
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
    const body = await request.json();
    const validation = createProposalSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid input", details: validation.error.format() },
        { status: 400 }
      );
    }

    const document = await prisma.document.findUnique({
      where: { id: documentId },
      select: {
        id: true,
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
        canAccessEntries: true,
      },
    });

    if (!companyAccess?.canAccessEntries) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const proposal = await generateDocumentEntryProposal({
      documentId,
      organizationId: user.organizationId,
      userId: user.id,
      fiscalYearId: validation.data.fiscalYearId,
    });

    await prisma.auditLog.create({
      data: {
        userId: user.id,
        companyId: document.tenantId,
        action: "ENTRY_PROPOSAL_GENERATED",
        entityType: "Document",
        entityId: documentId,
        details: {
          fiscalYearId: validation.data.fiscalYearId ?? null,
          proposalSuggestionId: proposal?.id ?? null,
        },
      },
    });

    return NextResponse.json({ proposal });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal Server Error";
    // Error logged internally
    const status =
      message === "Document not found."
        ? 404
        : message === "Access denied."
          ? 403
          : message.includes("approved document") || message.includes("total amount")
            ? 400
            : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
