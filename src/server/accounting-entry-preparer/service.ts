import {
  AgentRunStatus,
  AgentType,
  EntryStatus,
  JournalType,
  Prisma,
} from "@prisma/client";
import { prisma } from "@/server/prisma";
import { agentRunner } from "@/server/agents";
import { contextBuilder } from "@/server/agents/core/context-builder";
import {
  AccountingEntryProposalOutput,
  accountingEntrySuggestionSchema,
  accountingEntryPreparerOutputSchema,
} from "@/server/agents/schemas";
import { persistAgentSuggestions } from "@/server/suggestions/service";

type TransactionType = "PURCHASE" | "SALE" | "BANK" | "OTHER";

interface ProposalFieldRecord {
  fieldName: string;
  fieldValue: unknown;
  correctedValue: unknown;
  reviewStatus: string;
}

interface CompanyJournalRecord {
  id: string;
  code: string;
  label: string;
  type: JournalType;
}

interface CompanyAccountRecord {
  code: string;
  label: string;
  classNumber: number;
  accountType: string;
}

interface HistoricalEntryRecord {
  journal: {
    code: string;
    label: string;
    type: JournalType;
  };
  description: string;
  reference: string | null;
  entryDate: Date;
  lines: Array<{
    accountCode: string;
    label: string;
    debit: Prisma.Decimal;
    credit: Prisma.Decimal;
    account: {
      label: string;
    };
  }>;
}

interface LoadedProposalContext {
  companyId: string;
  companyName: string;
  currency: string;
  document: {
    id: string;
    originalFilename: string;
    documentType: string | null;
    approvedAt: Date | null;
  };
  reviewedDocument: {
    documentType: string | null;
    fields: Record<string, unknown>;
    lineItems: Array<Record<string, unknown>>;
    warnings: string[];
  };
  journals: CompanyJournalRecord[];
  accounts: CompanyAccountRecord[];
  historicalEntries: HistoricalEntryRecord[];
}

function normalizeReviewStatus(status: string) {
  if (status === "ACCEPTED") return "APPROVED";
  if (status === "REVIEWED") return "REJECTED";
  return status;
}

function getResolvedFieldValue(field: ProposalFieldRecord) {
  const normalizedStatus = normalizeReviewStatus(field.reviewStatus);
  if (normalizedStatus === "REJECTED") {
    return undefined;
  }

  if (normalizedStatus === "CORRECTED" && field.correctedValue !== null) {
    return field.correctedValue;
  }

  return field.fieldValue;
}

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value: string | null | undefined) {
  if (!value) {
    return [];
  }

  return normalizeText(value)
    .split(" ")
    .filter((token) => token.length >= 3);
}

function looksLikeCompanyName(candidate: string | null | undefined, companyName: string) {
  if (!candidate) {
    return false;
  }

  const normalizedCandidate = normalizeText(candidate);
  const normalizedCompany = normalizeText(companyName);
  return (
    normalizedCandidate.length > 0 &&
    normalizedCompany.length > 0 &&
    (normalizedCandidate.includes(normalizedCompany) ||
      normalizedCompany.includes(normalizedCandidate))
  );
}

function parseNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  let sanitized = trimmed.replace(/[^\d,.\-]/g, "");
  if (!sanitized) {
    return null;
  }

  if (sanitized.includes(",") && sanitized.includes(".")) {
    if (sanitized.lastIndexOf(",") > sanitized.lastIndexOf(".")) {
      sanitized = sanitized.replace(/\./g, "").replace(",", ".");
    } else {
      sanitized = sanitized.replace(/,/g, "");
    }
  } else if (sanitized.includes(",")) {
    sanitized = sanitized.replace(",", ".");
  }

  const numericValue = Number(sanitized);
  return Number.isFinite(numericValue) ? numericValue : null;
}

function firstString(values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}

function firstNumber(values: unknown[]) {
  for (const value of values) {
    const numericValue = parseNumber(value);
    if (numericValue !== null) {
      return numericValue;
    }
  }

  return null;
}

function coerceDate(value: unknown) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString().slice(0, 10);
}

