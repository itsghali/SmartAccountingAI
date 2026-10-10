"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useAppContext } from "@/hooks/useAppContext";
import { 
  FileText, 
  Upload, 
  CheckCircle, 
  AlertCircle, 
  Clock, 
  XCircle,
  RefreshCw,
  ChevronRight,
  FileImage,
  Building2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";

interface Document {
  id: string;
  originalFilename: string;
  mimeType: string;
  status: string;
  fileSize: number | null;
  createdAt: string;
  extractionRuns: Array<{
    id: string;
    status: string;
    completedAt: string | null;
  }>;
  _count: {
    extractedFields: number;
  };
}

const statusConfig: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  UPLOADED: { label: "Uploaded", color: "bg-slate-100 text-slate-700", icon: <FileText className="size-4" /> },
  PROCESSING: { label: "Processing", color: "bg-blue-100 text-blue-700", icon: <Clock className="size-4" /> },
  REVIEW_REQUIRED: { label: "Review Required", color: "bg-yellow-100 text-yellow-700", icon: <AlertCircle className="size-4" /> },
  APPROVED: { label: "Approved", color: "bg-green-100 text-green-700", icon: <CheckCircle className="size-4" /> },
  REJECTED: { label: "Rejected", color: "bg-red-100 text-red-700", icon: <XCircle className="size-4" /> },
  FAILED: { label: "Failed", color: "bg-red-100 text-red-700", icon: <XCircle className="size-4" /> },
};

