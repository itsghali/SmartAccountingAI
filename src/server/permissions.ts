import { auth } from "@/server/auth";
import { prisma } from "@/server/prisma";

export async function getUserCompanyAccess(companyId: string) {
  const session = await auth();
  if (!session?.user) return null;

  const access = await prisma.userCompanyAccess.findUnique({
    where: {
      userId_companyId: {
        userId: session.user.id,
        companyId,
      },
    },
  });

  return access;
}

export async function checkPermission(companyId: string, requiredPermission: keyof Omit<Parameters<typeof prisma.userCompanyAccess.update>[0]['data'], "id" | "userId" | "companyId" | "createdAt" | "updatedAt">) {
  const session = await auth();
  if (!session?.user) return false;

  if (session.user.role === "SUPER_ADMIN") {
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { organizationId: true }
    });
    if (company && company.organizationId === session.user.organizationId) {
      return true;
    }
  }

  const access = await getUserCompanyAccess(companyId);
  if (!access) return false;
  return access[requiredPermission as keyof typeof access] === true;
}
