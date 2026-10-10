import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";
import { processDocument } from "@/server/document-processor";
import {
  isSuggestionStorageUnavailableError,
  supersedeDocumentSuggestions,
} from "@/server/suggestions/service";

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

    const modelConfig = {
      provider: "groq" as const,
      model: "llama-3.3-70b",
      temperature: 0,
      maxTokens: 8000,
    };

    try {
      await supersedeDocumentSuggestions(
        documentId,
        user.id,
        "Superseded by document reprocessing."
      );
    } catch (error) {
      if (!isSuggestionStorageUnavailableError(error)) {
        throw error;
      }

      console.warn(
        "[ReprocessDocument] Suggestion storage unavailable, skipping suggestion supersede."
      );
    }

    const extractionRun = await prisma.documentExtractionRun.create({
      data: {
        documentId,
        tenantId: document.tenantId,
        agentType: "DOCUMENT_PROCESSOR",
        modelName: modelConfig.model,
        modelVersion: modelConfig.model,
        promptVersion: "1.1",
        status: "QUEUED",
      },
    });

    await prisma.document.update({
      where: { id: documentId },
      data: {
        status: "PROCESSING",
        currentRunId: extractionRun.id,
      },
    });

    await prisma.auditLog.create({
      data: {
        userId: user.id,
        companyId: document.tenantId,
        action: "DOCUMENT_REPROCESS",
        entityType: "Document",
        entityId: documentId,
        details: { newRunId: extractionRun.id },
      },
    });

    processDocument(
      documentId,
      extractionRun.id,
      document.tenantId,
      user.id,
      document.mimeType,
      modelConfig
    ).catch((err: unknown) => console.error("Background reprocessing error:", err));

    return NextResponse.json({
      documentId,
      runId: extractionRun.id,
      status: "PROCESSING",
    });
  } catch (error) {
    console.error("Reprocess document error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
