import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import {
  exceedsRequestRate,
  guardErrorResponse,
  readBoundedJson,
  requestClientKey,
} from "../../../../src/lib/server/request-guards";

export const dynamic = "force-dynamic";

const db = getSupabaseAdmin();

const HAMPTON_ROADS = { west: -76.9, east: -75.7, south: 36.42, north: 37.38 };
const radians = (value: number) => value * Math.PI / 180;

function meters(lat1: number, lng1: number, lat2: number, lng2: number) {
  const dLat = radians(lat2 - lat1);
  const dLng = radians(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function deviceHash(sessionId: string) {
  const secret = process.env.BUZZ_PARTNER_INGEST_SECRET;
  if (!secret || secret.length < 32) return null;
  return `anon_${createHmac("sha256", secret).update(sessionId).digest("hex").slice(0, 32)}`;
}

export async function POST(request: Request) {
  if (exceedsRequestRate(`passive-presence:${requestClientKey(request)}`, 12, 60_000)) {
    return NextResponse.json({ success: false, error: "Too many requests" }, { status: 429 });
  }
  let body: Record<string, unknown>;
  try {
    body = await readBoundedJson(request, 4_096);
  } catch (error) {
    return guardErrorResponse(error);
  }

  const sessionId = String(body.sessionId || "");
  const latitude = Number(body.latitude);
  const longitude = Number(body.longitude);
  const accuracy = Number(body.accuracy);

  if (!/^[A-Za-z0-9_-]{20,160}$/.test(sessionId)) {
    return NextResponse.json({ success: false, error: "Invalid session" }, { status: 400 });
  }
  if (![latitude, longitude, accuracy].every(Number.isFinite)) {
    return NextResponse.json({ success: false, error: "Valid location is required" }, { status: 400 });
  }
  if (accuracy <= 0 || accuracy > 150) {
    return NextResponse.json({ success: true, accepted: false, reason: "location_accuracy_too_low" });
  }
  if (
    longitude < HAMPTON_ROADS.west || longitude > HAMPTON_ROADS.east ||
    latitude < HAMPTON_ROADS.south || latitude > HAMPTON_ROADS.north
  ) {
    return NextResponse.json({ success: true, accepted: false, reason: "outside_market" });
  }

  const hash = deviceHash(sessionId);
  if (!hash) return NextResponse.json({ success: false, error: "Presence hashing is unavailable" }, { status: 503 });

  const latDelta = 0.003;
  const lngDelta = 0.004;
  const { data: venueRows, error: venueError } = await db
    .from("venues")
    .select("id,name,lat,lng")
    .gte("lat", latitude - latDelta)
    .lte("lat", latitude + latDelta)
    .gte("lng", longitude - lngDelta)
    .lte("lng", longitude + lngDelta)
    .limit(100);

  if (venueError) return NextResponse.json({ success: false, error: venueError.message }, { status: 500 });

  const nearest = (venueRows || [])
    .map(venue => ({
      venue,
      distance: meters(latitude, longitude, Number(venue.lat), Number(venue.lng)),
    }))
    .filter(item => Number.isFinite(item.distance))
    .sort((left, right) => left.distance - right.distance)[0];

  const maximumDistance = Math.min(140, Math.max(75, accuracy * 1.4));
  if (!nearest || nearest.distance > maximumDistance) {
    return NextResponse.json({ success: true, accepted: false, reason: "not_close_to_a_venue" });
  }

  const recent = new Date(Date.now() - 8 * 60 * 1000).toISOString();
  const { data: existing } = await db
    .from("venue_live_reports")
    .select("id")
    .eq("venue_id", nearest.venue.id)
    .eq("report_type", "passive_presence")
    .eq("device_id", hash)
    .gte("created_at", recent)
    .limit(1)
    .maybeSingle();

  if (!existing) {
    const { error } = await db.from("venue_live_reports").insert({
      venue_id: nearest.venue.id,
      report_type: "passive_presence",
      report_value: "nearby_app_open",
      venue_category: "anonymous_passive",
      device_id: hash,
    });
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    accepted: true,
    venueId: nearest.venue.id,
    distanceBand: nearest.distance <= 50 ? "very_near" : nearest.distance <= 100 ? "near" : "edge",
    privacy: "Exact location was used only for proximity verification and was not stored.",
  }, { headers: { "Cache-Control": "private, no-store" } });
}
