"use client";

import { useDeferredValue, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarClock,
  CheckCircle2,
  FileStack,
  Search,
  ShieldCheck,
} from "lucide-react";
import { useAppContext } from "@/hooks/useAppContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface ApprovedDocument {
  id: string;
  originalFilename: string;
  documentType: string | null;
  approvedAt: string | null;
  createdAt: string;
  approvedBy: {
    id: string;
    firstName: string;
    lastName: string;
  } | null;
  suggestions: {
    id: string;
    agentType: "ACCOUNTING_ENTRY_PREPARER" | "TAX_SUPPORT";
    status: "PENDING" | "APPROVED" | "REJECTED" | "CORRECTED";
    createdAt: string;
    reviewedAt: string | null;
  }[];
  _count: {
    extractedFields: number;
  };
}

function formatDateTime(value: string | null) {
  if (!value) {
    return "-";
  }

  return new Date(value).toLocaleString();
}

function formatReviewer(document: ApprovedDocument) {
  if (!document.approvedBy) {
    return "-";
  }

  return `${document.approvedBy.firstName} ${document.approvedBy.lastName}`;
}

function getArtifactStatus(
  document: ApprovedDocument,
  agentType: "ACCOUNTING_ENTRY_PREPARER" | "TAX_SUPPORT"
) {
  return document.suggestions.find((suggestion) => suggestion.agentType === agentType) ?? null;
}

function artifactBadgeClass(
  status: ApprovedDocument["suggestions"][number]["status"] | "NOT_GENERATED"
) {
  switch (status) {
    case "APPROVED":
      return "bg-green-100 text-green-700";
    case "CORRECTED":
      return "bg-blue-100 text-blue-700";
    case "REJECTED":
      return "bg-red-100 text-red-700";
    case "PENDING":
      return "bg-amber-100 text-amber-700";
    default:
      return "bg-slate-100 text-slate-700";
  }
}

function formatArtifactLabel(
  status: ApprovedDocument["suggestions"][number]["status"] | "NOT_GENERATED"
) {
  if (status === "NOT_GENERATED") {
    return "Not generated";
  }

  return status.replaceAll("_", " ");
}

