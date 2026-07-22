import { NextResponse } from "next/server";
import { fetchHrtRealtime } from "../../../../../src/lib/integrations/hrt";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  try {
    const data = await fetchHrtRealtime();
    return NextResponse.json({ success: true, provider: "Hampton Roads Transit", ...data }, {
      headers: { "Cache-Control": "public, s-maxage=20, stale-while-revalidate=40" },
    });
  } catch (error) {
    return NextResponse.json({ success: false, provider: "Hampton Roads Transit", error: error instanceof Error ? error.message : "Realtime GTFS request failed" }, { status: 502 });
  }
}