function formatFileSize(bytes: number | null): string {
  if (bytes === null) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function DocumentsPage() {
  const { currentCompanyId } = useAppContext();
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);

  const { data: documents, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["documents", currentCompanyId],
    queryFn: async () => {
      if (!currentCompanyId) return [];
      const res = await fetch(`/api/documents?tenantId=${currentCompanyId}`);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Failed to fetch documents: ${res.status} ${text}`);
      }
      const data = await res.json();
      return data.documents as Document[];
    },
    enabled: !!currentCompanyId,
    refetchInterval: 5000,
  });
  const visibleDocuments = (documents ?? []).filter((document) => document.status !== "APPROVED");
  const hasOnlyApprovedDocuments =
    (documents?.length ?? 0) > 0 && visibleDocuments.length === 0;

  async function handleUpload(file: File) {
    if (!currentCompanyId) {
      toast.error("Please select a company first");
      return;
    }
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("tenantId", currentCompanyId);

      const res = await fetch("/api/documents/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Upload failed");
      }

      const uploadData = await res.json();
      toast.success("Document uploaded successfully");
      setIsUploadDialogOpen(false);
      
      // Automatically start processing
      if (uploadData.documentId) {
        await handleProcess(uploadData.documentId);
      } else {
        refetch();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    }
  }

  async function handleProcess(documentId: string) {
    try {
      const res = await fetch(`/api/documents/${documentId}/process`, {
        method: "POST",
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Processing failed");
      }

      toast.success("Document processing started");
      refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Processing failed");
    }
  }

  async function handleReprocess(documentId: string) {
    try {
      const res = await fetch(`/api/documents/${documentId}/reprocess`, {
        method: "POST",
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Reprocessing failed");
      }

      toast.success("Document reprocessing started");
      refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Reprocessing failed");
    }
  }

  return (
    <div className="p-6 space-y-6 animate-in fade-in duration-500">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-linear-to-r from-primary to-secondary">Documents</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Upload, process, and validate documents that still need action.
          </p>
        </div>
        <div className="flex gap-2">
          <Dialog open={isUploadDialogOpen} onOpenChange={setIsUploadDialogOpen}>
            <DialogTrigger
              render={
                <Button>
                  <Upload className="mr-2 size-4" />
                  Upload Document
                </Button>
              }
            />
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Upload Document</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <p className="text-sm text-muted-foreground">
                  Supported formats: PDF, PNG, JPEG, WebP, TIFF (max 20MB)
                </p>
                <input
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.webp,.tiff"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleUpload(file);
                  }}
                  className="block w-full text-sm file:mr-4 file:rounded file:border-0 file:bg-primary file:px-4 file:py-2 file:text-sm file:font-semibold file:text-primary-foreground hover:file:bg-primary/90"
                />
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {!currentCompanyId && (
        <div className="rounded-xl border border-dashed border-border/50 bg-card/30 backdrop-blur-sm p-12 text-center transition-all duration-300">
          <div className="mb-4 flex justify-center">
            <div className="rounded-full bg-muted/50 p-4">
              <Building2 className="size-10 text-muted-foreground" />
            </div>
          </div>
          <p className="text-muted-foreground font-medium">
            Select a company from the header to view documents
          </p>
        </div>
      )}

      {isLoading && (
        <div className="flex h-48 items-center justify-center">
          <RefreshCw className="size-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {isError && (
        <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-8 text-center text-destructive backdrop-blur-sm">
          <AlertCircle className="mx-auto mb-4 size-12 opacity-80" />
          <p className="font-semibold mb-2">Error loading documents</p>
          <p className="text-sm font-mono whitespace-pre-wrap opacity-70">{error?.message || "Unknown error"}</p>
        </div>
      )}

      {documents && documents.length === 0 && (
        <div className="rounded-xl border border-dashed border-border/50 bg-card/30 backdrop-blur-sm p-12 text-center transition-all duration-300">
          <div className="mx-auto mb-4 flex justify-center">
            <div className="rounded-full bg-muted/50 p-4">
              <FileText className="size-10 text-muted-foreground" />
            </div>
          </div>
          <p className="font-semibold text-foreground mb-1">No documents yet</p>
          <p className="text-sm text-muted-foreground">
            Upload your first invoice or receipt to get started
          </p>
        </div>
      )}

      {hasOnlyApprovedDocuments && (
        <div className="rounded-xl border border-dashed border-border/50 bg-emerald-500/5 backdrop-blur-sm p-12 text-center transition-all duration-300">
          <div className="mx-auto mb-4 flex justify-center">
            <div className="rounded-full bg-emerald-500/10 p-4">
              <CheckCircle className="size-10 text-emerald-600 dark:text-emerald-400" />
            </div>
          </div>
          <p className="font-semibold text-foreground mb-1">No documents are waiting for action here</p>
          <p className="text-sm text-muted-foreground">
            Approved documents now live in Approved Documents.
          </p>
          <div className="mt-6">
            <Link href="/approved-documents">
              <Button variant="outline" className="border-emerald-500/20 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/10 transition-colors">
                Open Approved Documents
              </Button>
            </Link>
          </div>
        </div>
      )}

      {visibleDocuments.length > 0 && (
        <div className="space-y-2">
          {visibleDocuments.map((doc) => {
            const status = statusConfig[doc.status] || statusConfig.UPLOADED!;
            return (
              <div
                key={doc.id}
                className="flex items-center gap-4 rounded-xl border border-border/50 bg-card/60 backdrop-blur-md p-4 shadow-sm hover:shadow-md hover:border-primary/20 hover:bg-muted/30 transition-all duration-300 group hover:-translate-y-0.5"
              >
                <div className="shrink-0 rounded-lg bg-muted/50 p-2.5 group-hover:bg-primary/10 transition-colors">
                  {doc.mimeType.startsWith("image/") ? (
                    <FileImage className="size-6 text-muted-foreground group-hover:text-primary transition-colors" />
                  ) : (
                    <FileText className="size-6 text-muted-foreground group-hover:text-primary transition-colors" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium truncate">{doc.originalFilename}</h3>
                  <p className="text-sm text-muted-foreground">
                    {formatFileSize(doc.fileSize)} • {new Date(doc.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <Badge className={status.color}>
                  <span className="flex items-center gap-1">
                    {status.icon}
                    {status.label}
                  </span>
                </Badge>
                <div className="flex gap-2">
                  {(doc.status === "UPLOADED" || doc.status === "FAILED") && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleProcess(doc.id)}
                    >
                      Process
                    </Button>
                  )}
                  {doc.status === "REVIEW_REQUIRED" && (
                    <Link href={`/documents/${doc.id}`}>
                      <Button size="sm">
                        Review
                        <ChevronRight className="ml-1 size-4" />
                      </Button>
                    </Link>
                  )}
                  {(doc.status === "REVIEW_REQUIRED" || doc.status === "APPROVED" || doc.status === "REJECTED") && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleReprocess(doc.id)}
                    >
                      <RefreshCw className="size-4" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
