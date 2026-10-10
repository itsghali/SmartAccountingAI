import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { checkPermission } from "@/server/permissions";
import { computeTrialBalance } from "@/server/calculations/balance";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  const companyId = params.get("companyId");
  const fiscalYearId = params.get("fiscalYearId");
  const startDateStr = params.get("startDate");
  const endDateStr = params.get("endDate");
  const status = params.get("status"); // DRAFT | VALIDATED | all

  if (!companyId || !fiscalYearId) {
    return NextResponse.json(
      { error: "companyId et fiscalYearId requis" },
      { status: 400 }
    );
  }

  if (!(await checkPermission(companyId, "canAccessReports"))) {
    return NextResponse.json({ error: "Forbidden: No access to reports" }, { status: 403 });
  }

  const startDate = startDateStr ? new Date(startDateStr) : undefined;
  const endDate = endDateStr ? new Date(endDateStr) : undefined;
  const statusFilter = (status === "DRAFT" || status === "VALIDATED") ? status : undefined;

  const result = await computeTrialBalance(
    companyId,
    fiscalYearId,
    startDate,
    endDate,
    statusFilter
  );

  const accounts = result.accounts.map(acc => ({
    code: acc.accountCode,
    label: acc.accountLabel,
    classNumber: acc.classNumber,
    accountType: "UNKNOWN", // Fallback for backwards compatibility
    totalDebit: acc.totalDebit.toFixed(2),
    totalCredit: acc.totalCredit.toFixed(2),
    soldeDebit: acc.soldeDebit.toFixed(2),
    soldeCredit: acc.soldeCredit.toFixed(2),
  }));

  return NextResponse.json({
    accounts,
    totals: {
      totalDebit: result.totalDebit.toFixed(2),
      totalCredit: result.totalCredit.toFixed(2),
      soldeDebit: result.totalSoldeDebit.toFixed(2),
      soldeCredit: result.totalSoldeCredit.toFixed(2),
    },
  });
}