function buildReviewedDocument(fields: ProposalFieldRecord[], documentType: string | null) {
  const reviewedFields: Record<string, unknown> = {};
  const lineItems = new Map<number, Record<string, unknown>>();
  let warnings: string[] = [];

  for (const field of fields) {
    const resolvedValue = getResolvedFieldValue(field);
    if (resolvedValue === undefined) {
      continue;
    }

    if (field.fieldName === "warnings") {
      if (Array.isArray(resolvedValue)) {
        warnings = resolvedValue.filter((value): value is string => typeof value === "string");
      }
      continue;
    }

    if (field.fieldName === "document_type") {
      reviewedFields.document_type = resolvedValue;
      continue;
    }

    const lineItemMatch = /^line_items\[(\d+)\]\.(.+)$/.exec(field.fieldName);
    if (lineItemMatch) {
      const index = Number(lineItemMatch[1]);
      const key = lineItemMatch[2]!;
      const currentLine = lineItems.get(index) ?? {};
      currentLine[key] = resolvedValue;
      lineItems.set(index, currentLine);
      continue;
    }

    if (field.fieldName.startsWith("fields.")) {
      reviewedFields[field.fieldName.slice("fields.".length)] = resolvedValue;
      continue;
    }

    reviewedFields[field.fieldName] = resolvedValue;
  }

  return {
    documentType:
      typeof reviewedFields.document_type === "string"
        ? reviewedFields.document_type
        : documentType,
    fields: reviewedFields,
    lineItems: Array.from(lineItems.entries())
      .sort((left, right) => left[0] - right[0])
      .map(([, value]) => value),
    warnings,
  };
}

function inferTransactionType(
  reviewedFields: Record<string, unknown>,
  documentType: string | null,
  companyName: string
): TransactionType {
  const supplierName = firstString([
    reviewedFields.supplier_name,
    reviewedFields.vendor_name,
    reviewedFields.merchant_name,
    reviewedFields.issuer_name,
  ]);
  const customerName = firstString([
    reviewedFields.customer_name,
    reviewedFields.client_name,
    reviewedFields.bill_to_name,
  ]);
  const normalizedDocumentType = normalizeText(documentType ?? "");

  if (normalizedDocumentType.includes("bank")) {
    return "BANK";
  }

  if (supplierName && looksLikeCompanyName(supplierName, companyName)) {
    return "SALE";
  }

  if (customerName && looksLikeCompanyName(customerName, companyName)) {
    return "PURCHASE";
  }

  if (supplierName) {
    return "PURCHASE";
  }

  if (customerName) {
    return "SALE";
  }

  if (
    normalizedDocumentType.includes("invoice") ||
    normalizedDocumentType.includes("receipt") ||
    normalizedDocumentType.includes("utility")
  ) {
    return "PURCHASE";
  }

  return "OTHER";
}

function pickJournal(journals: CompanyJournalRecord[], transactionType: TransactionType) {
  const preferredTypes: JournalType[] =
    transactionType === "PURCHASE"
      ? ["PURCHASES", "MISCELLANEOUS", "OTHER"]
      : transactionType === "SALE"
        ? ["SALES", "MISCELLANEOUS", "OTHER"]
        : transactionType === "BANK"
          ? ["BANK", "MISCELLANEOUS", "OTHER"]
          : ["MISCELLANEOUS", "OTHER", "PURCHASES", "SALES", "BANK"];

  for (const type of preferredTypes) {
    const journal = journals.find((candidate) => candidate.type === type);
    if (journal) {
      return journal;
    }
  }

  return journals[0] ?? null;
}

function calculateEntryScore(
  entry: HistoricalEntryRecord,
  transactionType: TransactionType,
  counterpartyTokens: string[],
  referenceTokens: string[]
) {
  let score = 0;

  if (
    (transactionType === "PURCHASE" && entry.journal.type === "PURCHASES") ||
    (transactionType === "SALE" && entry.journal.type === "SALES") ||
    (transactionType === "BANK" && entry.journal.type === "BANK")
  ) {
    score += 8;
  }

  const haystack = normalizeText(
    `${entry.description} ${entry.reference ?? ""} ${entry.lines.map((line) => line.label).join(" ")}`
  );

  for (const token of counterpartyTokens) {
    if (haystack.includes(token)) {
      score += 4;
    }
  }

  for (const token of referenceTokens) {
    if (haystack.includes(token)) {
      score += 3;
    }
  }

  return score;
}

