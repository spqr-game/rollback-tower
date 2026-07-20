import { NextResponse } from "next/server";
import { scan } from "@/lib/scan";

export async function POST(): Promise<Response> {
  const report = await scan();
  return NextResponse.json(report);
}
