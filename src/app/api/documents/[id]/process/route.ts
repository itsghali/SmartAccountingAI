import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";
import { checkPermission } from "@/server/permissions";
import { processDocument } from "@/server/document-processor";

import { modelGateway } from "@/server/agents/core/model-gateway";
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

    if (document.status !== "UPLOADED" && document.status !== "FAILED" && document.status !== "PROCESSING") {
      return NextResponse.json(
        { error: `Document cannot be processed in status: ${document.status}` },
        { status: 400 }
      );
    }

    // If document was stuck in PROCESSING, cancel any previous unfinished run
    if (document.currentRunId) {
      await prisma.documentExtractionRun.updateMany({
        where: { id: document.currentRunId, status: { in: ["QUEUED", "RUNNING"] } },
        data: {
          status: "FAILED",
          errorMessage: "Superseded by retry",
          completedAt: new Date(),
        },
      }).catch(() => {});
    }

    const defaultConfig = modelGateway.getDefaultConfig();
    const modelConfig = {
      provider: (process.env.DOCUMENT_PROCESSOR_PROVIDER || defaultConfig.provider) as "groq" | "openai" | "openrouter" | "ollama",
      model: process.env.DOCUMENT_PROCESSOR_MODEL || defaultConfig.model,
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
