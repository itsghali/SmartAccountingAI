import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";
import { isSessionRevoked } from "@/server/session-revocation";

export type CompanyPermissionKey =
  | "canAccessSetup"
  | "canAccessEntries"
  | "canAccessVAT"
  | "canAccessFixedAssets"
  | "canAccessAnalytical"
  | "canAccessTaxPackage"
  | "canAccessReports"
  | "canAccessUserManagement"
  | "canValidateEntries"
  | "canDeleteDraftEntries"
  | "canCloseExercise"
  | "canImportData"
  | "canExportData";

export async function getUserCompanyAccess(companyId: string) {
  const session = await auth();
  if (!session?.user?.id) return null;

  // Authoritative user state and company lookup
  const [user, company] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { id: true, organizationId: true, role: true, isActive: true },
    }),
    prisma.company.findUnique({
      where: { id: companyId },
      select: { organizationId: true },
    }),
  ]);

  if (!user || !user.isActive || !user.organizationId) {
    return null;
  }

  // Strict tenant check: verify company belongs to the user's authoritative organization
  if (!company || company.organizationId !== user.organizationId) {
    return null;
  }

  const access = await prisma.userCompanyAccess.findUnique({
    where: {
      userId_companyId: {
        userId: user.id,
        companyId,
      },
    },
  });

  return access;
}

export async function assertCompanyAccess(
  companyId: string,
  requiredPermission?: CompanyPermissionKey
): Promise<
  | { authorized: true; userId: string; organizationId: string }
  | { authorized: false; status: 401 | 403 | 500; error: string }
> {
  const session = await auth();
  if (!session?.user?.id) {
    return { authorized: false, status: 401, error: "Non autorisé" };
  }

  try {
    if (session.user.jti) {
      const revoked = await isSessionRevoked({
        jti: session.user.jti,
        userId: session.user.id,
      });
      if (revoked) {
        return { authorized: false, status: 401, error: "Session révoquée" };
      }
    }

    const [user, company] = await Promise.all([
      prisma.user.findUnique({
        where: { id: session.user.id },
        select: { id: true, organizationId: true, role: true, isActive: true },
      }),
      prisma.company.findUnique({
        where: { id: companyId },
        select: { organizationId: true },
      }),
    ]);

    if (!user || !user.isActive || !user.organizationId) {
      return {
        authorized: false,
        status: 401,
        error: "Compte utilisateur inactif ou introuvable",
      };
    }

    if (!company || company.organizationId !== user.organizationId) {
      return { authorized: false, status: 403, error: "Forbidden" };
    }

    if (user.role === "SUPER_ADMIN") {
      return {
        authorized: true,
        userId: user.id,
        organizationId: user.organizationId,
      };
    }

    const access = await prisma.userCompanyAccess.findUnique({
      where: {
        userId_companyId: {
          userId: user.id,
          companyId,
        },
      },
    });

    if (!access) {
      return { authorized: false, status: 403, error: "Forbidden" };
    }

    if (requiredPermission && access[requiredPermission] !== true) {
      return { authorized: false, status: 403, error: "Forbidden" };
    }

    return {
      authorized: true,
      userId: user.id,
      organizationId: user.organizationId,
    };
  } catch (error) {
    console.error("Authorization infrastructure failure in assertCompanyAccess:", error);
    return {
      authorized: false,
      status: 500,
      error: "Erreur de vérification des autorisations",
    };
  }
}

export async function checkPermission(
  companyId: string,
  requiredPermission?: CompanyPermissionKey
): Promise<boolean> {
  const result = await assertCompanyAccess(companyId, requiredPermission);
  if (!result.authorized) {
    if (result.status === 500) {
      throw new Error(result.error);
    }
    return false;
  }
  return true;
}
