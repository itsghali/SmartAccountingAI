import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { checkRateLimit, createRateLimitResponse, getClientIp } from "@/server/rate-limit";

export async function middleware(request: NextRequest) {
  const response = NextResponse.next();

  // Add Security Headers
  response.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  response.headers.set("X-XSS-Protection", "1; mode=block");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

  const { pathname } = request.nextUrl;

  // Rate Limiting for Credentials Login
  if (pathname.startsWith("/api/auth/callback/credentials") && request.method === "POST") {
    const ip = getClientIp(request);
    const result = await checkRateLimit("AUTH_LOGIN", `login_${ip}`);
    if (!result.success) {
      return createRateLimitResponse(result);
    }
  }

  // Rate Limiting for Registration
  if (pathname.startsWith("/api/auth/register") && request.method === "POST") {
    const ip = getClientIp(request);
    const result = await checkRateLimit("AUTH_REGISTER", `register_${ip}`);
    if (!result.success) {
      return createRateLimitResponse(result);
    }
  }

  // Global API Route Firewall
  if (pathname.startsWith("/api/") && !pathname.startsWith("/api/auth/")) {
    const hasSession = request.cookies.has("authjs.session-token") || request.cookies.has("__Secure-authjs.session-token");
    if (!hasSession) {
      return NextResponse.json({ error: "Unauthorized access" }, { status: 401 });
    }
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
