import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";
import { storeFile, validateFile } from "@/server/storage";
import { checkPermission } from "@/server/permissions";
import { checkRateLimit, createRateLimitResponse } from "@/server/rate-limit";

export async function POST(request: NextRequest) {
  console.log("[Upload] Starting upload request");
  
  const session = await auth();
  console.log("[Upload] Auth result:", session ? "authenticated" : "not authenticated");
  
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = session.user as { id: string; organizationId: string };
  console.log("[Upload] User:", user.id, "Org:", user.organizationId);

  const rateLimitResult = await checkRateLimit("AI_OR_OCR", `upload_${user.id}`);
  if (!rateLimitResult.success) {
    return createRateLimitResponse(rateLimitResult);
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const tenantId = formData.get("tenantId") as string | null;
    
    console.log("[Upload] File:", file ? file.name : "null", "TenantId:", tenantId);

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (!tenantId) {
      return NextResponse.json({ error: "tenantId is required" }, { status: 400 });
    }

    const validationError = validateFile(file.type, file.size);
    console.log("[Upload] Validation:", validationError || "passed");
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    console.log("[Upload] Checking company access...");
    const company = await prisma.company.findFirst({
      where: {
        id: tenantId,
        organizationId: user.organizationId,
      },
      select: { id: true },
    });
    console.log("[Upload] Company found:", company ? "yes" : "no");

    if (!company) {
      return NextResponse.json(
        { error: "Company not found or access denied" },
        { status: 404 }
      );
    }

    console.log("[Upload] Checking user permissions...");
    console.log("[Upload] Checking user permissions...");
    const hasAccess = await checkPermission(tenantId, "canAccessEntries");
    console.log("[Upload] User access:", hasAccess);

    if (!hasAccess) {
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 }
      );
    }

    console.log("[Upload] Storing file...");
    const buffer = Buffer.from(await file.arrayBuffer());
    const stored = await storeFile(buffer, file.name, file.type);
    console.log("[Upload] File stored:", stored.storagePath);

    console.log("[Upload] Creating document record...");
    const document = await prisma.document.create({
      data: {
        tenantId,
        uploadedById: user.id,
        originalFilename: file.name,
        mimeType: file.type,
        storagePath: stored.storagePath,
        fileSize: stored.fileSize,
        status: "UPLOADED",
      },
    });
    console.log("[Upload] Document created:", document.id);

    console.log("[Upload] Creating audit log...");
    await prisma.auditLog.create({
      data: {
        userId: user.id,
        companyId: tenantId,
        action: "DOCUMENT_UPLOADED",
        entityType: "Document",
        entityId: document.id,
        details: {
          originalFilename: file.name,
          mimeType: file.type,
          fileSize: stored.fileSize,
        },
      },
    });
    console.log("[Upload] Audit log created");

    console.log("[Upload] SUCCESS - returning response");
    return NextResponse.json({
      documentId: document.id,
      status: document.status,
    });
  } catch (error) {
    console.error("[Upload] ERROR:", error);
    if (error instanceof Error) {
      // Stack trace hidden in production
    }
    return NextResponse.json({ error: "Internal server error", details: "An unexpected error occurred" },
      { status: 500 }
    );
  }
}
