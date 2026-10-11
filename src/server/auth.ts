import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { UserRole } from "@prisma/client";
import { prisma } from "@/server/prisma";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { isSessionRevoked, revokeSession } from "@/server/session-revocation";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) return null;

        const user = await prisma.user.findUnique({
          where: { email: parsed.data.email },
          include: { organization: true },
        });

        if (!user || !user.isActive) return null;

        const isValid = await bcrypt.compare(
          parsed.data.password,
          user.passwordHash
        );
        if (!isValid) return null;

        await prisma.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        });

        return {
          id: user.id,
          email: user.email,
          name: `${user.firstName} ${user.lastName}`,
          role: user.role,
          organizationId: user.organizationId,
        };
      },
    }),
  ],
  events: {
    async signOut(message) {
      if ("token" in message && message.token) {
        const jti = (message.token as { jti?: string }).jti;
        if (jti) {
          try {
            await revokeSession(jti);
          } catch (error) {
            console.error(
              "[Auth] Failed to revoke session during sign-out:",
              error instanceof Error ? error.message : "Unknown error"
            );
          }
        }
      }
    },
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role as UserRole;
        token.organizationId = user.organizationId;
        token.jti = (token.jti as string) || crypto.randomUUID();
      }
      return token;
    },
    async session({ session, token }) {
      if (token?.jti || token?.id) {
        const isRevoked = await isSessionRevoked({
          jti: token.jti as string | undefined,
          userId: token.id as string | undefined,
          iat: token.iat as number | undefined,
        });

        if (isRevoked) {
          return null as never;
        }
      }

      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as UserRole;
        session.user.organizationId = token.organizationId as string;
        session.user.jti = token.jti as string | undefined;
      }
      return session;
    },
  },
});

