import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config";
import { signSession } from "@/lib/auth/session";

export async function POST(request: Request): Promise<Response> {
  const config = loadConfig(process.env);
  if (!config.adminPassword || !config.sessionSecret) {
    return NextResponse.redirect(new URL("/", request.url));
  }
  const form = await request.formData();
  if (form.get("password") !== config.adminPassword) {
    return NextResponse.redirect(new URL("/login?error=1", request.url));
  }
  const response = NextResponse.redirect(new URL("/", request.url));
  response.cookies.set("rt_session", signSession(config.sessionSecret), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
  return response;
}
