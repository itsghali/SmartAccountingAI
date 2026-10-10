import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";
import { contextBuilder } from "@/server/agents";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = session.user as { id: string; organizationId: string };

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get("companyId");
  const fiscalYearId = searchParams.get("fiscalYearId");
  const includePatterns = searchParams.get("patterns") === "true";

  if (!companyId) {
    return NextResponse.json(
      { error: "companyId query parameter is required" },
      { status: 400 }
    );
  }

  try {
    const company = await prisma.company.findFirst({
      where: {
        id: companyId,
        organizationId: user.organizationId,
      },
      select: { id: true, name: true },
    });

    if (!company) {
      return NextResponse.json(
        { error: "Company not found or access denied" },
        { status: 404 }
      );
    }

    const context = await contextBuilder.buildContext(
      companyId,
      user.id,
      "",
      {},
      {
        includeHistoricalPatterns: includePatterns,
        patternLimit: 10,
        fiscalYearId: fiscalYearId || undefined,
      }
    );

    const sanitizedContext = contextBuilder.sanitizeForAgent(context);

    return NextResponse.json({
      context: sanitizedContext,
    });
  } catch (error) {
    console.error("Context builder error:", error);
    return NextResponse.json(
      { error: "Failed to build context" },
      { status: 500 }
    );
  }
}
