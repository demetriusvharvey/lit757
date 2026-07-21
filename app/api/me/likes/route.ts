import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getRequestUser } from "../../../../src/lib/server-auth";
import { getVenueImage } from "../../../../src/lib/venue-image";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

async function requireUser(request: Request) {
  const user = await getRequestUser(request);
  return user || null;
}

export async function GET(request: Request) {
  const user = await requireUser(request);
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  const { data: likes, error } = await supabaseAdmin
    .from("venue_live_reports")
    .select("venue_id,created_at")
    .eq("device_id", user.id)
    .eq("report_type", "member_like")
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const venueIds = [...new Set((likes || []).map((like) => like.venue_id).filter(Boolean))];
  if (!venueIds.length) return NextResponse.json({ venueIds: [], venues: [] });

  const { data: venues, error: venuesError } = await supabaseAdmin
    .from("venues")
    .select("id,name,city,type,category,lat,lng,google_place_id,photo_source")
    .in("id", venueIds);

  if (venuesError) return NextResponse.json({ error: venuesError.message }, { status: 500 });

  const byId = new Map((venues || []).map((venue) => [venue.id, venue]));
  const ordered = venueIds.flatMap((id) => {
    const venue = byId.get(id);
    if (!venue) return [];
    return [{
      id: venue.id,
      name: venue.name,
      city: venue.city || "757",
      type: venue.type || "Local spot",
      photoUrl: getVenueImage({
        name: venue.name,
        category: venue.category,
        type: venue.type,
        googlePlaceId: venue.google_place_id,
        lat: venue.lat,
        lng: venue.lng,
      }),
    }];
  });

  return NextResponse.json({ venueIds, venues: ordered });
}

export async function POST(request: Request) {
  const user = await requireUser(request);
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const venueId = typeof body?.venueId === "string" ? body.venueId : "";
  if (!venueId) return NextResponse.json({ error: "venueId is required" }, { status: 400 });

  const { data: venue } = await supabaseAdmin.from("venues").select("id").eq("id", venueId).maybeSingle();
  if (!venue) return NextResponse.json({ error: "Venue not found" }, { status: 404 });

  await supabaseAdmin
    .from("venue_live_reports")
    .delete()
    .eq("device_id", user.id)
    .eq("venue_id", venueId)
    .eq("report_type", "member_like");

  const { error } = await supabaseAdmin.from("venue_live_reports").insert({
    venue_id: venueId,
    report_type: "member_like",
    report_value: "saved",
    venue_category: "member",
    device_id: user.id,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ liked: true, venueId });
}

export async function DELETE(request: Request) {
  const user = await requireUser(request);
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const venueId = typeof body?.venueId === "string" ? body.venueId : "";
  if (!venueId) return NextResponse.json({ error: "venueId is required" }, { status: 400 });

  const { error } = await supabaseAdmin
    .from("venue_live_reports")
    .delete()
    .eq("device_id", user.id)
    .eq("venue_id", venueId)
    .eq("report_type", "member_like");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ liked: false, venueId });
}
