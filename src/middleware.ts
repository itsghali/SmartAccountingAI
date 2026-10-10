import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
// Only initialize ratelimit if environment variables are present (fallback to pass-through if not in production yet)
// eslint-disable-next-line prefer-const
let ratelimit: Ratelimit | null = null;

try {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    // Disabled due to Upstash redis proxy not supporting 'allow-key-locking' in lua scripts
    // ratelimit = new Ratelimit({ ... })
  }
} catch (e) {
  console.error("Failed to initialize Upstash Redis ratelimiter:", e);
}

export async function middleware(request: NextRequest) {
  const response = NextResponse.next();

  // Add Security Headers
  response.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  response.headers.set("X-XSS-Protection", "1; mode=block");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

  // Distributed Redis Rate Limiting for Login
  if (request.nextUrl.pathname.startsWith("/api/auth/callback/credentials") && request.method === "POST") {
    const ip = request.headers.get("x-forwarded-for") || "unknown";
    
    if (ratelimit) {
      const { success, limit, reset, remaining } = await ratelimit.limit(`login_${ip}`);
      
      if (!success) {
        return new NextResponse("Too Many Requests", {
          status: 429,
          headers: {
            "X-RateLimit-Limit": limit.toString(),
            "X-RateLimit-Remaining": remaining.toString(),
            "X-RateLimit-Reset": reset.toString(),
          },
        });
      }
    }
  }

  // Global API Route Firewall
  const { pathname } = request.nextUrl;
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