function rankSimilarEntries(
  historicalEntries: HistoricalEntryRecord[],
  transactionType: TransactionType,
  counterpartyName: string | null,
  reference: string | null
) {
  const counterpartyTokens = tokenize(counterpartyName);
  const referenceTokens = tokenize(reference);

  return historicalEntries
    .map((entry) => ({
      entry,
      score: calculateEntryScore(entry, transactionType, counterpartyTokens, referenceTokens),
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score)
    .map((candidate) => candidate.entry);
}

function scoreAccount(
  account: CompanyAccountRecord,
  usageByCode: Map<string, number>,
  prefixHints: string[],
  labelKeywords: string[]
) {
  let score = usageByCode.get(account.code) ?? 0;
  const normalizedLabel = normalizeText(account.label);

  for (const prefix of prefixHints) {
    if (account.code.startsWith(prefix)) {
      score += 20;
    }
  }

  for (const keyword of labelKeywords) {
    if (normalizedLabel.includes(normalizeText(keyword))) {
      score += 12;
    }
  }

  return score;
}

function pickAccount(
  accounts: CompanyAccountRecord[],
  usageByCode: Map<string, number>,
  prefixHints: string[],
  labelKeywords: string[]
) {
  const ranked = accounts
    .map((account) => ({
      account,
      score: scoreAccount(account, usageByCode, prefixHints, labelKeywords),
    }))
    .sort((left, right) => right.score - left.score);

  return ranked[0]?.account ?? null;
}

function buildRelevantAccounts(
  accounts: CompanyAccountRecord[],
  transactionType: TransactionType,
  similarEntries: HistoricalEntryRecord[]
) {
  const usageByCode = new Map<string, number>();

  for (const entry of similarEntries) {
    for (const line of entry.lines) {
      usageByCode.set(line.accountCode, (usageByCode.get(line.accountCode) ?? 0) + 1);
    }
  }

  const keywordsByType: Record<TransactionType, string[]> = {
    PURCHASE: ["fournisseur", "charge", "achat", "tva"],
    SALE: ["client", "vente", "produit", "tva"],
    BANK: ["banque", "bank", "virement", "tresorerie"],
    OTHER: ["operation", "divers", "charge", "produit"],
  };
  const prefixByType: Record<TransactionType, string[]> = {
    PURCHASE: ["6", "441", "445", "345"],
    SALE: ["7", "342", "445", "443"],
    BANK: ["5", "471", "514"],
    OTHER: ["6", "7", "4", "5"],
  };

  return accounts
    .map((account) => ({
      account,
      score: scoreAccount(
        account,
        usageByCode,
        prefixByType[transactionType],
        keywordsByType[transactionType]
      ),
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, 60)
    .map((candidate) => candidate.account);
}

function getDocumentAmounts(
  reviewedFields: Record<string, unknown>,
  lineItems: Array<Record<string, unknown>>
) {
  const vatAmount = firstNumber([
    reviewedFields.vat_amount,
    reviewedFields.tax_amount,
    reviewedFields.tva_amount,
  ]);
  const subtotal =
    firstNumber([
      reviewedFields.subtotal,
      reviewedFields.total_ht,
      reviewedFields.amount_excluding_tax,
      reviewedFields.net_amount,
      reviewedFields.taxable_amount,
    ]) ??
    lineItems.reduce((sum, lineItem) => {
      const lineTotal = firstNumber([
        lineItem.line_total,
        lineItem.total,
        lineItem.amount,
        lineItem.net_amount,
      ]);
      return sum + (lineTotal ?? 0);
    }, 0);

  const totalAmount =
    firstNumber([
      reviewedFields.total_amount,
      reviewedFields.grand_total,
      reviewedFields.amount_due,
      reviewedFields.total_ttc,
      reviewedFields.total,
      reviewedFields.net_pay,
    ]) ??
    (subtotal && vatAmount !== null ? subtotal + vatAmount : null);

  return {
    subtotal: subtotal > 0 ? subtotal : null,
    vatAmount,
    totalAmount,
  };
}

function getCounterpartyName(
  reviewedFields: Record<string, unknown>,
  transactionType: TransactionType
) {
  if (transactionType === "SALE") {
    return firstString([
      reviewedFields.customer_name,
      reviewedFields.client_name,
      reviewedFields.bill_to_name,
      reviewedFields.buyer_name,
    ]);
  }

  return firstString([
    reviewedFields.supplier_name,
    reviewedFields.vendor_name,
    reviewedFields.merchant_name,
    reviewedFields.issuer_name,
  ]);
}

function buildFallbackProposal(context: LoadedProposalContext): AccountingEntryProposalOutput {
  const { reviewedDocument, journals, accounts, document, historicalEntries, companyName } = context;
  const transactionType = inferTransactionType(
    reviewedDocument.fields,
    reviewedDocument.documentType,
    companyName
  );
  const journal = pickJournal(journals, transactionType);

  if (!journal) {
    throw new Error("No active journal is configured for this company.");
  }

  const counterpartyName = getCounterpartyName(reviewedDocument.fields, transactionType);
  const reference = firstString([
    reviewedDocument.fields.invoice_number,
    reviewedDocument.fields.receipt_number,
    reviewedDocument.fields.reference_number,
    reviewedDocument.fields.document_number,
  ]);
  const similarEntries = rankSimilarEntries(
    historicalEntries,
    transactionType,
    counterpartyName,
    reference
  );

  const usageByCode = new Map<string, number>();
  for (const entry of similarEntries) {
    for (const line of entry.lines) {
      usageByCode.set(line.accountCode, (usageByCode.get(line.accountCode) ?? 0) + 1);
    }
  }

  const { subtotal, vatAmount, totalAmount } = getDocumentAmounts(
    reviewedDocument.fields,
    reviewedDocument.lineItems
  );
  const entryDate =
    firstString([
      coerceDate(reviewedDocument.fields.invoice_date),
      coerceDate(reviewedDocument.fields.issue_date),
      coerceDate(reviewedDocument.fields.transaction_date),
      coerceDate(reviewedDocument.fields.date),
    ]) ?? new Date().toISOString().slice(0, 10);

  if (totalAmount === null || totalAmount <= 0) {
    throw new Error("The approved document does not contain a usable total amount for entry preparation.");
  }

  const primaryAccount =
    transactionType === "SALE"
      ? pickAccount(accounts, usageByCode, ["7"], ["vente", "produit", "service"])
      : pickAccount(accounts, usageByCode, ["6"], ["charge", "achat", "frais", "service"]);
  const taxAccount =
    vatAmount && vatAmount > 0
      ? transactionType === "SALE"
        ? pickAccount(accounts, usageByCode, ["445", "443"], ["tva", "etat"])
        : pickAccount(accounts, usageByCode, ["345", "445"], ["tva", "etat"])
      : null;
  const counterpartyAccount =
    transactionType === "SALE"
      ? pickAccount(accounts, usageByCode, ["342", "341", "411"], ["client"])
      : transactionType === "BANK"
        ? pickAccount(accounts, usageByCode, ["514", "512", "511"], ["banque", "bank"])
        : pickAccount(accounts, usageByCode, ["441", "442", "401"], ["fournisseur", "supplier"]);

  const warnings = [...reviewedDocument.warnings];
  if (!primaryAccount) {
    warnings.push("No strong expense or revenue account match was found. Review the primary account carefully.");
  }
  if (!counterpartyAccount) {
    warnings.push("No strong counterparty account match was found. Review the balancing account carefully.");
  }
  if (vatAmount && vatAmount > 0 && !taxAccount) {
    warnings.push("VAT was detected on the document, but no strong VAT account match was found.");
  }

  const lines: AccountingEntryProposalOutput["suggestions"][number]["proposedEntry"]["lines"] = [];
  const accountClassification: NonNullable<
    AccountingEntryProposalOutput["suggestions"][number]["accountClassification"]
  > = [];

  const effectiveSubtotal =
    subtotal ??
    (vatAmount !== null && vatAmount > 0 ? Math.max(totalAmount - vatAmount, 0) : totalAmount);

  if (transactionType === "SALE") {
    lines.push({
      lineNumber: 1,
      accountCode: counterpartyAccount?.code ?? "",
      accountLabel: counterpartyAccount?.label ?? "Client a confirmer",
      label: counterpartyName ? `Client ${counterpartyName}` : "Compte client",
      debit: Number(totalAmount.toFixed(2)),
      credit: 0,
      confidence: counterpartyAccount ? 0.82 : 0.42,
      rationale: "Customer balance receives the invoice total.",
    });
    lines.push({
      lineNumber: 2,
      accountCode: primaryAccount?.code ?? "",
      accountLabel: primaryAccount?.label ?? "Produit a confirmer",
      label: reviewedDocument.fields.service_description
        ? String(reviewedDocument.fields.service_description)
        : "Produit ou prestation",
      debit: 0,
      credit: Number(effectiveSubtotal.toFixed(2)),
      confidence: primaryAccount ? 0.8 : 0.42,
      rationale: "Revenue line uses the net amount before VAT.",
    });

    if (vatAmount !== null && vatAmount > 0) {
      lines.push({
        lineNumber: 3,
        accountCode: taxAccount?.code ?? "",
        accountLabel: taxAccount?.label ?? "TVA a confirmer",
        label: "TVA facturee",
        debit: 0,
        credit: Number(vatAmount.toFixed(2)),
        confidence: taxAccount ? 0.78 : 0.38,
        rationale: "Collected VAT is credited separately from revenue.",
      });
    }
  } else {
    lines.push({
      lineNumber: 1,
      accountCode: primaryAccount?.code ?? "",
      accountLabel: primaryAccount?.label ?? "Charge a confirmer",
      label: reviewedDocument.fields.description
        ? String(reviewedDocument.fields.description)
        : reviewedDocument.fields.invoice_description
          ? String(reviewedDocument.fields.invoice_description)
          : "Charge documentee",
      debit: Number(effectiveSubtotal.toFixed(2)),
      credit: 0,
      confidence: primaryAccount ? 0.8 : 0.42,
      rationale: "Primary expense or acquisition line uses the amount before VAT.",
    });

    if (vatAmount !== null && vatAmount > 0) {
      lines.push({
        lineNumber: 2,
        accountCode: taxAccount?.code ?? "",
        accountLabel: taxAccount?.label ?? "TVA a confirmer",
        label: "TVA deductible",
        debit: Number(vatAmount.toFixed(2)),
        credit: 0,
        confidence: taxAccount ? 0.76 : 0.38,
        rationale: "Input VAT is separated when present on the document.",
      });
    }

    lines.push({
      lineNumber: lines.length + 1,
      accountCode: counterpartyAccount?.code ?? "",
      accountLabel: counterpartyAccount?.label ?? "Contrepartie a confirmer",
      label: counterpartyName ? `Contrepartie ${counterpartyName}` : "Compte de contrepartie",
      debit: 0,
      credit: Number(totalAmount.toFixed(2)),
      confidence: counterpartyAccount ? 0.82 : 0.42,
      rationale:
        transactionType === "BANK"
          ? "The balancing line points to the bank account."
          : "Supplier or payable balance carries the document total.",
    });
  }

  if (primaryAccount) {
    accountClassification.push({
      fieldName: "primary_amount",
      matchedAccountCode: primaryAccount.code,
      matchedAccountLabel: primaryAccount.label,
      confidence: primaryAccount ? 0.8 : 0.4,
      reason: "Selected from recurring company usage and account class relevance.",
    });
  }
  if (counterpartyAccount) {
    accountClassification.push({
      fieldName: "counterparty_amount",
      matchedAccountCode: counterpartyAccount.code,
      matchedAccountLabel: counterpartyAccount.label,
      confidence: counterpartyAccount ? 0.82 : 0.42,
      reason: "Selected from counterparty control-account patterns.",
    });
  }
  if (taxAccount && vatAmount && vatAmount > 0) {
    accountClassification.push({
      fieldName: "vat_amount",
      matchedAccountCode: taxAccount.code,
      matchedAccountLabel: taxAccount.label,
      confidence: 0.76,
      reason: "Selected from VAT-specific account labels and prefix patterns.",
    });
  }

  const totalDebit = Number(lines.reduce((sum, line) => sum + line.debit, 0).toFixed(2));
  const totalCredit = Number(lines.reduce((sum, line) => sum + line.credit, 0).toFixed(2));
  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01;

  const confidenceBase = lines.reduce((sum, line) => sum + line.confidence, 0) / lines.length;
  const confidence = Math.max(0.25, Number((confidenceBase - warnings.length * 0.08).toFixed(2)));
  const description =
    transactionType === "SALE"
      ? `Sales entry proposal for ${counterpartyName ?? document.originalFilename}`
      : `Purchase entry proposal for ${counterpartyName ?? document.originalFilename}`;

  return {
    suggestions: [
      {
        type: "PROPOSED_JOURNAL_ENTRY",
        confidence,
        description,
        reason:
          similarEntries.length > 0
            ? "The proposal reuses recurring historical account patterns and the reviewed document totals."
            : "The proposal is based on reviewed document values plus account-class heuristics.",
        proposedEntry: {
          journalCode: journal.code,
          journalLabel: journal.label,
          entryDate,
          reference: reference ?? undefined,
          description,
          documentType: reviewedDocument.documentType ?? undefined,
          lines,
          totalDebit,
          totalCredit,
          isBalanced,
        },
        accountClassification,
        warnings,
      },
    ],
    summary:
      similarEntries.length > 0
        ? "Proposal prepared from approved document values and recurring historical posting patterns."
        : "Proposal prepared from approved document values with rule-based account classification.",
  };
}

function normalizeProposalOutput(
  output: AccountingEntryProposalOutput,
  journals: CompanyJournalRecord[],
  accounts: CompanyAccountRecord[]
) {
  const journalMap = new Map(journals.map((journal) => [journal.code, journal]));
  const accountMap = new Map(accounts.map((account) => [account.code, account]));

  const normalizedSuggestions = output.suggestions.map((suggestion) => {
    const journal = journalMap.get(suggestion.proposedEntry.journalCode);
    if (!journal) {
      throw new Error(`Unknown journal code in proposal: ${suggestion.proposedEntry.journalCode}`);
    }

    const lines = suggestion.proposedEntry.lines.map((line, index) => {
      const account = accountMap.get(line.accountCode);
      if (!account) {
        throw new Error(`Unknown account code in proposal: ${line.accountCode}`);
      }

      return {
        ...line,
        lineNumber: index + 1,
        accountLabel: account.label,
        debit: Number(line.debit.toFixed(2)),
        credit: Number(line.credit.toFixed(2)),
      };
    });

    const totalDebit = Number(lines.reduce((sum, line) => sum + line.debit, 0).toFixed(2));
    const totalCredit = Number(lines.reduce((sum, line) => sum + line.credit, 0).toFixed(2));

    return {
      ...suggestion,
      proposedEntry: {
        ...suggestion.proposedEntry,
        journalCode: journal.code,
        journalLabel: journal.label,
        lines,
        totalDebit,
        totalCredit,
        isBalanced: Math.abs(totalDebit - totalCredit) < 0.01,
      },
    };
  });

  return accountingEntryPreparerOutputSchema.parse({
    ...output,
    suggestions: normalizedSuggestions,
  });
}

async function loadProposalContext(
  documentId: string,
  organizationId: string,
  fiscalYearId?: string
): Promise<LoadedProposalContext> {
  const document = await prisma.document.findUnique({
    where: { id: documentId },
    select: {
      id: true,
      tenantId: true,
      status: true,
      originalFilename: true,
      documentType: true,
      approvedAt: true,
      extractedFields: {
        where: { isCurrent: true },
        orderBy: { fieldName: "asc" },
        select: {
          fieldName: true,
          fieldValue: true,
          correctedValue: true,
          reviewStatus: true,
        },
      },
    },
  });

  if (!document) {
    throw new Error("Document not found.");
  }

  if (document.status !== "APPROVED") {
    throw new Error("Only approved documents can be used for accounting entry preparation.");
  }

  const company = await prisma.company.findFirst({
    where: {
      id: document.tenantId,
      organizationId,
    },
    select: {
      id: true,
      name: true,
      currency: true,
      journals: {
        where: { isActive: true },
        orderBy: { code: "asc" },
        select: {
          id: true,
          code: true,
          label: true,
          type: true,
        },
      },
      accounts: {
        where: { isActive: true },
        orderBy: [{ classNumber: "asc" }, { code: "asc" }],
        select: {
          code: true,
          label: true,
          classNumber: true,
          accountType: true,
        },
      },
    },
  });

  if (!company) {
    throw new Error("Access denied.");
  }

  const historicalEntries = await prisma.journalEntry.findMany({
    where: {
      fiscalYear: {
        is: {
          companyId: company.id,
          ...(fiscalYearId ? { id: fiscalYearId } : {}),
        },
      },
      status: EntryStatus.VALIDATED,
    },
    orderBy: { entryDate: "desc" },
    take: 40,
    select: {
      journal: {
        select: {
          code: true,
          label: true,
          type: true,
        },
      },
      description: true,
      reference: true,
      entryDate: true,
      lines: {
        orderBy: { lineNumber: "asc" },
        select: {
          accountCode: true,
          label: true,
          debit: true,
          credit: true,
          account: {
            select: {
              label: true,
            },
          },
        },
      },
    },
  });

  return {
    companyId: company.id,
    companyName: company.name,
    currency: company.currency,
    document: {
      id: document.id,
      originalFilename: document.originalFilename,
      documentType: document.documentType,
      approvedAt: document.approvedAt,
    },
    reviewedDocument: buildReviewedDocument(
      document.extractedFields as ProposalFieldRecord[],
      document.documentType
    ),
    journals: company.journals,
    accounts: company.accounts.map((account) => ({
      ...account,
      accountType: account.accountType,
    })),
    historicalEntries,
  };
}

function serializeHistoricalEntries(entries: HistoricalEntryRecord[]) {
  return entries.slice(0, 5).map((entry) => ({
    journalCode: entry.journal.code,
    journalLabel: entry.journal.label,
    description: entry.description,
    reference: entry.reference,
    entryDate: entry.entryDate.toISOString().slice(0, 10),
    lines: entry.lines.map((line) => ({
      accountCode: line.accountCode,
      accountLabel: line.account.label,
      debit: Number(line.debit.toFixed(2)),
      credit: Number(line.credit.toFixed(2)),
    })),
  }));
}

function buildAgentInput(context: LoadedProposalContext) {
  const transactionType = inferTransactionType(
    context.reviewedDocument.fields,
    context.reviewedDocument.documentType,
    context.companyName
  );
  const similarEntries = rankSimilarEntries(
    context.historicalEntries,
    transactionType,
    getCounterpartyName(context.reviewedDocument.fields, transactionType),
    firstString([
      context.reviewedDocument.fields.invoice_number,
      context.reviewedDocument.fields.reference_number,
    ])
  );

  return {
    documentId: context.document.id,
    validatedDocument: {
      originalFilename: context.document.originalFilename,
      documentType: context.reviewedDocument.documentType ?? undefined,
      approvedAt: context.document.approvedAt?.toISOString(),
      fields: context.reviewedDocument.fields,
      lineItems: context.reviewedDocument.lineItems,
      warnings: context.reviewedDocument.warnings,
    },
    availableJournals: context.journals.map((journal) => ({
      code: journal.code,
      label: journal.label,
      type: journal.type,
    })),
    relevantAccounts: buildRelevantAccounts(context.accounts, transactionType, similarEntries),
    historicalEntries: serializeHistoricalEntries(similarEntries),
  };
}

async function upsertNormalizedSuggestions(
  agentRunId: string,
  documentId: string,
  output: AccountingEntryProposalOutput
) {
  await prisma.agentRun.update({
    where: { id: agentRunId },
    data: {
      structuredOutput: output as Prisma.InputJsonValue,
    },
  });

  for (let index = 0; index < output.suggestions.length; index += 1) {
    const suggestion = output.suggestions[index]!;
    await prisma.suggestion.updateMany({
      where: {
        agentRunId,
        sourceKey: `suggestions[${index}]`,
      },
      data: {
        documentId,
        label: suggestion.description,
        value: suggestion as Prisma.InputJsonValue,
      },
    });
  }
}

async function createFallbackAgentRun(
  context: LoadedProposalContext,
  userId: string,
  userPrompt: string,
  inputData: Record<string, unknown>,
  output: AccountingEntryProposalOutput,
  fiscalYearId?: string
) {
  const startTime = Date.now();
  const agentContext = await contextBuilder.buildContext(
    context.companyId,
    userId,
    userPrompt,
    inputData,
    {
      includeHistoricalPatterns: true,
      patternLimit: 10,
      fiscalYearId,
    }
  );

  const agentRun = await prisma.agentRun.create({
    data: {
      companyId: context.companyId,
      userId,
      agentType: AgentType.ACCOUNTING_ENTRY_PREPARER,
      status: AgentRunStatus.COMPLETED,
      inputSnapshot: {
        userPrompt,
        inputData,
      } as Prisma.InputJsonValue,
      contextSnapshot: contextBuilder.sanitizeForAgent(agentContext) as Prisma.InputJsonValue,
      modelProvider: "internal",
      modelVersion: "heuristic-v1",
      structuredOutput: output as Prisma.InputJsonValue,
      rawOutput: JSON.stringify(output),
      confidence: new Prisma.Decimal(output.suggestions[0]?.confidence ?? 0.5),
      durationMs: Date.now() - startTime,
      completedAt: new Date(),
    },
  });

  await persistAgentSuggestions({
    companyId: context.companyId,
    agentRunId: agentRun.id,
    agentType: AgentType.ACCOUNTING_ENTRY_PREPARER,
    output: output as Record<string, unknown>,
    documentId: context.document.id,
  });

  return agentRun.id;
}

async function supersedeOlderCurrentProposals(documentId: string, currentAgentRunId: string) {
  await prisma.suggestion.updateMany({
    where: {
      documentId,
      agentType: AgentType.ACCOUNTING_ENTRY_PREPARER,
      isCurrent: true,
      agentRunId: {
        not: currentAgentRunId,
      },
    },
    data: {
      isCurrent: false,
    },
  });
}

export async function getCurrentDocumentEntryProposal(
  documentId: string,
  organizationId: string
) {
  const document = await prisma.document.findUnique({
    where: { id: documentId },
    select: {
      id: true,
      tenantId: true,
    },
  });

  if (!document) {
    throw new Error("Document not found.");
  }

  const company = await prisma.company.findFirst({
    where: {
      id: document.tenantId,
      organizationId,
    },
    select: { id: true },
  });

  if (!company) {
    throw new Error("Access denied.");
  }

  const suggestion = await prisma.suggestion.findFirst({
    where: {
      documentId,
      agentType: AgentType.ACCOUNTING_ENTRY_PREPARER,
      isCurrent: true,
    },
    orderBy: { createdAt: "desc" },
    include: {
      agentRun: {
        select: {
          id: true,
          modelVersion: true,
          createdAt: true,
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
    return null;
  }

  const rawSuggestionValue = (suggestion.finalValue ??
    suggestion.value) as Prisma.JsonValue | null;
  const parsedSuggestion = accountingEntrySuggestionSchema.parse(rawSuggestionValue);

  return {
    id: suggestion.id,
    status: suggestion.status,
    reviewNotes: suggestion.reviewNotes,
    reviewedAt: suggestion.reviewedAt,
    reviewedBy: suggestion.reviewedBy,
    createdAt: suggestion.createdAt,
    agentRun: suggestion.agentRun,
    summary:
      suggestion.agentRun &&
      typeof suggestion.agentRun.structuredOutput === "object" &&
      suggestion.agentRun.structuredOutput !== null &&
      "summary" in suggestion.agentRun.structuredOutput
        ? (suggestion.agentRun.structuredOutput as Record<string, unknown>).summary
        : null,
    suggestion: parsedSuggestion,
    reviewEvents: suggestion.reviewEvents,
  };
}

export async function generateDocumentEntryProposal(input: {
  documentId: string;
  organizationId: string;
  userId: string;
  fiscalYearId?: string;
}) {
  const context = await loadProposalContext(
    input.documentId,
    input.organizationId,
    input.fiscalYearId
  );
  const userPrompt = `Prepare a proposed journal entry from the approved document ${context.document.originalFilename}.`;
  const agentInput = {
    fiscalYearId: input.fiscalYearId,
    ...buildAgentInput(context),
  };

  let agentRunId: string | null = null;

  try {
    const result = await agentRunner.run<AccountingEntryProposalOutput>(
      context.companyId,
      input.userId,
      {
        agentType: AgentType.ACCOUNTING_ENTRY_PREPARER,
        userPrompt,
        inputData: agentInput,
      }
    );

    if (!result.success || !result.output) {
      throw new Error(result.error || "Agent proposal generation failed.");
    }

    const normalizedOutput = normalizeProposalOutput(
      accountingEntryPreparerOutputSchema.parse(result.output),
      context.journals,
      context.accounts
    );

    agentRunId = result.runId;
    await upsertNormalizedSuggestions(result.runId, context.document.id, normalizedOutput);
  } catch (error) {
    console.warn(
      "[AccountingEntryPreparer] Falling back to deterministic proposal generation.",
      error
    );

    const fallbackOutput = normalizeProposalOutput(
      buildFallbackProposal(context),
      context.journals,
      context.accounts
    );

    agentRunId = await createFallbackAgentRun(
      context,
      input.userId,
      userPrompt,
      agentInput,
      fallbackOutput,
      input.fiscalYearId
    );
  }

  await supersedeOlderCurrentProposals(context.document.id, agentRunId);
  return getCurrentDocumentEntryProposal(context.document.id, input.organizationId);
}
