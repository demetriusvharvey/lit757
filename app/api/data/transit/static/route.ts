import { NextResponse } from "next/server";
import { fetchHrtStatic } from "../../../../../src/lib/integrations/hrt";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  try {
    const data = await fetchHrtStatic();
    return NextResponse.json({ success: true, provider: "Hampton Roads Transit", ...data }, {
      headers: { "Cache-Control": "public, s-maxage=21600, stale-while-revalidate=86400" },
    });
  } catch (error) {
    return NextResponse.json({ success: false, provider: "Hampton Roads Transit", error: error instanceof Error ? error.message : "Static GTFS request failed" }, { status: 502 });
  }
}
