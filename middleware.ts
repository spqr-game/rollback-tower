import { NextResponse, type NextRequest } from "next/server";
import { loadConfig } from "@/lib/config";
import { verifySession } from "@/lib/auth/session";

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  if (
    pathname.startsWith("/api/webhook") ||
    pathname.startsWith("/login") ||
    pathname.startsWith("/api/login")
  ) {
    return NextResponse.next();
  }
  const config = loadConfig(process.env);
  if (!config.adminPassword || !config.sessionSecret) {
    return NextResponse.next();
  }
  const cookie = request.cookies.get("rt_session")?.value ?? "";
  if (verifySession(config.sessionSecret, cookie)) {
    return NextResponse.next();
  }
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
  runtime: "nodejs",
};
