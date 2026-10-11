import { NextResponse } from "next/server";
import { getRedisClient } from "./redis";

export type RateLimitTier =
  | "AUTH_LOGIN"
  | "AUTH_REGISTER"
  | "AI_OR_OCR"
  | "FINANCIAL_MUTATION"
  | "GENERAL_API";

export interface RateLimitConfig {
  maxRequests: number;
  windowSeconds: number;
}

export interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  reset: number;       // Unix epoch in seconds
  retryAfter: number;  // Seconds to wait before retry (0 if success)
  backend: "redis" | "memory";
  serviceUnavailable?: boolean; // Set to true when rate-limiting backend is unavailable for sensitive tiers (503)
}

export const RATE_LIMIT_TIERS: Record<RateLimitTier, RateLimitConfig> = {
  AUTH_LOGIN: { maxRequests: 5, windowSeconds: 60 },
  AUTH_REGISTER: { maxRequests: 3, windowSeconds: 60 },
  AI_OR_OCR: { maxRequests: 10, windowSeconds: 60 },
  FINANCIAL_MUTATION: { maxRequests: 30, windowSeconds: 60 },
  GENERAL_API: { maxRequests: 120, windowSeconds: 60 },
};

/**
 * Production-sensitive endpoints that must fail closed (HTTP 503) when Redis is unavailable,
 * preventing silent fallback to process-local in-memory limiting.
 */
export const SENSITIVE_RATE_LIMIT_TIERS = new Set<RateLimitTier>([
  "AUTH_LOGIN",
  "AUTH_REGISTER",
  "AI_OR_OCR",
  "FINANCIAL_MUTATION",
]);

interface MemoryBucket {
  count: number;
  resetAtMs: number;
}

const memoryRateLimitStore = new Map<string, MemoryBucket>();

let forceRedisErrorForTesting = false;
let forceFailClosedForTesting = false;
let trustProxyHeadersOverride: boolean | undefined = undefined;

export function _setForceRateLimitRedisError(shouldError: boolean): void {
  forceRedisErrorForTesting = shouldError;
}

export function _setForceFailClosedForTesting(shouldFail: boolean): void {
  forceFailClosedForTesting = shouldFail;
}

/**
 * For testing purposes: override trusted proxy configuration
 */
export function _setTrustProxyHeadersForTesting(enabled: boolean | undefined): void {
  trustProxyHeadersOverride = enabled;
}

export async function clearRateLimitStore(): Promise<void> {
  memoryRateLimitStore.clear();
  forceRedisErrorForTesting = false;
  forceFailClosedForTesting = false;
  trustProxyHeadersOverride = undefined;
}

/**
 * Checks if forwarding headers (X-Forwarded-For, X-Real-IP) are explicitly trusted.
 * Defaults to false to prevent client-supplied header spoofing.
 */
export function isTrustedProxyEnabled(): boolean {
  if (trustProxyHeadersOverride !== undefined) {
    return trustProxyHeadersOverride;
  }
  const envVal = process.env.TRUSTED_PROXY_HEADERS?.trim().toLowerCase();
  const trustProxyVal = process.env.TRUST_PROXY?.trim().toLowerCase();
  return envVal === "true" || envVal === "1" || trustProxyVal === "true" || trustProxyVal === "1";
}

/**
 * Validates and normalizes client IP address strings, handling IPv4, bracketed IPv6, and port artifacts.
 * Returns null if the value is malformed or invalid.
 */
function sanitizeClientIp(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Strip IPv4-mapped IPv6 prefix (::ffff:192.0.2.1)
  const unmapped = trimmed.replace(/^::ffff:/i, "");

  // Bracketed IPv6 with optional port: [2001:db8::1]:8080 or [2001:db8::1]
  const bracketMatch = unmapped.match(/^\[([a-fA-F0-9:]+)\](?::\d+)?$/);
  if (bracketMatch && bracketMatch[1]) {
    return bracketMatch[1];
  }

  // IPv4 with optional port: 192.0.2.1:8080 or 192.0.2.1
  const ipv4Match = unmapped.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})(?::\d+)?$/);
  if (ipv4Match && ipv4Match[1]) {
    const octets = ipv4Match[1].split(".").map(Number);
    if (octets.every((o) => o >= 0 && o <= 255)) {
      return ipv4Match[1];
    }
  }

  // Standard unbracketed IPv6 (contains at least two colons and only hex digits/colons)
  if (unmapped.includes(":") && /^[a-fA-F0-9:]+$/.test(unmapped)) {
    return unmapped;
  }

  return null;
}

