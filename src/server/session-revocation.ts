import { getRedisClient } from "./redis";

export const DEFAULT_SESSION_REVOCATION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

interface MemoryStoreEntry {
  value: string;
  expiresAtMs: number;
}

// In-memory fallback store used in tests or when Redis is not configured
const inMemoryRevocationStore = new Map<string, MemoryStoreEntry>();

let forceStoreErrorForTesting = false;

/**
 * For testing purposes: simulate revocation store infrastructure outages
 */
export function _setForceRevocationStoreError(shouldError: boolean): void {
  forceStoreErrorForTesting = shouldError;
}

/**
 * Resets the in-memory revocation store and test mocks
 */
export async function clearRevocationStore(): Promise<void> {
  inMemoryRevocationStore.clear();
  forceStoreErrorForTesting = false;
}

/**
 * Returns current active revocation store type
 */
export function getRevocationStoreType(): "redis" | "memory" {
  const redis = getRedisClient();
  return redis ? "redis" : "memory";
}

/**
 * Revokes a single session by its unique JWT identifier (jti).
 * Does not invalidate any other sessions for this user or any other user.
 */
export async function revokeSession(
  jti: string,
  ttlSeconds: number = DEFAULT_SESSION_REVOCATION_TTL_SECONDS
): Promise<void> {
  if (!jti || typeof jti !== "string") {
    throw new Error("Invalid session identifier (jti) provided for revocation");
  }

  if (forceStoreErrorForTesting) {
    throw new Error("Revocation store failure (simulated)");
  }

  const key = `session_revoked:jti:${jti}`;
  const redis = getRedisClient();

  if (redis) {
    try {
      await redis.set(key, "1", { ex: ttlSeconds });
      return;
    } catch (error) {
      console.error(
        "[SessionRevocation] Failed to record single session revocation in Redis:",
        error instanceof Error ? error.message : "Unknown error"
      );
      throw new Error("Erreur de révocation de session: magasin indisponible");
    }
  }

  // Fallback to in-memory store
  const expiresAtMs = Date.now() + ttlSeconds * 1000;
  inMemoryRevocationStore.set(key, { value: "1", expiresAtMs });
}

/**
 * Revokes all existing sessions for a given user (e.g. user deactivation or admin password reset).
 * Sessions issued AFTER this revocation timestamp remain valid.
 */
export async function revokeAllUserSessions(
  userId: string,
  ttlSeconds: number = DEFAULT_SESSION_REVOCATION_TTL_SECONDS
): Promise<void> {
  if (!userId || typeof userId !== "string") {
    throw new Error("Invalid userId provided for user session revocation");
  }

  if (forceStoreErrorForTesting) {
    throw new Error("Revocation store failure (simulated)");
  }

  const key = `session_revoked:user:${userId}`;
  const nowMs = Date.now();
  const redis = getRedisClient();

  if (redis) {
    try {
      await redis.set(key, nowMs.toString(), { ex: ttlSeconds });
      return;
    } catch (error) {
      console.error(
        "[SessionRevocation] Failed to record user-wide session revocation in Redis:",
        error instanceof Error ? error.message : "Unknown error"
      );
      throw new Error("Erreur de révocation de sessions utilisateur: magasin indisponible");
    }
  }

  // Fallback to in-memory store
  const expiresAtMs = nowMs + ttlSeconds * 1000;
  inMemoryRevocationStore.set(key, { value: nowMs.toString(), expiresAtMs });
}

/**
 * Checks whether a given session is revoked.
 * Fails CLOSED: If an error or store outage occurs, returns true (treats session as revoked).
 */
export async function isSessionRevoked(params: {
  jti?: string | null;
  userId?: string | null;
  iat?: number | null;
}): Promise<boolean> {
  const { jti, userId, iat } = params;

  // Fail closed if session contains neither a jti nor a userId
  if (!jti && !userId) {
    return true;
  }

  if (forceStoreErrorForTesting) {
    console.error("[SessionRevocation] Revocation store simulated outage - failing closed");
    return true;
  }

  const redis = getRedisClient();

  try {
    if (redis) {
      return await checkRedisRevocation({ jti, userId, iat }, redis);
    }
    return checkMemoryRevocation({ jti, userId, iat });
  } catch (error) {
    console.error(
      "[SessionRevocation] Exception during revocation lookup - failing closed:",
      error instanceof Error ? error.message : "Unknown error"
    );
    // Fail closed: reject access if revocation state cannot be verified
    return true;
  }
}

async function checkRedisRevocation(
  params: { jti?: string | null; userId?: string | null; iat?: number | null },
  redis: NonNullable<ReturnType<typeof getRedisClient>>
): Promise<boolean> {
  const { jti, userId, iat } = params;

  // 1. Check single session revocation by JTI
  if (jti) {
    const jtiKey = `session_revoked:jti:${jti}`;
    const isJtiRevoked = await redis.get(jtiKey);
    if (isJtiRevoked) {
      return true;
    }
  }

  // 2. Check user-wide revocation timestamp
  if (userId) {
    const userKey = `session_revoked:user:${userId}`;
    const userRevokedAtStr = await redis.get<string>(userKey);
    if (userRevokedAtStr) {
      const revokedAtMs = Number(userRevokedAtStr);
      if (!Number.isNaN(revokedAtMs)) {
        if (!iat) {
          // If token has no issued-at claim, fail closed
          return true;
        }
        const tokenIssuedAtMs = iat * 1000;
        // If token was issued at or before the user revocation timestamp, it is revoked
        if (tokenIssuedAtMs <= revokedAtMs) {
          return true;
        }
      }
    }
  }

  return false;
}

function checkMemoryRevocation(params: {
  jti?: string | null;
  userId?: string | null;
  iat?: number | null;
}): boolean {
  const { jti, userId, iat } = params;
  const nowMs = Date.now();

  // 1. Check single session revocation by JTI
  if (jti) {
    const jtiKey = `session_revoked:jti:${jti}`;
    const entry = inMemoryRevocationStore.get(jtiKey);
    if (entry) {
      if (nowMs < entry.expiresAtMs) {
        return true;
      }
      inMemoryRevocationStore.delete(jtiKey);
    }
  }

  // 2. Check user-wide revocation timestamp
  if (userId) {
    const userKey = `session_revoked:user:${userId}`;
    const entry = inMemoryRevocationStore.get(userKey);
    if (entry) {
      if (nowMs < entry.expiresAtMs) {
        const revokedAtMs = Number(entry.value);
        if (!iat) {
          return true;
        }
        const tokenIssuedAtMs = iat * 1000;
        if (tokenIssuedAtMs <= revokedAtMs) {
          return true;
        }
      } else {
        inMemoryRevocationStore.delete(userKey);
      }
    }
  }

  return false;
}
