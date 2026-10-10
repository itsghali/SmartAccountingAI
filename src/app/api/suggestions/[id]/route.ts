import { NextRequest, NextResponse } from "next/server";
import { AgentType, SuggestionStatus } from "@prisma/client";
import { z } from "zod";
import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";
import {
  accountingEntrySuggestionSchema,
  taxSupportDeterminationSchema,
} from "@/server/agents/schemas";
import { reviewSuggestion } from "@/server/suggestions/service";

const reviewSchema = z
  .object({
    status: z.enum(["APPROVED", "REJECTED", "CORRECTED"]),
    correctedValue: z.unknown().optional(),
    notes: z.string().max(2000).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.status === "CORRECTED" && value.correctedValue === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["correctedValue"],
        message: "correctedValue is required when status is CORRECTED",
      });
    }
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
  const { id: suggestionId } = await params;

  try {
    const suggestion = await prisma.suggestion.findUnique({
      where: { id: suggestionId },
      include: {
        document: {
          select: {
            id: true,
            originalFilename: true,
            status: true,
          },
        },
        agentRun: {
          select: {
            id: true,
            agentType: true,
            createdAt: true,
            modelVersion: true,
            structuredOutput: true,
          },
        },
        reviewedBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
        reviewEvents: {
          orderBy: { createdAt: "desc" },
          include: {
            reviewedBy: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
              },
            },
          },
        },
      },
    });

    if (!suggestion) {
      return NextResponse.json({ error: "Suggestion not found" }, { status: 404 });
    }

    const company = await prisma.company.findFirst({
      where: {
        id: suggestion.companyId,
        organizationId: user.organizationId,
      },
      select: { id: true },
    });

    if (!company) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    return NextResponse.json({ suggestion });
  } catch {
    // Error logged internally
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = session.user as { id: string; organizationId: string };
  const { id: suggestionId } = await params;

  try {
    const body = await request.json();
    const validation = reviewSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid input", details: validation.error.format() },
        { status: 400 }
      );
    }

    const suggestion = await prisma.suggestion.findUnique({
      where: { id: suggestionId },
      select: {
        id: true,
        companyId: true,
        isCurrent: true,
        documentId: true,
        agentType: true,
      },
    });

    if (!suggestion) {
      return NextResponse.json({ error: "Suggestion not found" }, { status: 404 });
    }

    if (!suggestion.isCurrent) {
      return NextResponse.json(
        { error: "Historical suggestions are read-only" },
        { status: 400 }
      );
    }

    const company = await prisma.company.findFirst({
      where: {
        id: suggestion.companyId,
        organizationId: user.organizationId,
      },
      select: { id: true },
    });

    if (!company) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const correctedValue =
      validation.data.status === "CORRECTED"
        ? normalizeCorrectedValue(suggestion.agentType, validation.data.correctedValue)
        : validation.data.correctedValue;

    const updatedSuggestion = await reviewSuggestion({
      suggestionId,
      reviewedById: user.id,
      status: validation.data.status as SuggestionStatus,
      correctedValue,
      notes: validation.data.notes,
    });

    await prisma.auditLog.create({
      data: {
        userId: user.id,
        companyId: suggestion.companyId,
        action: "SUGGESTION_REVIEWED",
        entityType: "Suggestion",
        entityId: suggestionId,
        details: {
          documentId: suggestion.documentId,
          status: validation.data.status,
          correctedValue: correctedValue ?? null,
          notes: validation.data.notes ?? null,
        },
      },
    });

    return NextResponse.json({ suggestion: updatedSuggestion });
  } catch (error) {
    console.error("Review suggestion error:", error);
    // Error logged internally
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

function roundNumber(value: number, decimals: number = 2) {
  return Number(value.toFixed(decimals));
}

function normalizeCorrectedValue(agentType: AgentType, correctedValue: unknown) {
  switch (agentType) {
    case AgentType.ACCOUNTING_ENTRY_PREPARER: {
      const parsed = accountingEntrySuggestionSchema.parse(correctedValue);
      const normalizedLines = parsed.proposedEntry.lines.map((line, index) => ({
        ...line,
        lineNumber: index + 1,
        debit: roundNumber(line.debit),
        credit: roundNumber(line.credit),
      }));
      const totalDebit = roundNumber(
        normalizedLines.reduce((sum, line) => sum + line.debit, 0)
      );
      const totalCredit = roundNumber(
        normalizedLines.reduce((sum, line) => sum + line.credit, 0)
      );

      return {
        ...parsed,
        warnings: parsed.warnings?.filter((warning) => warning.trim().length > 0),
        proposedEntry: {
          ...parsed.proposedEntry,
          reference: parsed.proposedEntry.reference?.trim() || undefined,
          lines: normalizedLines,
          totalDebit,
          totalCredit,
          isBalanced: Math.abs(totalDebit - totalCredit) < 0.01,
        },
      };
    }

    case AgentType.TAX_SUPPORT: {
      const parsed = taxSupportDeterminationSchema.parse(correctedValue);

      return {
        ...parsed,
        warnings: parsed.warnings?.filter((warning) => warning.trim().length > 0),
        edgeCases: parsed.edgeCases?.filter((edgeCase) => edgeCase.trim().length > 0),
        engineResult: {
          ...parsed.engineResult,
          category: parsed.category,
          vatApplicability: parsed.vatApplicability,
          vatTreatment: parsed.vatTreatment,
          taxableBase: roundNumber(parsed.engineResult.taxableBase),
          vatRatePercent: roundNumber(parsed.engineResult.vatRatePercent, 4),
          vatAmount: roundNumber(parsed.engineResult.vatAmount),
          totalAmount: roundNumber(parsed.engineResult.totalAmount),
          deductibleVATAmount: roundNumber(parsed.engineResult.deductibleVATAmount),
          collectedVATAmount: roundNumber(parsed.engineResult.collectedVATAmount),
          engineNotes: parsed.engineResult.engineNotes.filter(
            (note) => note.trim().length > 0
          ),
          edgeCases: parsed.engineResult.edgeCases.filter(
            (edgeCase) => edgeCase.trim().length > 0
          ),
        },
      };
    }

    default:
      return correctedValue;
  }
}
