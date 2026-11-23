import { NextResponse, type NextRequest } from "next/server";

/**
 * Interface Archaeology is a local tool: its API can read local directories
 * and clone repositories. Reject requests that do not come from the local
 * machine (DNS rebinding) and cross-site writes (CSRF from other web pages).
 */
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

export function proxy(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  if (!LOCAL_HOST.test(host) && process.env.IA_ALLOW_REMOTE !== "1") {
    return NextResponse.json({ error: { message: "Interface Archaeology only accepts requests addressed to localhost." } }, { status: 403 });
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    const origin = request.headers.get("origin");
    if (origin && new URL(origin).host !== host) {
      return NextResponse.json({ error: { message: "Cross-origin requests are not allowed." } }, { status: 403 });
    }
  }
  return NextResponse.next();
}

export const config = { matcher: "/api/:path*" };
