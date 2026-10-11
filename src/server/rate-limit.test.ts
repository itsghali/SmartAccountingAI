import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkRateLimit,
  clearRateLimitStore,
  createRateLimitResponse,
  getClientIp,
  RATE_LIMIT_LUA_SCRIPT,
  RATE_LIMIT_TIERS,
  SENSITIVE_RATE_LIMIT_TIERS,
  _setForceFailClosedForTesting,
  _setForceRateLimitRedisError,
  _setTrustProxyHeadersForTesting,
} from "./rate-limit";
import { setMockRedisClient } from "./redis";

describe("Rate Limiting (src/server/rate-limit.ts)", () => {
  beforeEach(async () => {
    setMockRedisClient(null); // Ensure clean state before each test
    await clearRateLimitStore();
  });

  describe("Tier Definitions & Thresholds", () => {
    it("has appropriate, differentiated limits for each operation tier", () => {
      expect(RATE_LIMIT_TIERS.AUTH_LOGIN).toEqual({ maxRequests: 5, windowSeconds: 60 });
      expect(RATE_LIMIT_TIERS.AUTH_REGISTER).toEqual({ maxRequests: 3, windowSeconds: 60 });
      expect(RATE_LIMIT_TIERS.AI_OR_OCR).toEqual({ maxRequests: 10, windowSeconds: 60 });
      expect(RATE_LIMIT_TIERS.FINANCIAL_MUTATION).toEqual({ maxRequests: 30, windowSeconds: 60 });
      expect(RATE_LIMIT_TIERS.GENERAL_API).toEqual({ maxRequests: 120, windowSeconds: 60 });
    });

    it("identifies sensitive tiers that must not silently fall back during outages", () => {
      expect(SENSITIVE_RATE_LIMIT_TIERS.has("AUTH_LOGIN")).toBe(true);
      expect(SENSITIVE_RATE_LIMIT_TIERS.has("AUTH_REGISTER")).toBe(true);
      expect(SENSITIVE_RATE_LIMIT_TIERS.has("AI_OR_OCR")).toBe(true);
      expect(SENSITIVE_RATE_LIMIT_TIERS.has("FINANCIAL_MUTATION")).toBe(true);
      expect(SENSITIVE_RATE_LIMIT_TIERS.has("GENERAL_API")).toBe(false);
    });
  });

  describe("Threshold Enforcement & Progression", () => {
    it("allows requests up to the threshold and rejects excess requests", async () => {
      const tier = "AUTH_REGISTER"; // Limit: 3 per 60s
      const id = "ip-test-threshold";

      // 1st request
      const res1 = await checkRateLimit(tier, id);
      expect(res1.success).toBe(true);
      expect(res1.limit).toBe(3);
      expect(res1.remaining).toBe(2);

      // 2nd request
      const res2 = await checkRateLimit(tier, id);
      expect(res2.success).toBe(true);
      expect(res2.remaining).toBe(1);

      // 3rd request (last permitted)
      const res3 = await checkRateLimit(tier, id);
      expect(res3.success).toBe(true);
      expect(res3.remaining).toBe(0);

      // 4th request (exceeds limit)
      const res4 = await checkRateLimit(tier, id);
      expect(res4.success).toBe(false);
      expect(res4.remaining).toBe(0);
      expect(res4.retryAfter).toBeGreaterThan(0);
    });

    it("resets bucket after time window expires", async () => {
      const tier = "AUTH_REGISTER";
      const id = "ip-window-reset";

      // Use a custom short window for test speed
      const customConfig = { maxRequests: 2, windowSeconds: 1 };

      const res1 = await checkRateLimit(tier, id, customConfig);
      const res2 = await checkRateLimit(tier, id, customConfig);
      const res3 = await checkRateLimit(tier, id, customConfig);

      expect(res1.success).toBe(true);
      expect(res2.success).toBe(true);
      expect(res3.success).toBe(false);

      // Wait 1.1s for window to pass
      await new Promise((r) => setTimeout(r, 1100));

      const resAfter = await checkRateLimit(tier, id, customConfig);
      expect(resAfter.success).toBe(true);
      expect(resAfter.remaining).toBe(1);
    });
  });

  describe("Client Isolation & Shared Quotas", () => {
    it("enforces limits independently for separate clients", async () => {
      const tier = "AUTH_LOGIN"; // Limit: 5
      const clientA = "client-alpha";
      const clientB = "client-beta";

      // Exhaust client A
      for (let i = 0; i < 5; i++) {
        await checkRateLimit(tier, clientA);
      }
      const clientAExceeded = await checkRateLimit(tier, clientA);
      expect(clientAExceeded.success).toBe(false);

      // Client B should remain completely unaffected
      const clientBFirst = await checkRateLimit(tier, clientB);
      expect(clientBFirst.success).toBe(true);
      expect(clientBFirst.remaining).toBe(4);
    });

    it("shares quota correctly among requests with identical client identity", async () => {
      const tier = "AUTH_REGISTER"; // Limit: 3
      const clientId = "shared-client-id";

      await checkRateLimit(tier, clientId);
      await checkRateLimit(tier, clientId);
      const third = await checkRateLimit(tier, clientId);
      expect(third.remaining).toBe(0);

      const fourth = await checkRateLimit(tier, clientId);
      expect(fourth.success).toBe(false);
    });
  });

  describe("Anti-Spoofing & Shared direct-client Bucket", () => {
    describe("Default (Untrusted) Mode", () => {
      it("ignores client-supplied X-Forwarded-For headers by default", () => {
        const headers = new Headers();
        headers.set("x-forwarded-for", "203.0.113.195, 70.41.3.18");
        expect(getClientIp({ headers })).toBe("direct-client");
      });

      it("ignores client-supplied X-Real-IP headers by default", () => {
        const headers = new Headers();
        headers.set("x-real-ip", "198.51.100.42");
        expect(getClientIp({ headers })).toBe("direct-client");
      });

      it("returns conservative fallback direct-client when no headers are provided", () => {
        const headers = new Headers();
        expect(getClientIp({ headers })).toBe("direct-client");
      });

      it("prevents rate-limit bypass by pooling rotating spoofed headers into direct-client", async () => {
        // Attacker attempts to bypass registration rate limit by rotating X-Forwarded-For
        for (let i = 0; i < 3; i++) {
          const headers = new Headers({ "x-forwarded-for": `198.51.100.${i + 1}` });
          const clientIp = getClientIp({ headers });
          expect(clientIp).toBe("direct-client");
          await checkRateLimit("AUTH_REGISTER", `register_${clientIp}`);
        }

        // 4th request with yet another spoofed IP must STILL be blocked!
        const attackerHeaders = new Headers({ "x-forwarded-for": "198.51.100.99" });
        const attackerIp = getClientIp({ headers: attackerHeaders });
        const res = await checkRateLimit("AUTH_REGISTER", `register_${attackerIp}`);
        expect(res.success).toBe(false);
      });

      it("demonstrates the cross-user DoS consequence of direct-client on low-limit routes", async () => {
        // Client A makes 3 registration requests on direct connection without proxy
        const clientAHeaders = new Headers(); // direct connection
        const ipA = getClientIp({ headers: clientAHeaders });
        expect(ipA).toBe("direct-client");

        for (let i = 0; i < 3; i++) {
          const resA = await checkRateLimit("AUTH_REGISTER", `register_${ipA}`);
          expect(resA.success).toBe(true);
        }

        // Distinct legitimate Client B arrives directly on port 3000
        const clientBHeaders = new Headers();
        const ipB = getClientIp({ headers: clientBHeaders });
        expect(ipB).toBe("direct-client");

        // Client B is denied because the shared direct-client bucket is exhausted!
        const resB = await checkRateLimit("AUTH_REGISTER", `register_${ipB}`);
        expect(resB.success).toBe(false);
        expect(resB.retryAfter).toBeGreaterThan(0);
      });
    });

    describe("Explicit Trusted-Proxy Mode", () => {
      it("extracts leftmost sanitized IP from X-Forwarded-For when trusted proxy is enabled", () => {
        _setTrustProxyHeadersForTesting(true);
        const headers = new Headers();
        headers.set("x-forwarded-for", "203.0.113.195, 70.41.3.18, 150.172.238.178");
        expect(getClientIp({ headers })).toBe("203.0.113.195");
      });

      it("strips IPv6 mapped IPv4 and port artifacts when trusted proxy is enabled", () => {
        _setTrustProxyHeadersForTesting(true);
        const headers = new Headers();
        headers.set("x-forwarded-for", "::ffff:198.51.100.1:443, 10.0.0.1");
        expect(getClientIp({ headers })).toBe("198.51.100.1");
      });

      it("parses bracketed IPv6 addresses with port correctly", () => {
        _setTrustProxyHeadersForTesting(true);
        const headers = new Headers();
        headers.set("x-forwarded-for", "[2001:db8::1]:8080, 10.0.0.1");
        expect(getClientIp({ headers })).toBe("2001:db8::1");
      });

      it("falls back to X-Real-IP when X-Forwarded-For is absent under trusted proxy mode", () => {
        _setTrustProxyHeadersForTesting(true);
        const headers = new Headers();
        headers.set("x-real-ip", "198.51.100.42");
        expect(getClientIp({ headers })).toBe("198.51.100.42");
      });

      it("falls back to direct-client when headers contain malformed values", () => {
        _setTrustProxyHeadersForTesting(true);
        const headers = new Headers();
        headers.set("x-forwarded-for", "not-an-ip, ;;;;, 999.999.999.999");
        expect(getClientIp({ headers })).toBe("direct-client");
      });

      it("falls back to direct-client when headers are empty under trusted proxy mode", () => {
        _setTrustProxyHeadersForTesting(true);
        const headers = new Headers();
        expect(getClientIp({ headers })).toBe("direct-client");
      });
    });
  });

  describe("HTTP 429 vs HTTP 503 Responses", () => {
    it("produces RFC-compliant HTTP 429 responses when quota is exceeded", async () => {
      const result = {
        success: false,
        limit: 10,
        remaining: 0,
        reset: 1728652900,
        retryAfter: 45,
        backend: "redis" as const,
      };

      const res = createRateLimitResponse(result);
      expect(res.status).toBe(429);
      expect(res.headers.get("Retry-After")).toBe("45");
      expect(res.headers.get("X-RateLimit-Limit")).toBe("10");
      expect(res.headers.get("X-RateLimit-Remaining")).toBe("0");
      expect(res.headers.get("X-RateLimit-Reset")).toBe("1728652900");

      const body = await res.json();
      expect(body.error).toContain("Trop de requêtes");
      expect(body.retryAfter).toBe(45);
    });

    it("produces HTTP 503 Service Unavailable when rate-limit backend is unavailable", async () => {
      const outageResult = {
        success: false,
        limit: 5,
        remaining: 0,
        reset: 0,
        retryAfter: 60,
        backend: "redis" as const,
        serviceUnavailable: true,
      };

      const res = createRateLimitResponse(outageResult);
      expect(res.status).toBe(503);
      expect(res.headers.get("Retry-After")).toBe("60");
      // Must not leak misleading RateLimit quota headers during infrastructure outage
      expect(res.headers.get("X-RateLimit-Limit")).toBeNull();

      const body = await res.json();
      expect(body.error).toContain("Service temporairement indisponible");
      expect(body.retryAfter).toBe(60);
    });
  });

  describe("Genuinely Atomic Redis Rate Limiting via Lua Script EVAL", () => {
    it("defines an atomic Lua script that increments, sets expiry on first hit, and evaluates limit", () => {
      expect(RATE_LIMIT_LUA_SCRIPT).toContain("redis.call('INCR', KEYS[1])");
      expect(RATE_LIMIT_LUA_SCRIPT).toContain("if current == 1 then");
      expect(RATE_LIMIT_LUA_SCRIPT).toContain("redis.call('EXPIRE', KEYS[1], ARGV[1])");
      expect(RATE_LIMIT_LUA_SCRIPT).toContain("tonumber(ARGV[2])");
      expect(RATE_LIMIT_LUA_SCRIPT).toContain("return { current, allowed }");
    });

    it("invokes redis.eval with exact script, keys, and arguments", async () => {
      let counter = 0;
      const mockEval = vi.fn(async (script: string, keys: string[], args: unknown[]) => {
        expect(script).toBe(RATE_LIMIT_LUA_SCRIPT);
        expect(keys.length).toBe(1);
        expect(keys[0]).toContain("AI_OR_OCR:user-lua-test");
        expect(args[0]).toBe(120); // ttlSec = 60 * 2
        expect(args[1]).toBe(10);  // maxRequests
        counter += 1;
        return [counter, counter <= 10 ? 1 : 0] as [number, number];
      });

      const mockRedis = { eval: mockEval };
      setMockRedisClient(mockRedis as never);

      const res = await checkRateLimit("AI_OR_OCR", "user-lua-test");
      expect(res.success).toBe(true);
      expect(res.backend).toBe("redis");
      expect(res.remaining).toBe(9);
      expect(mockEval).toHaveBeenCalledTimes(1);
    });

    it("safely handles simultaneous concurrent requests through atomic EVAL execution", async () => {
      let counter = 0;
      const mockEval = vi.fn(async (_script: string, _keys: string[], args: unknown[]) => {
        counter += 1;
        const max = Number(args[1]);
        const allowed = counter <= max ? 1 : 0;
        return [counter, allowed] as [number, number];
      });

      const mockRedis = { eval: mockEval };
      setMockRedisClient(mockRedis as never);

      // Simulate 5 simultaneous requests to AUTH_REGISTER (Limit: 3)
      const concurrentRequests = Array.from({ length: 5 }, () =>
        checkRateLimit("AUTH_REGISTER", "concurrent-eval-client")
      );

      const results = await Promise.all(concurrentRequests);
      const passed = results.filter((r) => r.success);
      const blocked = results.filter((r) => !r.success);

      expect(passed.length).toBe(3);
      expect(blocked.length).toBe(2);
      expect(blocked[0]?.retryAfter).toBeGreaterThan(0);
      expect(mockEval).toHaveBeenCalledTimes(5);
    });

    it("initializes counter expiry on the first request and preserves limit on subsequent requests", async () => {
      let expirySet = false;
      let counter = 0;

      const mockEval = vi.fn(async (_script: string, _keys: string[], args: unknown[]) => {
        counter += 1;
        if (counter === 1) {
          expirySet = true;
        }
        const max = Number(args[1]);
        return [counter, counter <= max ? 1 : 0] as [number, number];
      });

      const mockRedis = { eval: mockEval };
      setMockRedisClient(mockRedis as never);

      // First hit initializes expiry
      const res1 = await checkRateLimit("AUTH_LOGIN", "expiry-init-user");
      expect(res1.success).toBe(true);
      expect(expirySet).toBe(true);

      // Second hit increments without changing expiry logic
      const res2 = await checkRateLimit("AUTH_LOGIN", "expiry-init-user");
      expect(res2.success).toBe(true);
      expect(res2.remaining).toBe(3);
    });
  });

  describe("Outage Behavior: Fail-Closed 503 vs Safe Memory Fallback", () => {
    it("fails closed with 503 for sensitive tiers during Redis eval outage", async () => {
      const mockRedis = {
        eval: vi.fn(() => {
          throw new Error("Redis cluster connection timeout during EVAL");
        }),
      };

      setMockRedisClient(mockRedis as never);

      // Sensitive authentication route: MUST fail closed (serviceUnavailable: true)
      const authRes = await checkRateLimit("AUTH_LOGIN", "login-attempt");
      expect(authRes.success).toBe(false);
      expect(authRes.serviceUnavailable).toBe(true);
      expect(authRes.backend).toBe("redis");
      expect(authRes.retryAfter).toBe(60);

      // Converting to HTTP response yields 503
      const httpRes = createRateLimitResponse(authRes);
      expect(httpRes.status).toBe(503);

      // Sensitive financial mutation route: MUST fail closed
      const financeRes = await checkRateLimit("FINANCIAL_MUTATION", "entry-mutation");
      expect(financeRes.success).toBe(false);
      expect(financeRes.serviceUnavailable).toBe(true);

      // Sensitive AI/OCR route: MUST fail closed
      const aiRes = await checkRateLimit("AI_OR_OCR", "ocr-job");
      expect(aiRes.success).toBe(false);
      expect(aiRes.serviceUnavailable).toBe(true);
    });

    it("allows justified process-local in-memory fallback for non-sensitive GENERAL_API during Redis outage", async () => {
      const mockRedis = {
        eval: vi.fn(() => {
          throw new Error("Redis connection dropped during EVAL");
        }),
      };

      setMockRedisClient(mockRedis as never);

      // Ordinary non-sensitive read endpoint: falls back to in-memory limiter to maintain availability
      const generalRes = await checkRateLimit("GENERAL_API", "general-reader");
      expect(generalRes.success).toBe(true);
      expect(generalRes.backend).toBe("memory");
      expect(generalRes.serviceUnavailable).toBeUndefined();
    });

    it("fails closed for sensitive tiers in production when Redis is unconfigured", async () => {
      setMockRedisClient(null);
      _setForceFailClosedForTesting(true);

      const sensitiveRes = await checkRateLimit("AUTH_REGISTER", "new-user");
      expect(sensitiveRes.success).toBe(false);
      expect(sensitiveRes.serviceUnavailable).toBe(true);

      // Non-sensitive tier still falls back to memory
      const generalRes = await checkRateLimit("GENERAL_API", "general-reader");
      expect(generalRes.success).toBe(true);
      expect(generalRes.backend).toBe("memory");
    });

    it("does not leak secrets or credentials in error logs during Redis failure", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      _setForceRateLimitRedisError(true);
      await checkRateLimit("AUTH_LOGIN", "sensitive-user-password-12345");

      for (const call of consoleErrorSpy.mock.calls) {
        const loggedText = call.join(" ");
        expect(loggedText).not.toContain("sensitive-user-password");
      }

      consoleErrorSpy.mockRestore();
    });
  });
});


