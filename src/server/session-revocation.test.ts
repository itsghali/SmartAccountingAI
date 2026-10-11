import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearRevocationStore,
  getRevocationStoreType,
  isSessionRevoked,
  revokeAllUserSessions,
  revokeSession,
  _setForceRevocationStoreError,
} from "./session-revocation";
import { setMockRedisClient } from "./redis";

describe("Session Revocation (src/server/session-revocation.ts)", () => {
  beforeEach(async () => {
    setMockRedisClient(null); // Ensure in-memory fallback for base tests
    await clearRevocationStore();
  });

  describe("In-Memory Store: Single Session Revocation (by JTI)", () => {
    it("reports an unrevoked session as valid (false)", async () => {
      const revoked = await isSessionRevoked({
        jti: "valid-session-123",
        userId: "user-1",
        iat: Math.floor(Date.now() / 1000),
      });

      expect(revoked).toBe(false);
    });

    it("revokes a single session without affecting other sessions for the same user", async () => {
      const jtiA = "session-device-a";
      const jtiB = "session-device-b";
      const userId = "user-1";
      const nowSec = Math.floor(Date.now() / 1000);

      // Revoke only session A
      await revokeSession(jtiA);

      const revokedA = await isSessionRevoked({ jti: jtiA, userId, iat: nowSec });
      const revokedB = await isSessionRevoked({ jti: jtiB, userId, iat: nowSec });

      expect(revokedA).toBe(true);
      expect(revokedB).toBe(false);
    });

    it("does not revoke unrelated users' sessions", async () => {
      const jti1 = "user-1-session";
      const jti2 = "user-2-session";

      await revokeSession(jti1);

      expect(await isSessionRevoked({ jti: jti1, userId: "user-1", iat: 100 })).toBe(true);
      expect(await isSessionRevoked({ jti: jti2, userId: "user-2", iat: 100 })).toBe(false);
    });

    it("throws an error when invalid jti is passed to revokeSession", async () => {
      await expect(revokeSession("")).rejects.toThrow("Invalid session identifier");
      await expect(revokeSession(null as unknown as string)).rejects.toThrow("Invalid session identifier");
    });
  });

  describe("User-Wide Session Revocation (by userId & timestamp)", () => {
    it("revokes all sessions issued before or at revocation time", async () => {
      const userId = "user-to-revoke";
      const pastSec = Math.floor(Date.now() / 1000) - 60; // 1 min ago

      await revokeAllUserSessions(userId);

      const isOldSessionRevoked = await isSessionRevoked({
        jti: "old-session",
        userId,
        iat: pastSec,
      });

      expect(isOldSessionRevoked).toBe(true);
    });

    it("allows fresh sessions issued AFTER the revocation timestamp", async () => {
      const userId = "user-relogin";

      await revokeAllUserSessions(userId);

      // Simulate a new login occurring 2 seconds after revocation
      const futureSec = Math.floor(Date.now() / 1000) + 2;

      const isNewSessionRevoked = await isSessionRevoked({
        jti: "fresh-session-after-relogin",
        userId,
        iat: futureSec,
      });

      expect(isNewSessionRevoked).toBe(false);
    });

    it("fails closed (revoked) if user token has no iat claim after user revocation", async () => {
      const userId = "user-no-iat";
      await revokeAllUserSessions(userId);

      const revoked = await isSessionRevoked({
        jti: "session-without-iat",
        userId,
        iat: null,
      });

      expect(revoked).toBe(true);
    });

    it("user-wide revocation on user-1 does not affect user-2", async () => {
      await revokeAllUserSessions("user-1");

      const nowSec = Math.floor(Date.now() / 1000);
      const user2Revoked = await isSessionRevoked({
        jti: "user-2-session",
        userId: "user-2",
        iat: nowSec - 10,
      });

      expect(user2Revoked).toBe(false);
    });

    it("throws an error when invalid userId is passed to revokeAllUserSessions", async () => {
      await expect(revokeAllUserSessions("")).rejects.toThrow("Invalid userId provided");
    });
  });

  describe("Invalid & Missing Session Claims", () => {
    it("fails closed when neither jti nor userId is provided", async () => {
      const result = await isSessionRevoked({});
      expect(result).toBe(true);

      const resultNull = await isSessionRevoked({ jti: null, userId: null });
      expect(resultNull).toBe(true);
    });
  });

  describe("Fail-Closed Security & Infrastructure Outages", () => {
    it("fails closed (returns true) when revocation store lookup fails", async () => {
      _setForceRevocationStoreError(true);

      const isRevoked = await isSessionRevoked({
        jti: "any-session",
        userId: "user-1",
        iat: Math.floor(Date.now() / 1000),
      });

      // Crucial security requirement: fail closed rather than accidentally granting access
      expect(isRevoked).toBe(true);
    });

    it("fails closed and throws error when revokeSession experiences store outage", async () => {
      _setForceRevocationStoreError(true);

      await expect(revokeSession("session-1")).rejects.toThrow("Revocation store failure");
    });

    it("fails closed and throws error when revokeAllUserSessions experiences store outage", async () => {
      _setForceRevocationStoreError(true);

      await expect(revokeAllUserSessions("user-1")).rejects.toThrow("Revocation store failure");
    });
  });

  describe("Redis Backend Integration (Mocked)", () => {
    it("interacts properly with Redis when configured", async () => {
      const mockStorage = new Map<string, string>();

      const mockRedis = {
        set: vi.fn(async (key: string, val: string) => {
          mockStorage.set(key, val);
          return "OK";
        }),
        get: vi.fn(async (key: string) => {
          return mockStorage.get(key) || null;
        }),
      };

      setMockRedisClient(mockRedis as never);
      expect(getRevocationStoreType()).toBe("redis");

      // 1. Revoke single session
      await revokeSession("redis-session-123", 3600);
      expect(mockRedis.set).toHaveBeenCalledWith("session_revoked:jti:redis-session-123", "1", { ex: 3600 });

      // 2. Check revoked session
      const revoked = await isSessionRevoked({
        jti: "redis-session-123",
        userId: "user-1",
        iat: Math.floor(Date.now() / 1000),
      });
      expect(revoked).toBe(true);

      // 3. Check unrevoked session
      const valid = await isSessionRevoked({
        jti: "unrevoked-session",
        userId: "user-1",
        iat: Math.floor(Date.now() / 1000),
      });
      expect(valid).toBe(false);

      // 4. Redis failure fails closed
      vi.mocked(mockRedis.get).mockRejectedValueOnce(new Error("Redis connection refused"));
      const failClosed = await isSessionRevoked({
        jti: "unrevoked-session",
        userId: "user-1",
      });
      expect(failClosed).toBe(true);
    });
  });
});
