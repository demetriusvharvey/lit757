import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ success: false, error: "Venue id is required" }, { status: 400 });

  const { data: venue, error: venueError } = await db
    .from("venues")
    .select("id,name,address,city,phone,website,hours,type,category,lat,lng")
    .eq("id", id)
    .maybeSingle();

  if (venueError || !venue) {
    return NextResponse.json({ success: false, error: venueError?.message || "Venue not found" }, { status: 404 });
  }

  const { data: mappings } = await db
    .from("buzz_provider_events")
    .select("event_id")
    .eq("venue_id", id)
    .limit(50);

  const eventIds = [...new Set((mappings || []).map(row => row.event_id).filter(Boolean))];
  let upcomingEvents: Array<Record<string, unknown>> = [];
  if (eventIds.length) {
    const { data } = await db
      .from("events")
      .select("id,name,start_time,end_time,source_url,ticket_status")
      .in("id", eventIds)
      .gte("start_time", new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString())
      .order("start_time")
      .limit(8);
    upcomingEvents = data || [];
  }

  return NextResponse.json({
    success: true,
    venue: { ...venue, upcomingEvents },
  }, { headers: { "Cache-Control": "private, no-store" } });
}
