import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config";
import { tokenMatches } from "@/lib/auth/webhook";
import { scan } from "@/lib/scan";

export async function POST(request: Request): Promise<Response> {
  const config = loadConfig(process.env);
  if (!config.webhookToken) {
    return NextResponse.json({ error: "webhook disabled" }, { status: 503 });
  }
  const url = new URL(request.url);
  const provided = url.searchParams.get("token") ?? request.headers.get("x-webhook-token");
  if (!tokenMatches(config.webhookToken, provided)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const report = await scan();
  return NextResponse.json({ ok: true, scannedAt: report.scannedAt });
}
