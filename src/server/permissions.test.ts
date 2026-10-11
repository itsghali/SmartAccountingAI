import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";
import {
  checkPermission,
  getUserCompanyAccess,
  assertCompanyAccess,
} from "./permissions";

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

describe("Centralized Permissions and Authoritative DB Session Freshness (src/server/permissions.ts)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default active user in database
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "user-1",
      organizationId: "org-1",
      role: "ACCOUNTANT",
      isActive: true,
    } as never);
  });

  describe("getUserCompanyAccess", () => {
    it("returns null when user is not authenticated", async () => {
      vi.mocked(auth).mockResolvedValue(null as never);

      const access = await getUserCompanyAccess("comp-1");
      expect(access).toBeNull();
    });

    it("returns null when user does not exist in database (deleted user)", async () => {
      vi.mocked(auth).mockResolvedValue({
        user: { id: "user-deleted" },
        expires: "",
      } as never);
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

      const access = await getUserCompanyAccess("comp-1");
      expect(access).toBeNull();
    });

    it("returns null when user is disabled in database (deactivated user)", async () => {
      vi.mocked(auth).mockResolvedValue({
        user: { id: "user-1" },
        expires: "",
      } as never);
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: "user-1",
        organizationId: "org-1",
        role: "ACCOUNTANT",
        isActive: false,
      } as never);

      const access = await getUserCompanyAccess("comp-1");
      expect(access).toBeNull();
    });

    it("returns null when company does not exist", async () => {
      vi.mocked(auth).mockResolvedValue({
        user: { id: "user-1" },
        expires: "",
      } as never);
      vi.mocked(prisma.company.findUnique).mockResolvedValue(null);

      const access = await getUserCompanyAccess("comp-1");
      expect(access).toBeNull();
    });

    it("returns null when company belongs to another organization (cross-tenant IDOR defense)", async () => {
      vi.mocked(auth).mockResolvedValue({
        user: { id: "user-1" },
        expires: "",
      } as never);
      vi.mocked(prisma.company.findUnique).mockResolvedValue({
        organizationId: "org-victim",
      } as never);

      const access = await getUserCompanyAccess("comp-victim");
      expect(access).toBeNull();
      expect(prisma.userCompanyAccess.findUnique).not.toHaveBeenCalled();
    });

    it("returns user access record when active user and tenant match", async () => {
      vi.mocked(auth).mockResolvedValue({
        user: { id: "user-1" },
        expires: "",
      } as never);
      vi.mocked(prisma.company.findUnique).mockResolvedValue({
        organizationId: "org-1",
      } as never);
      vi.mocked(prisma.userCompanyAccess.findUnique).mockResolvedValue({
        userId: "user-1",
        companyId: "comp-1",
        canAccessEntries: true,
      } as never);

      const access = await getUserCompanyAccess("comp-1");
      expect(access).toEqual(
        expect.objectContaining({
          userId: "user-1",
          companyId: "comp-1",
          canAccessEntries: true,
        })
      );
    });
  });

  describe("checkPermission", () => {
    it("returns false when user is unauthenticated", async () => {
      vi.mocked(auth).mockResolvedValue(null as never);

      const permitted = await checkPermission("comp-1", "canAccessEntries");
      expect(permitted).toBe(false);
    });

    it("returns false when user is disabled in database (deactivated user)", async () => {
      vi.mocked(auth).mockResolvedValue({
        user: { id: "user-1", role: "SUPER_ADMIN", organizationId: "org-1" },
        expires: "",
      } as never);
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: "user-1",
        organizationId: "org-1",
        role: "SUPER_ADMIN",
        isActive: false,
      } as never);

      const permitted = await checkPermission("comp-1", "canAccessEntries");
      expect(permitted).toBe(false);
    });

    it("returns false when user is deleted in database", async () => {
      vi.mocked(auth).mockResolvedValue({
        user: { id: "user-deleted" },
        expires: "",
      } as never);
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

      const permitted = await checkPermission("comp-1", "canAccessEntries");
      expect(permitted).toBe(false);
    });

    it("enforces authoritative role: rejects access if stale JWT claims SUPER_ADMIN but DB role is demoted to ACCOUNTANT", async () => {
      // Stale JWT token claims SUPER_ADMIN
      vi.mocked(auth).mockResolvedValue({
        user: { id: "user-1", organizationId: "org-1", role: "SUPER_ADMIN" },
        expires: "",
      } as never);
      // Authoritative database state has demoted the user to ACCOUNTANT
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: "user-1",
        organizationId: "org-1",
        role: "ACCOUNTANT",
        isActive: true,
      } as never);
      vi.mocked(prisma.company.findUnique).mockResolvedValue({
        organizationId: "org-1",
      } as never);
      // No company access record
      vi.mocked(prisma.userCompanyAccess.findUnique).mockResolvedValue(null);

      const permitted = await checkPermission("comp-1", "canAccessEntries");
      expect(permitted).toBe(false);
    });

    it("enforces authoritative organization: rejects access to old tenant if user was reassigned in database", async () => {
      // Stale JWT claims org-1
      vi.mocked(auth).mockResolvedValue({
        user: { id: "user-1", organizationId: "org-1", role: "SUPER_ADMIN" },
        expires: "",
      } as never);
      // Authoritative database state reassigned user to org-new
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: "user-1",
        organizationId: "org-new",
        role: "SUPER_ADMIN",
        isActive: true,
      } as never);
      // Target company still belongs to org-1
      vi.mocked(prisma.company.findUnique).mockResolvedValue({
        organizationId: "org-1",
      } as never);

      const permitted = await checkPermission("comp-1", "canAccessEntries");
      expect(permitted).toBe(false);
    });

    it("prevents SUPER_ADMIN from accessing companies belonging to another tenant (cross-tenant)", async () => {
      vi.mocked(auth).mockResolvedValue({
        user: { id: "super-1" },
        expires: "",
      } as never);
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: "super-1",
        organizationId: "org-1",
        role: "SUPER_ADMIN",
        isActive: true,
      } as never);
      vi.mocked(prisma.company.findUnique).mockResolvedValue({
        organizationId: "org-target-tenant",
      } as never);

      const permitted = await checkPermission("comp-target", "canAccessSetup");
      expect(permitted).toBe(false);
    });

    it("grants SUPER_ADMIN access to any company in their own authoritative tenant", async () => {
      vi.mocked(auth).mockResolvedValue({
        user: { id: "super-1" },
        expires: "",
      } as never);
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: "super-1",
        organizationId: "org-1",
        role: "SUPER_ADMIN",
        isActive: true,
      } as never);
      vi.mocked(prisma.company.findUnique).mockResolvedValue({
        organizationId: "org-1",
      } as never);

      const permitted = await checkPermission("comp-1", "canAccessSetup");
      expect(permitted).toBe(true);
    });

    it("returns false for non-SUPER_ADMIN when company belongs to another tenant", async () => {
      vi.mocked(auth).mockResolvedValue({
        user: { id: "user-1" },
        expires: "",
      } as never);
      vi.mocked(prisma.company.findUnique).mockResolvedValue({
        organizationId: "org-other",
      } as never);

      const permitted = await checkPermission("comp-other", "canAccessEntries");
      expect(permitted).toBe(false);
    });

    it("returns false for non-SUPER_ADMIN when user has no company access record", async () => {
      vi.mocked(auth).mockResolvedValue({
        user: { id: "user-1" },
        expires: "",
      } as never);
      vi.mocked(prisma.company.findUnique).mockResolvedValue({
        organizationId: "org-1",
      } as never);
      vi.mocked(prisma.userCompanyAccess.findUnique).mockResolvedValue(null);

      const permitted = await checkPermission("comp-1", "canAccessEntries");
      expect(permitted).toBe(false);
    });

    it("returns false when user lacks the specific required permission flag", async () => {
      vi.mocked(auth).mockResolvedValue({
        user: { id: "user-1" },
        expires: "",
      } as never);
      vi.mocked(prisma.company.findUnique).mockResolvedValue({
        organizationId: "org-1",
      } as never);
      vi.mocked(prisma.userCompanyAccess.findUnique).mockResolvedValue({
        userId: "user-1",
        companyId: "comp-1",
        canAccessEntries: true,
        canValidateEntries: false,
      } as never);

      const permitted = await checkPermission("comp-1", "canValidateEntries");
      expect(permitted).toBe(false);
    });

    it("returns true when user has the specific required permission flag", async () => {
      vi.mocked(auth).mockResolvedValue({
        user: { id: "user-1" },
        expires: "",
      } as never);
      vi.mocked(prisma.company.findUnique).mockResolvedValue({
        organizationId: "org-1",
      } as never);
      vi.mocked(prisma.userCompanyAccess.findUnique).mockResolvedValue({
        userId: "user-1",
        companyId: "comp-1",
        canAccessEntries: true,
        canValidateEntries: true,
      } as never);

      const permitted = await checkPermission("comp-1", "canValidateEntries");
      expect(permitted).toBe(true);
    });

    it("returns true without requiredPermission when user has company access record", async () => {
      vi.mocked(auth).mockResolvedValue({
        user: { id: "user-1" },
        expires: "",
      } as never);
      vi.mocked(prisma.company.findUnique).mockResolvedValue({
        organizationId: "org-1",
      } as never);
      vi.mocked(prisma.userCompanyAccess.findUnique).mockResolvedValue({
        userId: "user-1",
        companyId: "comp-1",
      } as never);

      const permitted = await checkPermission("comp-1");
      expect(permitted).toBe(true);
    });

    it("throws error and fails closed on database lookup failure", async () => {
      vi.mocked(auth).mockResolvedValue({
        user: { id: "user-1" },
        expires: "",
      } as never);
      vi.mocked(prisma.user.findUnique).mockRejectedValue(new Error("Database connection lost"));

      await expect(checkPermission("comp-1", "canAccessEntries")).rejects.toThrow(
        "Erreur de vérification des autorisations"
      );
    });
  });

  describe("assertCompanyAccess", () => {
    it("returns 401 when unauthenticated", async () => {
      vi.mocked(auth).mockResolvedValue(null as never);

      const result = await assertCompanyAccess("comp-1");
      expect(result).toEqual({ authorized: false, status: 401, error: "Non autorisé" });
    });

    it("returns 401 when user is deactivated in database", async () => {
      vi.mocked(auth).mockResolvedValue({
        user: { id: "user-1" },
        expires: "",
      } as never);
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: "user-1",
        organizationId: "org-1",
        role: "ACCOUNTANT",
        isActive: false,
      } as never);

      const result = await assertCompanyAccess("comp-1");
      expect(result).toEqual({
        authorized: false,
        status: 401,
        error: "Compte utilisateur inactif ou introuvable",
      });
    });

    it("returns 403 when forbidden (cross-tenant)", async () => {
      vi.mocked(auth).mockResolvedValue({
        user: { id: "user-1" },
        expires: "",
      } as never);
      vi.mocked(prisma.company.findUnique).mockResolvedValue({
        organizationId: "org-different",
      } as never);

      const result = await assertCompanyAccess("comp-different", "canAccessVAT");
      expect(result).toEqual({ authorized: false, status: 403, error: "Forbidden" });
    });

    it("returns 500 when database lookup fails (infrastructure outage)", async () => {
      vi.mocked(auth).mockResolvedValue({
        user: { id: "user-1" },
        expires: "",
      } as never);
      vi.mocked(prisma.user.findUnique).mockRejectedValue(new Error("Database unavailable"));

      const result = await assertCompanyAccess("comp-1", "canAccessSetup");
      expect(result).toEqual({
        authorized: false,
        status: 500,
        error: "Erreur de vérification des autorisations",
      });
    });

    it("returns authorized: true and authoritative database user ids when permitted", async () => {
      vi.mocked(auth).mockResolvedValue({
        user: { id: "user-1" },
        expires: "",
      } as never);
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: "user-1",
        organizationId: "org-authoritative",
        role: "SUPER_ADMIN",
        isActive: true,
      } as never);
      vi.mocked(prisma.company.findUnique).mockResolvedValue({
        organizationId: "org-authoritative",
      } as never);

      const result = await assertCompanyAccess("comp-1", "canAccessSetup");
      expect(result).toEqual({
        authorized: true,
        userId: "user-1",
        organizationId: "org-authoritative",
      });
    });
  });
});
