import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/server/prisma";
import type { Prisma } from "@prisma/client";

/**
 * Deterministically serialize any JSON-serializable value by recursively sorting object keys.
 */
export function canonicalJsonStringify(val: unknown): string {
  if (val === null || typeof val !== "object") {
    return JSON.stringify(val) ?? "null";
  }

  if (Array.isArray(val)) {
    return "[" + val.map((item) => canonicalJsonStringify(item)).join(",") + "]";
  }

  const obj = val as Record<string, unknown>;
  const sortedKeys = Object.keys(obj).sort();
  const pairs = sortedKeys.map((key) => {
    return JSON.stringify(key) + ":" + canonicalJsonStringify(obj[key]);
  });
  return "{" + pairs.join(",") + "}";
}

/**
 * Computes a SHA-256 fingerprint for an HTTP financial mutation request.
 */
export function computeRequestFingerprint(method: string, path: string, body: unknown): string {
  const canonicalString = `${method.toUpperCase()}:${path}:${canonicalJsonStringify(body)}`;
  return createHash("sha256").update(canonicalString).digest("hex");
}

/**
 * Extracts and sanitizes the Idempotency-Key header from the request.
 */
export function getIdempotencyKey(request: Request): string | null {
  const rawKey =
    request.headers.get("Idempotency-Key") ||
    request.headers.get("idempotency-key") ||
    request.headers.get("X-Idempotency-Key") ||
    request.headers.get("x-idempotency-key");

  if (!rawKey) return null;
  const trimmed = rawKey.trim();
  if (trimmed.length === 0 || trimmed.length > 128) return null;
  return trimmed;
}

export interface IdempotencyCheckResult {
  isReplay: boolean;
  cachedResponse?: {
    status: number;
    body: unknown;
  };
  conflictError?: string;
  unavailableError?: string;
}

/**
 * Pre-transaction check to verify if a valid, unexpired idempotency record already exists.
 * Returns cached response for matching retries or a 409 conflict message for payload mismatches.
 * Fails closed with unavailableError if the idempotency store cannot be queried.
 */
export async function checkIdempotency(options: {
  companyId: string;
  key: string;
  requestHash: string;
  client?: Prisma.TransactionClient;
}): Promise<IdempotencyCheckResult> {
  const db = options.client ?? prisma;
  if (!db.idempotencyKey?.findUnique) {
    return {
      isReplay: false,
      unavailableError: "Le service d'idempotence est indisponible.",
    };
  }

  try {
    const existing = await db.idempotencyKey.findUnique({
      where: {
        companyId_key: {
          companyId: options.companyId,
          key: options.key,
        },
      },
    });

    if (!existing) {
      return { isReplay: false };
    }

    // If expired, permit fresh evaluation
    if (existing.expiresAt.getTime() <= Date.now()) {
      return { isReplay: false };
    }

    // Validate fingerprint consistency
    if (existing.requestHash !== options.requestHash) {
      return {
        isReplay: false,
        conflictError:
          "Cette clé d'idempotence a déjà été utilisée avec un corps de requête différent.",
      };
    }

    return {
      isReplay: true,
      cachedResponse: {
        status: existing.statusCode,
        body: existing.responseBody,
      },
    };
  } catch {
    return {
      isReplay: false,
      unavailableError: "Le service d'idempotence est indisponible.",
    };
  }
}

/**
 * Records an idempotency key and its final response atomically inside the accounting transaction.
 * Fails closed if the idempotency store is unavailable.
 * Race-safely cleans up any expired record for (companyId, key) before inserting.
 */
export async function recordIdempotency(options: {
  tx: Prisma.TransactionClient;
  companyId: string;
  key: string;
  userId: string;
  endpoint: string;
  requestHash: string;
  statusCode: number;
  responseBody: unknown;
  retentionHours?: number;
}): Promise<void> {
  if (!options.tx.idempotencyKey?.create) {
    throw new Error("Le service d'enregistrement d'idempotence est indisponible.");
  }

  const retentionMs = (options.retentionHours ?? 24) * 60 * 60 * 1000;
  const expiresAt = new Date(Date.now() + retentionMs);

  // Race-safe cleanup of any expired record for this (companyId, key)
  if (options.tx.idempotencyKey.deleteMany) {
    await options.tx.idempotencyKey.deleteMany({
      where: {
        companyId: options.companyId,
        key: options.key,
        expiresAt: { lte: new Date() },
      },
    });
  }

  await options.tx.idempotencyKey.create({
    data: {
      companyId: options.companyId,
      key: options.key,
      userId: options.userId,
      endpoint: options.endpoint,
      requestHash: options.requestHash,
      statusCode: options.statusCode,
      responseBody: options.responseBody as Prisma.InputJsonValue,
      expiresAt,
    },
  });
}

/**
 * Creates an HTTP response with idempotency replay headers.
 */
export function createIdempotentReplayResponse(
  cached: { status: number; body: unknown },
  key: string
): NextResponse {
  return NextResponse.json(cached.body, {
    status: cached.status,
    headers: {
      "Idempotent-Replay": "true",
      "X-Idempotency-Key": key,
    },
  });
}