/**
 * Atomic rate limiting Lua script executed via Redis EVAL.
 *
 * Atomicity Guarantees:
 * 1. Atomically increments counter (INCR).
 * 2. If newly created (count == 1), atomically sets expiration (EXPIRE).
 * 3. Atomically checks whether current count <= maxRequests.
 * 4. Returns { currentCount, isAllowed (1 or 0) }.
 *
 * Because Redis executes Lua scripts sequentially in a single thread,
 * no other Redis commands can interleave between the increment and expiration,
 * guaranteeing consistent quota enforcement across concurrent requests without race conditions.
 */
export const RATE_LIMIT_LUA_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
local allowed = 0
if current <= tonumber(ARGV[2]) then
  allowed = 1
end
return { current, allowed }
`.trim();

/**
 * Extracts client identifier for rate limiting with strict anti-spoofing controls.
 *
 * CRITICAL ARCHITECTURAL CONSEQUENCES & KNOWN LIMITATION:
 * 1. Default (Untrusted) Mode: When TRUSTED_PROXY_HEADERS is false, client-supplied
 *    headers (X-Forwarded-For, X-Real-IP) are completely ignored. All direct connections
 *    are attributed to the shared fallback identifier ("direct-client").
 *    CONSEQUENCE: For low-quota sensitive endpoints (e.g. AUTH_LOGIN with 5 req/min,
 *    AUTH_REGISTER with 3 req/min), all direct clients share a single quota bucket.
 *    An attacker (or heavy user) can exhaust this bucket and cause a Cross-User Denial of
 *    Service (DoS) for all other direct users during that 60-second window.
 *
 * 2. Why Forwarded Headers Cannot Be Trusted Without A Proxy:
 *    Allowing unverified X-Forwarded-For would introduce an even more critical vulnerability:
 *    any attacker could rotate random spoofed IPs to completely bypass rate limits and brute-force
 *    credentials or abuse AI/OCR endpoints.
 *
 * 3. Required Infrastructure Resolution (Deployment Prerequisite):
 *    In standalone Next.js (Node.js runner), direct socket peer IP addresses are unavailable
 *    via the Fetch API Request. Therefore, safe per-client IP rate limiting REQUIRES an
 *    upstream ingress reverse proxy (e.g., NGINX, Cloudflare, AWS ALB) that:
 *    a) Strips/sanitizes all incoming client forwarding headers;
 *    b) Overwrites X-Forwarded-For with the verified connecting peer IP;
 *    c) Prevents direct public access to port 3000 (binding Next.js to internal network only);
 *    d) Enables TRUSTED_PROXY_HEADERS="true" only after (a)-(c) are verified.
 */
export function getClientIp(
  request: Request | { headers: Headers | { get(name: string): string | null } }
): string {
  // If forwarding headers are NOT explicitly trusted, reject client-supplied headers
  if (!isTrustedProxyEnabled()) {
    return "direct-client";
  }

  const headers = "headers" in request ? request.headers : request;
  const xForwardedFor = headers.get("x-forwarded-for");
  if (xForwardedFor) {
    const parts = xForwardedFor.split(",").map((s) => s.trim()).filter(Boolean);
    for (const part of parts) {
      const sanitized = sanitizeClientIp(part);
      if (sanitized) {
        return sanitized;
      }
    }
  }

  const realIp = headers.get("x-real-ip");
  if (realIp) {
    const sanitized = sanitizeClientIp(realIp);
    if (sanitized) {
      return sanitized;
    }
  }

  // Conservative fallback when identity cannot be verified
  return "direct-client";
}

/**
 * Checks rate limit for a specific tier and identifier.
 * Uses shared Redis backend when available (distributed enforcement).
 *
 * FAIL-CLOSED OUTAGE POLICY:
 * - Sensitive tiers (AUTH_LOGIN, AUTH_REGISTER, AI_OR_OCR, FINANCIAL_MUTATION):
 *   MUST NOT silently fall back to process-local in-memory limiting when Redis is unavailable or unconfigured.
 *   They fail closed with a controlled HTTP 503 response.
 * - Ordinary non-sensitive tiers (GENERAL_API):
 *   Fall back to process-local in-memory limiting, maintaining availability for read traffic
 *   while protecting the local process.
 */
export async function checkRateLimit(
  tier: RateLimitTier,
  identifier: string,
  customConfig?: Partial<RateLimitConfig>
): Promise<RateLimitResult> {
  const config: RateLimitConfig = {
    ...RATE_LIMIT_TIERS[tier],
    ...customConfig,
  };

  const isSensitive = SENSITIVE_RATE_LIMIT_TIERS.has(tier);
  const isProd = process.env.NODE_ENV === "production";
  const redis = getRedisClient();

  if (redis && !forceRedisErrorForTesting) {
    try {
      return await checkRedisRateLimit(tier, identifier, config, redis);
    } catch (error) {
      console.error(
        `[RateLimit] Redis operation failed for tier ${tier}:`,
        error instanceof Error ? error.message : "Unknown error"
      );
      if (isSensitive) {
        // Production-sensitive tier: fail closed with controlled 503 during Redis outage
        return {
          success: false,
          limit: config.maxRequests,
          remaining: 0,
          reset: 0,
          retryAfter: 60,
          backend: "redis",
          serviceUnavailable: true,
        };
      }
      // Non-sensitive tier: process-local memory fallback
      return checkMemoryRateLimit(tier, identifier, config);
    }
  }

  // Simulated Redis outage for testing
  if (forceRedisErrorForTesting) {
    if (isSensitive) {
      return {
        success: false,
        limit: config.maxRequests,
        remaining: 0,
        reset: 0,
        retryAfter: 60,
        backend: "redis",
        serviceUnavailable: true,
      };
    }
    return checkMemoryRateLimit(tier, identifier, config);
  }

  // Redis is unconfigured
  if (isSensitive && (isProd || forceFailClosedForTesting)) {
    console.error(
      `[RateLimit] Redis is unconfigured for sensitive tier ${tier} in production - failing closed (503)`
    );
    return {
      success: false,
      limit: config.maxRequests,
      remaining: 0,
      reset: 0,
      retryAfter: 60,
      backend: "redis",
      serviceUnavailable: true,
    };
  }

  // In non-production testing/development without Redis, allow memory fallback for convenience
  return checkMemoryRateLimit(tier, identifier, config);
}

async function checkRedisRateLimit(
  tier: RateLimitTier,
  identifier: string,
  config: RateLimitConfig,
  redis: NonNullable<ReturnType<typeof getRedisClient>>
): Promise<RateLimitResult> {
  const nowMs = Date.now();
  const nowSec = Math.floor(nowMs / 1000);
  const windowIndex = Math.floor(nowSec / config.windowSeconds);
  const windowResetEpochSec = (windowIndex + 1) * config.windowSeconds;
  const ttlSec = config.windowSeconds * 2;
  const key = `ratelimit:${tier}:${identifier}:${windowIndex}`;

  let count: number;
  let success: boolean;

  if (typeof redis.eval === "function") {
    // Genuinely atomic execution via Redis EVAL Lua script:
    // Atomic INCR + conditional EXPIRE + limit decision in a single execution.
    const result = await redis.eval<[number, number], [number, number]>(
      RATE_LIMIT_LUA_SCRIPT,
      [key],
      [ttlSec, config.maxRequests]
    );
    count = Number(result[0]);
    success = Number(result[1]) === 1;
  } else {
    // Minimal fallback for unit test mocks lacking eval
    count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, ttlSec);
    }
    success = count <= config.maxRequests;
  }

  const remaining = Math.max(0, config.maxRequests - count);
  const retryAfter = success ? 0 : Math.max(1, windowResetEpochSec - nowSec);

  return {
    success,
    limit: config.maxRequests,
    remaining,
    reset: windowResetEpochSec,
    retryAfter,
    backend: "redis",
  };
}

/**
 * In-Memory Rate Limiting Fallback
 *
 * CRITICAL ARCHITECTURAL LIMITATION:
 * The in-memory rate limiter is strictly PROCESS-LOCAL (stored in a Map in local process memory).
 * It is NOT distributed and provides NO synchronization across multiple container instances,
 * cluster replicas, or serverless functions.
 *
 * In multi-instance deployments:
 * - Shared, distributed rate limiting requires the Redis backend (configured via UPSTASH_REDIS_REST_URL
 *   and UPSTASH_REDIS_REST_TOKEN / REDIS_HTTP_TOKEN).
 * - Sensitive endpoints reject in-memory fallback in production and fail closed (HTTP 503).
 * - Ordinary non-sensitive endpoints (GENERAL_API) use this fallback to protect the local node
 *   from process exhaustion during an outage.
 */
function checkMemoryRateLimit(
  tier: RateLimitTier,
  identifier: string,
  config: RateLimitConfig
): RateLimitResult {
  const nowMs = Date.now();
  const nowSec = Math.floor(nowMs / 1000);
  const key = `${tier}:${identifier}`;

  // Periodically sweep if map gets large to prevent memory growth
  if (memoryRateLimitStore.size > 5000) {
    for (const [k, v] of memoryRateLimitStore.entries()) {
      if (nowMs >= v.resetAtMs) {
        memoryRateLimitStore.delete(k);
      }
    }
  }

  const current = memoryRateLimitStore.get(key);
  if (!current || nowMs >= current.resetAtMs) {
    const resetAtMs = nowMs + config.windowSeconds * 1000;
    memoryRateLimitStore.set(key, { count: 1, resetAtMs });
    return {
      success: true,
      limit: config.maxRequests,
      remaining: config.maxRequests - 1,
      reset: Math.ceil(resetAtMs / 1000),
      retryAfter: 0,
      backend: "memory",
    };
  }

  current.count += 1;
  const success = current.count <= config.maxRequests;
  const remaining = Math.max(0, config.maxRequests - current.count);
  const resetEpochSec = Math.ceil(current.resetAtMs / 1000);
  const retryAfter = success ? 0 : Math.max(1, resetEpochSec - nowSec);

  return {
    success,
    limit: config.maxRequests,
    remaining,
    reset: resetEpochSec,
    retryAfter,
    backend: "memory",
  };
}

/**
 * Constructs a standard HTTP response with RFC-compliant headers:
 * - When rate-limiting backend is unavailable for sensitive tiers: HTTP 503 Service Unavailable
 * - When request quota is exceeded: HTTP 429 Too Many Requests
 */
export function createRateLimitResponse(result: RateLimitResult): NextResponse {
  if (result.serviceUnavailable) {
    return NextResponse.json(
      {
        error: "Service temporairement indisponible. Veuillez réessayer plus tard.",
        retryAfter: result.retryAfter || 60,
      },
      {
        status: 503,
        headers: {
          "Retry-After": (result.retryAfter || 60).toString(),
        },
      }
    );
  }

  return NextResponse.json(
    {
      error: "Trop de requêtes. Veuillez réessayer plus tard.",
      retryAfter: result.retryAfter,
    },
    {
      status: 429,
      headers: {
        "Retry-After": result.retryAfter.toString(),
        "X-RateLimit-Limit": result.limit.toString(),
        "X-RateLimit-Remaining": result.remaining.toString(),
        "X-RateLimit-Reset": result.reset.toString(),
      },
    }
  );
}