function isSameCalendarDay(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

export default function ApprovedDocumentsPage() {
  const { currentCompanyId, companies } = useAppContext();
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);

  const currentCompany = companies.find((company) => company.id === currentCompanyId);

  const { data: documents = [], isLoading } = useQuery({
    queryKey: ["approved-documents", currentCompanyId],
    queryFn: async () => {
      if (!currentCompanyId) {
        return [];
      }

      const params = new URLSearchParams({
        tenantId: currentCompanyId,
        status: "APPROVED",
        limit: "200",
      });

      const res = await fetch(`/api/documents?${params.toString()}`);
      if (!res.ok) {
        throw new Error("Failed to fetch approved documents");
      }

      const data = await res.json();
      return data.documents as ApprovedDocument[];
    },
    enabled: !!currentCompanyId,
  });

  const normalizedSearch = deferredSearch.trim().toLowerCase();
  const filteredDocuments = documents.filter((document) => {
    if (!normalizedSearch) {
      return true;
    }

    const reviewerName = formatReviewer(document).toLowerCase();

    return [
      document.originalFilename,
      document.documentType ?? "",
      reviewerName,
    ].some((value) => value.toLowerCase().includes(normalizedSearch));
  });

  const approvedToday = filteredDocuments.filter((document) => {
    if (!document.approvedAt) {
      return false;
    }

    return isSameCalendarDay(new Date(document.approvedAt), new Date());
  }).length;

  const reviewedFieldCount = filteredDocuments.reduce(
    (sum, document) => sum + document._count.extractedFields,
    0
  );

  if (!currentCompanyId) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-dashed p-10 text-center">
          <ShieldCheck className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
          <h1 className="text-xl font-semibold">Approved Documents</h1>
          <p className="mt-2 text-muted-foreground">
            Select a company from the header to view validated documents.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Approved Documents</h1>
          <p className="text-muted-foreground">
            Human-validated documents for {currentCompany?.name ?? "the selected company"}.
          </p>
        </div>

        <div className="relative min-w-[240px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search document, type, or approver"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Approved
            </CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-3">
            <div className="text-2xl font-semibold text-green-700">
              {filteredDocuments.length}
            </div>
            <CheckCircle2 className="h-5 w-5 text-green-600" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Approved Today
            </CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-3">
            <div className="text-2xl font-semibold text-slate-900">{approvedToday}</div>
            <CalendarClock className="h-5 w-5 text-slate-500" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Reviewed Fields
            </CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-3">
            <div className="text-2xl font-semibold text-slate-900">{reviewedFieldCount}</div>
            <FileStack className="h-5 w-5 text-slate-500" />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-2 border-b pb-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <CardTitle>Validated Archive</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Approved documents live here after review so the Documents screen stays action-focused.
            </p>
          </div>
          <Badge className="bg-slate-100 text-slate-700">
            {filteredDocuments.length} approved document
            {filteredDocuments.length === 1 ? "" : "s"}
          </Badge>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 text-sm text-muted-foreground">
              Loading approved documents...
            </div>
          ) : filteredDocuments.length === 0 ? (
            <div className="p-10 text-center">
              <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-green-600" />
              <h2 className="text-lg font-semibold">
                {documents.length === 0 ? "No approved documents yet" : "No approved documents match the current search"}
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {documents.length === 0
                  ? "Approved documents will appear here after a human validates them from Documents."
                  : "Try a different search to find a previously approved document."}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Document</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Approved At</TableHead>
                  <TableHead>Approved By</TableHead>
                  <TableHead>Reviewed Fields</TableHead>
                  <TableHead>Tax Determination</TableHead>
                  <TableHead>Entry Proposal</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredDocuments.map((document) => (
                  <TableRow key={document.id}>
                    <TableCell className="max-w-[320px] whitespace-normal">
                      <div className="font-medium">{document.originalFilename}</div>
                      <div className="text-xs text-muted-foreground">
                        Uploaded {formatDateTime(document.createdAt)}
                      </div>
                    </TableCell>
                    <TableCell>
                      {document.documentType ? (
                        <Badge variant="outline">{document.documentType}</Badge>
                      ) : (
                        <span className="text-sm text-muted-foreground">Unclassified</span>
                      )}
                    </TableCell>
                    <TableCell>{formatDateTime(document.approvedAt)}</TableCell>
                    <TableCell>{formatReviewer(document)}</TableCell>
                    <TableCell>{document._count.extractedFields}</TableCell>
                    <TableCell>
                      {(() => {
                        const taxArtifact = getArtifactStatus(document, "TAX_SUPPORT");

                        return (
                          <div className="space-y-1">
                            <Badge
                              className={artifactBadgeClass(
                                taxArtifact?.status ?? "NOT_GENERATED"
                              )}
                            >
                              Tax: {formatArtifactLabel(taxArtifact?.status ?? "NOT_GENERATED")}
                            </Badge>
                            <div className="text-xs text-muted-foreground">
                              {taxArtifact
                                ? `Generated ${formatDateTime(taxArtifact.createdAt)}`
                                : "Generate from the approved document detail page."}
                            </div>
                          </div>
                        );
                      })()}
                    </TableCell>
                    <TableCell>
                      {(() => {
                        const entryArtifact = getArtifactStatus(
                          document,
                          "ACCOUNTING_ENTRY_PREPARER"
                        );

                        return (
                          <div className="space-y-1">
                            <Badge
                              className={artifactBadgeClass(
                                entryArtifact?.status ?? "NOT_GENERATED"
                              )}
                            >
                              Entry:{" "}
                              {formatArtifactLabel(
                                entryArtifact?.status ?? "NOT_GENERATED"
                              )}
                            </Badge>
                            <div className="text-xs text-muted-foreground">
                              {entryArtifact
                                ? `Generated ${formatDateTime(entryArtifact.createdAt)}`
                                : "Generate from the approved document detail page."}
                            </div>
                          </div>
                        );
                      })()}
                    </TableCell>
                    <TableCell className="text-right">
                      <Link href={`/documents/${document.id}`}>
                        <Button size="sm">Open</Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
