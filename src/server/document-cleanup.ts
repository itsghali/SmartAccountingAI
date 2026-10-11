import { prisma } from "@/server/prisma";
import logger from "@/server/logger";

const STALE_PROCESSING_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Recovers documents that have been in PROCESSING status for too long.
 * Useful when background processing dies unexpectedly without throwing.
 */
export async function recoverStaleProcessingDocuments(tenantId?: string, thresholdMs = STALE_PROCESSING_THRESHOLD_MS) {
  try {
    const cutoffDate = new Date(Date.now() - thresholdMs);

    const staleDocs = await prisma.document.findMany({
      where: {
        status: "PROCESSING",
        ...(tenantId ? { tenantId } : {}),
        updatedAt: { lt: cutoffDate },
      },
      select: {
        id: true,
        currentRunId: true,
        originalFilename: true,
      },
    });

    if (staleDocs.length === 0) {
      return 0;
    }

    logger.warn({
      action: "RecoverStaleProcessingDocuments",
      count: staleDocs.length,
      docIds: staleDocs.map((d) => d.id),
    });

    for (const doc of staleDocs) {
      if (doc.currentRunId) {
        await prisma.documentExtractionRun.updateMany({
          where: {
            id: doc.currentRunId,
            status: { in: ["QUEUED", "RUNNING"] },
          },
          data: {
            status: "FAILED",
            errorMessage: "Processing timed out (exceeded 5 minutes). You can retry processing now.",
            completedAt: new Date(),
          },
        }).catch((err) => {
          logger.error({ action: "RecoverStaleRunError", docId: doc.id, error: err });
        });
      }

      await prisma.document.update({
        where: { id: doc.id },
        data: { status: "FAILED" },
      }).catch((err) => {
        logger.error({ action: "RecoverStaleDocError", docId: doc.id, error: err });
      });
    }

    return staleDocs.length;
  } catch (error) {
    logger.error({ action: "RecoverStaleProcessingDocuments_Error", error });
    return 0;
  }
}

/**
 * Called once on server startup.
 * Any document left in PROCESSING status when the server boots was abandoned
 * when the previous container or process terminated.
 */
export async function resetDanglingProcessingOnStartup() {
  try {
    const danglingDocs = await prisma.document.findMany({
      where: { status: "PROCESSING" },
      select: { id: true, currentRunId: true, originalFilename: true },
    });

    if (danglingDocs.length === 0) {
      return 0;
    }

    logger.warn({
      action: "ResetDanglingProcessingOnStartup",
      count: danglingDocs.length,
      docIds: danglingDocs.map((d) => d.id),
    });

    for (const doc of danglingDocs) {
      if (doc.currentRunId) {
        await prisma.documentExtractionRun.updateMany({
          where: {
            id: doc.currentRunId,
            status: { in: ["QUEUED", "RUNNING"] },
          },
          data: {
            status: "FAILED",
            errorMessage: "Processing was interrupted by a server restart. You can retry processing now.",
            completedAt: new Date(),
          },
        }).catch(() => {});
      }

      await prisma.document.update({
        where: { id: doc.id },
        data: { status: "FAILED" },
      }).catch(() => {});
    }

    return danglingDocs.length;
  } catch (error) {
    logger.error({ action: "ResetDanglingProcessingOnStartup_Error", error });
    return 0;
  }
}
