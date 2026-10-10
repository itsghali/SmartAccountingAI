import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";
import { checkPermission } from "@/server/permissions";
import { processDocument } from "@/server/document-processor";

export { processDocument };

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

    if (!(await checkPermission(document.tenantId, "canAccessEntries"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (document.status !== "UPLOADED" && document.status !== "FAILED") {
      return NextResponse.json(
        { error: `Document cannot be processed in status: ${document.status}` },
        { status: 400 }
      );
    }

    const modelConfig = {
      provider: "groq" as const,
      model: "llama-3.3-70b",
      temperature: 0,
      maxTokens: 8000,
    };

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

    processDocument(documentId, extractionRun.id, document.tenantId, user.id, document.mimeType, modelConfig).catch(
      (err) => console.error("Background processing error:", err)
    );

    return NextResponse.json({
      documentId,
      runId: extractionRun.id,
      status: "PROCESSING",
    });
  } catch (error) {
    console.error("Document process error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
