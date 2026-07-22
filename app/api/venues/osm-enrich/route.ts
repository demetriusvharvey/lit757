import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  return NextResponse.json({ success: false, error: "OpenStreetMap enrichment is not configured yet" }, { status: 503 });
}
