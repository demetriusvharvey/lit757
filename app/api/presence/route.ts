import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { getRequestUser } from "../../../src/lib/server-auth";
import {
  exceedsRequestRate,
  guardErrorResponse,
  readBoundedJson,
  requestClientKey,
} from "../../../src/lib/server/request-guards";

const supabaseAdmin = getSupabaseAdmin();

function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const radius = 6_371_000;
  const radians = (value: number) => value * Math.PI / 180;
  const deltaLat = radians(b.lat - a.lat);
  const deltaLng = radians(b.lng - a.lng);
  const value =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(deltaLng / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (exceedsRequestRate(`presence:${user.id}:${requestClientKey(request)}`, 12, 60_000)) {
    return NextResponse.json({ error: "Too many presence checks" }, { status: 429 });
  }

  let body: Record<string, unknown>;
  try {
    body = await readBoundedJson(request, 4_096);
  } catch (error) {
    return guardErrorResponse(error);
  }
  const latitude = Number(body.latitude);
  const longitude = Number(body.longitude);
  const accuracy = Number(body.accuracy);

  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    !Number.isFinite(accuracy)
  ) return NextResponse.json({ error: "A venue and valid location are required" }, { status: 400 });

  if (accuracy <= 0 || accuracy > 100) {
    return NextResponse.json({ error: "Location accuracy is too low to verify" }, { status: 422 });
  }

  if (longitude < -76.9 || longitude > -75.7 || latitude < 36.42 || latitude > 37.38) {
    return NextResponse.json({ error: "Location is outside the 757 discovery area" }, { status: 422 });
  }

  const { data: venues, error: venueError } = await supabaseAdmin
    .from("venues")
    .select("id,name,lat,lng")
    .limit(700);

  if (venueError || !venues?.length) {
    return NextResponse.json({ error: "Venue locations are unavailable" }, { status: 503 });
  }

  const nearest = venues
    .map((venue) => ({
      venue,
      distance: distanceMeters(
        { lat: latitude, lng: longitude },
        { lat: Number(venue.lat), lng: Number(venue.lng) }
      ),
    }))
    .filter(({ distance }) => Number.isFinite(distance))
    .sort((left, right) => left.distance - right.distance)[0];

  if (!nearest || nearest.distance > 200) {
    return NextResponse.json({ error: "You are not close enough to verify this venue" }, { status: 422 });
  }

  const venueId = nearest.venue.id;

  const recent = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data: existing } = await supabaseAdmin
    .from("venue_live_reports")
    .select("id")
    .eq("venue_id", venueId)
    .eq("report_type", "nearby_presence")
    .eq("device_id", user.id)
    .gte("created_at", recent)
    .limit(1)
    .maybeSingle();

  if (!existing) {
    const { error } = await supabaseAdmin.from("venue_live_reports").insert({
      venue_id: venueId,
      report_type: "nearby_presence",
      report_value: "verified",
      venue_category: "automatic",
      device_id: user.id,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ verified: true, venueId, venueName: nearest.venue.name });
}
