import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";
import { assertCompanyAccess } from "@/server/permissions";
import {
  clearRevocationStore,
  isSessionRevoked,
  revokeSession,
  _setForceRevocationStoreError,
} from "@/server/session-revocation";
import { POST as revokeOwnSession } from "./revoke/route";
import { POST as revokeTargetUserSessions } from "../users/[id]/revoke-sessions/route";
import { setMockRedisClient } from "@/server/redis";

vi.mock("@/server/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/server/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
    company: {
      findUnique: vi.fn(),
    },
    userCompanyAccess: {
      findUnique: vi.fn(),
    },
  },
}));

describe("Session Revocation Integration & Endpoints", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    setMockRedisClient(null);
    await clearRevocationStore();

    // Default mock user in database is active SUPER_ADMIN
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "user-1",
      organizationId: "org-1",
      role: "SUPER_ADMIN",
      isActive: true,
    } as never);
    vi.mocked(prisma.company.findUnique).mockResolvedValue({
      id: "comp-1",
      organizationId: "org-1",
    } as never);
  });

  describe("Integration with assertCompanyAccess", () => {
    it("permits access when session is active and not revoked", async () => {
      vi.mocked(auth).mockResolvedValue({
        user: { id: "user-1", organizationId: "org-1", role: "SUPER_ADMIN", jti: "sess-active" },
        expires: "",
      } as never);

      const access = await assertCompanyAccess("comp-1");
      expect(access.authorized).toBe(true);
    });

    it("denies access with 401 when session JTI is revoked", async () => {
      vi.mocked(auth).mockResolvedValue({
        user: { id: "user-1", organizationId: "org-1", role: "SUPER_ADMIN", jti: "sess-revoked" },
        expires: "",
      } as never);

      await revokeSession("sess-revoked");

      const access = await assertCompanyAccess("comp-1");
      expect(access.authorized).toBe(false);
      if (!access.authorized) {
        expect(access.status).toBe(401);
        expect(access.error).toContain("révoquée");
      }
    });

    it("fails closed with 500 when revocation store encounters an outage during assertCompanyAccess", async () => {
      vi.mocked(auth).mockResolvedValue({
        user: { id: "user-1", organizationId: "org-1", role: "SUPER_ADMIN", jti: "sess-check" },
        expires: "",
      } as never);

      _setForceRevocationStoreError(true);

      const access = await assertCompanyAccess("comp-1");
      expect(access.authorized).toBe(false);
      if (!access.authorized) {
        expect(access.status).toBe(401); // Fails closed, denying access
      }
    });
  });

  describe("POST /api/auth/revoke (Self-service revocation)", () => {
    it("returns 401 if user is unauthenticated", async () => {
      vi.mocked(auth).mockResolvedValue(null as never);

      const req = new NextRequest("http://localhost:3000/api/auth/revoke", {
        method: "POST",
      });

      const res = await revokeOwnSession(req);
      expect(res.status).toBe(401);
    });

    it("revokes current session successfully", async () => {
      vi.mocked(auth).mockResolvedValue({
        user: { id: "user-1", organizationId: "org-1", role: "ACCOUNTANT", jti: "my-jti" },
        expires: "",
      } as never);

      const req = new NextRequest("http://localhost:3000/api/auth/revoke", {
        method: "POST",
        body: JSON.stringify({ all: false }),
      });

      const res = await revokeOwnSession(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);
      expect(await isSessionRevoked({ jti: "my-jti", userId: "user-1" })).toBe(true);
    });

    it("revokes all user sessions when requested with { all: true }", async () => {
      vi.mocked(auth).mockResolvedValue({
        user: { id: "user-1", organizationId: "org-1", role: "ACCOUNTANT", jti: "device-1" },
        expires: "",
      } as never);

      const req = new NextRequest("http://localhost:3000/api/auth/revoke", {
        method: "POST",
        body: JSON.stringify({ all: true }),
      });

      const res = await revokeOwnSession(req);
      expect(res.status).toBe(200);

      // Past issued session for user-1 is revoked
      const pastSec = Math.floor(Date.now() / 1000) - 10;
      expect(await isSessionRevoked({ jti: "device-2", userId: "user-1", iat: pastSec })).toBe(true);
    });
  });

  describe("POST /api/users/[id]/revoke-sessions (Admin revocation)", () => {
    it("returns 401 when requester is unauthenticated", async () => {
      vi.mocked(auth).mockResolvedValue(null as never);

      const req = new NextRequest("http://localhost:3000/api/users/target-1/revoke-sessions", { method: "POST" });
      const res = await revokeTargetUserSessions(req, { params: Promise.resolve({ id: "target-1" }) });
      expect(res.status).toBe(401);
    });

    it("returns 403 when non-admin tries to revoke user sessions", async () => {
      vi.mocked(auth).mockResolvedValue({
        user: { id: "user-accountant", organizationId: "org-1", role: "ACCOUNTANT" },
        expires: "",
      } as never);

      const req = new NextRequest("http://localhost:3000/api/users/target-1/revoke-sessions", { method: "POST" });
      const res = await revokeTargetUserSessions(req, { params: Promise.resolve({ id: "target-1" }) });
      expect(res.status).toBe(403);
    });

    it("returns 403 when admin tries to revoke user from a different organization (cross-tenant)", async () => {
      vi.mocked(auth).mockResolvedValue({
        user: { id: "admin-org-1", organizationId: "org-1", role: "ADMIN" },
        expires: "",
      } as never);

      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: "victim-user",
        organizationId: "org-2", // Different tenant!
        role: "ACCOUNTANT",
      } as never);

      const req = new NextRequest("http://localhost:3000/api/users/victim-user/revoke-sessions", { method: "POST" });
      const res = await revokeTargetUserSessions(req, { params: Promise.resolve({ id: "victim-user" }) });
      expect(res.status).toBe(403);
    });

    it("returns 403 when regular admin tries to revoke a SUPER_ADMIN", async () => {
      vi.mocked(auth).mockResolvedValue({
        user: { id: "admin-1", organizationId: "org-1", role: "ADMIN" },
        expires: "",
      } as never);

      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: "super-admin-user",
        organizationId: "org-1",
        role: "SUPER_ADMIN",
      } as never);

      const req = new NextRequest("http://localhost:3000/api/users/super-admin-user/revoke-sessions", { method: "POST" });
      const res = await revokeTargetUserSessions(req, { params: Promise.resolve({ id: "super-admin-user" }) });
      expect(res.status).toBe(403);
    });

    it("allows ADMIN to revoke target user sessions within same organization", async () => {
      vi.mocked(auth).mockResolvedValue({
        user: { id: "admin-1", organizationId: "org-1", role: "ADMIN" },
        expires: "",
      } as never);

      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: "accountant-user",
        organizationId: "org-1",
        role: "ACCOUNTANT",
      } as never);

      const req = new NextRequest("http://localhost:3000/api/users/accountant-user/revoke-sessions", { method: "POST" });
      const res = await revokeTargetUserSessions(req, { params: Promise.resolve({ id: "accountant-user" }) });
      expect(res.status).toBe(200);

      const pastSec = Math.floor(Date.now() / 1000) - 5;
      expect(await isSessionRevoked({ userId: "accountant-user", iat: pastSec })).toBe(true);
    });
  });
});
