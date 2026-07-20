import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getRequestUser } from "../../../../src/lib/server-auth";
import { recomputeBuzzScore, saveBuzzSignals } from "../../../../src/lib/buzz/repository";
import type { BuzzSignal, VenueForBuzz } from "../../../../src/lib/buzz/types";

export const dynamic = "force-dynamic";

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const allowedLevels = new Set(["quiet", "steady", "busy", "packed"]);

function levelValue(level: string) {
  if (level === "packed") return 95;
  if (level === "busy") return 75;
  if (level === "steady") return 45;
  return 15;
}

function meters(lat1: number, lng1: number, lat2: number, lng2: number) {
  const radians = (value: number) => value * Math.PI / 180;
  const dLat = radians(lat2 - lat1);
  const dLng = radians(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function POST(request: Request) {
  const member = await getRequestUser(request);
  if (!member) return NextResponse.json({ success: false, error: "Sign in to verify live activity" }, { status: 401 });

  const body = await request.json().catch(() => null) as {
    venueId?: string;
    crowdLevel?: string;
    latitude?: number;
    longitude?: number;
    gpsAccuracyMeters?: number;
  } | null;
  const venueId = String(body?.venueId || "");
  const crowdLevel = String(body?.crowdLevel || "").toLowerCase();
  const latitude = Number(body?.latitude);
  const longitude = Number(body?.longitude);
  const accuracy = Math.max(0, Number(body?.gpsAccuracyMeters || 0));

  if (!venueId || !allowedLevels.has(crowdLevel) || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return NextResponse.json({ success: false, error: "Venue, crowd level, and location are required" }, { status: 400 });
  }

  const { data: venue, error: venueError } = await db
    .from("venues")
    .select("id,name,address,city,type,category,ai_score,lat,lng")
    .eq("id", venueId)
    .maybeSingle();
  if (venueError || !venue) return NextResponse.json({ success: false, error: "Venue not found" }, { status: 404 });

  const distance = meters(latitude, longitude, Number(venue.lat), Number(venue.lng));
  const verifiedNearby = accuracy <= 250 && distance <= Math.max(220, Math.min(500, accuracy * 2.2));
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data: duplicate } = await db
    .from("buzz_user_reports")
    .select("id")
    .eq("venue_id", venueId)
    .eq("user_id", member.id)
    .gte("observed_at", tenMinutesAgo)
    .limit(1)
    .maybeSingle();
  if (duplicate) return NextResponse.json({ success: false, error: "You already reported this place recently" }, { status: 429 });

  const observedAt = new Date();
  const expiresAt = new Date(observedAt.getTime() + 45 * 60 * 1000);
  const { error: insertError } = await db.from("buzz_user_reports").insert({
    venue_id: venueId,
    user_id: member.id,
    crowd_level: crowdLevel,
    reported_lat: latitude,
    reported_lng: longitude,
    distance_meters: Number(distance.toFixed(1)),
    gps_accuracy_meters: accuracy,
    verified_nearby: verifiedNearby,
    observed_at: observedAt.toISOString(),
    expires_at: expiresAt.toISOString(),
  });
  if (insertError) return NextResponse.json({ success: false, error: insertError.message }, { status: 500 });

  if (!verifiedNearby) {
    return NextResponse.json({ success: true, accepted: true, verifiedNearby: false, distanceMeters: Math.round(distance), message: "Saved, but not used in Buzz because the location could not be verified nearby." });
  }

  const since = new Date(Date.now() - 45 * 60 * 1000).toISOString();
  const { data: reports, error: reportError } = await db
    .from("buzz_user_reports")
    .select("user_id,crowd_level,observed_at,expires_at")
    .eq("venue_id", venueId)
    .eq("verified_nearby", true)
    .gte("observed_at", since)
    .order("observed_at", { ascending: false })
    .limit(100);
  if (reportError) return NextResponse.json({ success: false, error: reportError.message }, { status: 500 });

  const identities = new Set((reports || []).map(report => report.user_id).filter(Boolean));
  const values = (reports || []).map(report => levelValue(report.crowd_level));
  const average = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / Math.max(1, values.length);
  const consensus = Math.max(0.35, Math.min(1, 1 - Math.sqrt(variance) / 100));
  const latest = reports?.[0] || { observed_at: observedAt.toISOString(), expires_at: expiresAt.toISOString() };
  const signals: BuzzSignal[] = [{
    source: "lit757_users",
    family: "verified_users",
    type: "verified_presence",
    value: identities.size,
    isLive: true,
    confidence: Math.min(0.9, 0.45 + identities.size * 0.1),
    observedAt: latest.observed_at,
    expiresAt: latest.expires_at,
    metadata: { uniqueDevices: identities.size, reportCount: reports?.length || 1 },
  }];
  if ((reports?.length || 0) >= 2) signals.push({
    source: "lit757_users",
    family: "verified_users",
    type: "crowd_report",
    value: average,
    isLive: true,
    confidence: Math.min(0.9, consensus * (0.55 + Math.min(0.35, (reports?.length || 0) * 0.05))),
    observedAt: latest.observed_at,
    expiresAt: latest.expires_at,
    metadata: { consensus, reportCount: reports?.length || 0 },
  });

  await saveBuzzSignals(db, venueId, signals);
  const score = await recomputeBuzzScore(db, venue as VenueForBuzz);
  return NextResponse.json({ success: true, accepted: true, verifiedNearby: true, distanceMeters: Math.round(distance), reportCount: reports?.length || 1, buzz: score });
}
