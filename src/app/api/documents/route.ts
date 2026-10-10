import { NextRequest, NextResponse } from "next/server";
import { AgentType, DocumentStatus, Prisma } from "@prisma/client";
import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";
import { checkPermission } from "@/server/permissions";
import logger from "@/server/logger";

export async function GET(request: NextRequest) {
  logger.info({ action: "DocumentsList_GET_start" });
  
  const session = await auth();
  logger.info({ action: "DocumentsList_Auth", authenticated: !!session });
  
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = session.user;
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const page = parseInt(searchParams.get("page") || "1", 10);
  const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10), 100);
  const tenantId = searchParams.get("tenantId") || searchParams.get("companyId");

  logger.info({ action: "DocumentsList_Params", tenantId, status, page, limit });

  if (!tenantId) {
    return NextResponse.json({ error: "tenantId is required" }, { status: 400 });
  }

  try {
    logger.info({ action: "DocumentsList_CheckAccess", tenantId });
    const company = await prisma.company.findFirst({
      where: {
        id: tenantId,
        organizationId: user.organizationId,
      },
      select: { id: true },
    });

    if (!company) {
      logger.warn({ action: "DocumentsList_AccessDenied", tenantId, userId: user.id });
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    if (!(await checkPermission(tenantId, "canAccessEntries"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const where: Prisma.DocumentWhereInput = {
      tenantId,
      ...(status ? { status: status as DocumentStatus } : {}),
    };

    logger.info({ action: "DocumentsList_Fetching", tenantId, status });
    const [documents, total] = await Promise.all([
      prisma.document.findMany({
        where,
        include: {
          approvedBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
            },
          },
          extractionRuns: {
            orderBy: { createdAt: "desc" },
            take: 1,
          },
          suggestions: {
            where: {
              isCurrent: true,
              agentType: {
                in: [AgentType.ACCOUNTING_ENTRY_PREPARER, AgentType.TAX_SUPPORT],
              },
            },
            orderBy: { createdAt: "desc" },
            select: {
              id: true,
              agentType: true,
              status: true,
              createdAt: true,
              reviewedAt: true,
            },
          },
          _count: {
            select: {
              extractedFields: true,
            },
          },
        },
        orderBy:
          status === "APPROVED"
            ? { approvedAt: "desc" }
            : { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.document.count({ where }),
    ]);

    logger.info({ action: "DocumentsList_Success", count: documents.length });
    return NextResponse.json({ documents, total, page, limit });
  } catch (error) {
    logger.error({ action: "DocumentsList_Error", error });
    if (error instanceof Error) {
      // Stack trace hidden in production
    }
    return NextResponse.json({ error: "Internal server error", details: "An unexpected error occurred" },
      { status: 500 }
    );
  }
}
