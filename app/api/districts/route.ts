import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { ACTIVITY_DISTRICTS, distanceMiles } from "../../../src/lib/buzz/districts";

export const dynamic = "force-dynamic";

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const clamp = (value: number) => Math.max(0, Math.min(100, value));
const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const canonical = (value: unknown) => String(value || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim().replace(/^the\s+/, "");

function districtLabel(score: number) {
  if (score >= 84) return "Hot";
  if (score >= 70) return "Heating up";
  if (score >= 54) return "Building";
  return "Calm";
}

function arrivalLabel(value: number) {
  if (value >= 72) return "Heavy arrival pressure";
  if (value >= 48) return "Busy arrivals";
  if (value >= 24) return "Building arrivals";
  return "Normal arrivals";
}

type VenueRow = { id: string; name: string; lat: number | string | null; lng: number | string | null; ai_score?: number | null };
type ScoreRow = { venue_id: string; score: number; label: string; computed_at: string; expires_at: string };
type SignalRow = { venue_id: string; source: string; value: number; is_live: boolean; observed_at: string; expires_at: string };
type EventRow = { id: string; name?: string | null; venue_name?: string | null; start_time?: string | null; end_time?: string | null; source_url?: string | null };

export async function GET() {
  const now = new Date();
  const eventStart = new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString();
  const eventEnd = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

  const [venueResult, scoreResult, signalResult, eventResult] = await Promise.all([
    db.from("venues").select("id,name,lat,lng,ai_score").not("lat", "is", null).not("lng", "is", null).limit(3000),
    db.from("buzz_score_snapshots").select("venue_id,score,label,computed_at,expires_at").gt("expires_at", new Date(now.getTime() - 10 * 60 * 1000).toISOString()).limit(5000),
    db.from("buzz_signal_snapshots").select("venue_id,source,value,is_live,observed_at,expires_at").gt("expires_at", now.toISOString()).limit(5000),
    db.from("events").select("id,name,venue_name,start_time,end_time,source_url").gte("start_time", eventStart).lte("start_time", eventEnd).order("start_time").limit(2500),
  ]);

  if (venueResult.error) return NextResponse.json({ success: false, error: venueResult.error.message }, { status: 500 });

  const venues = ((venueResult.data || []) as VenueRow[]).filter((venue) => Number.isFinite(Number(venue.lat)) && Number.isFinite(Number(venue.lng)));
  const scores = (scoreResult.data || []) as ScoreRow[];
  const signals = (signalResult.data || []) as SignalRow[];
  const events = (eventResult.data || []) as EventRow[];
  const scoreMap = new Map(scores.map((row) => [row.venue_id, row]));
  const eventsByVenue = new Map<string, EventRow[]>();

  for (const event of events) {
    const key = canonical(event.venue_name);
    if (key) eventsByVenue.set(key, [...(eventsByVenue.get(key) || []), event]);
  }

  const districts = ACTIVITY_DISTRICTS.map((district) => {
    const nearby = venues
      .map((venue) => ({ venue, distance: distanceMiles(district.center.lat, district.center.lng, Number(venue.lat), Number(venue.lng)) }))
      .filter((item) => item.distance <= district.radiusMiles)
      .sort((left, right) => Number(scoreMap.get(right.venue.id)?.score || right.venue.ai_score || 35) - Number(scoreMap.get(left.venue.id)?.score || left.venue.ai_score || 35));

    const venueIds = new Set(nearby.map((item) => item.venue.id));
    const topScores = nearby.slice(0, 5).map((item) => Number(scoreMap.get(item.venue.id)?.score || item.venue.ai_score || 35));
    const venueScore = average(topScores);

    const traffic = signals
      .filter((signal) => signal.source === `tomtom:${district.id}`)
      .sort((left, right) => new Date(right.observed_at).getTime() - new Date(left.observed_at).getTime());
    const newestTrafficAt = traffic[0]?.observed_at || null;
    const newestTimestamp = newestTrafficAt ? new Date(newestTrafficAt).getTime() : 0;
    const latestTraffic = traffic.filter((signal) => Math.abs(new Date(signal.observed_at).getTime() - newestTimestamp) < 60_000);
    const arrivalPressure = Math.round(average(latestTraffic.map((signal) => clamp(Number(signal.value)))));

    const liveSignals = signals.filter((signal) => venueIds.has(signal.venue_id) && signal.is_live && !signal.source.startsWith("tomtom:"));
    const liveSources = new Set(liveSignals.map((signal) => signal.source));

    const districtEvents = nearby
      .flatMap(({ venue }) => eventsByVenue.get(canonical(venue.name)) || [])
      .filter((event, index, list) => list.findIndex((candidate) => candidate.id === event.id) === index)
      .sort((left, right) => new Date(left.start_time || 0).getTime() - new Date(right.start_time || 0).getTime());

    const activeEvents = districtEvents.filter((event) => {
      const starts = new Date(event.start_time || 0).getTime();
      const ends = event.end_time ? new Date(event.end_time).getTime() : starts + 3 * 60 * 60 * 1000;
      return starts <= now.getTime() && ends >= now.getTime();
    }).length;
    const soonEvents = districtEvents.filter((event) => {
      const startsIn = new Date(event.start_time || 0).getTime() - now.getTime();
      return startsIn >= 0 && startsIn <= 6 * 60 * 60 * 1000;
    }).length;

    const eventBoost = Math.min(18, activeEvents * 8 + soonEvents * 4 + districtEvents.length);
    const liveBoost = Math.min(18, liveSources.size * 7 + liveSignals.length * 2);
    const mode = liveSignals.length ? "live" : "forecast";
    let score = Math.round(venueScore * 0.55 + arrivalPressure * 0.27 + eventBoost + liveBoost);
    if (mode === "forecast") score = Math.min(score, 82);
    score = clamp(score);

    const topVenues = nearby.slice(0, 4).map(({ venue, distance }) => ({
      id: venue.id,
      name: venue.name,
      score: Math.round(clamp(Number(scoreMap.get(venue.id)?.score || venue.ai_score || 35))),
      distanceMiles: Number(distance.toFixed(2)),
    }));

    const reason = [
      arrivalLabel(arrivalPressure),
      activeEvents ? `${activeEvents} event${activeEvents === 1 ? "" : "s"} happening` : soonEvents ? `${soonEvents} event${soonEvents === 1 ? "" : "s"} starting soon` : `${districtEvents.length} event${districtEvents.length === 1 ? "" : "s"} in the next 24 hours`,
      liveSignals.length ? `${liveSignals.length} direct crowd signal${liveSignals.length === 1 ? "" : "s"}` : "no direct crowd reports yet",
    ].join(" · ");

    return {
      id: district.id,
      name: district.name,
      shortName: district.shortName,
      city: district.city,
      center: district.center,
      radiusMiles: district.radiusMiles,
      accent: district.accent,
      score,
      label: districtLabel(score),
      arrivalPressure,
      arrivalLabel: arrivalLabel(arrivalPressure),
      mode,
      confidence: liveSources.size >= 2 ? "high" : liveSources.size || (newestTrafficAt && districtEvents.length) ? "medium" : "low",
      updatedAt: newestTrafficAt,
      eventCountNext24Hours: districtEvents.length,
      eventsActive: activeEvents,
      eventsStartingSoon: soonEvents,
      nextEvent: districtEvents.find((event) => new Date(event.start_time || 0).getTime() >= now.getTime()) || null,
      venueCount: nearby.length,
      scoredVenueCount: nearby.filter((item) => scoreMap.has(item.venue.id)).length,
      liveSignalCount: liveSignals.length,
      reason,
      topVenues,
    };
  }).sort((left, right) => right.score - left.score || right.arrivalPressure - left.arrivalPressure);

  return NextResponse.json({
    success: true,
    generatedAt: now.toISOString(),
    truthNote: "Road traffic is arrival evidence, not direct foot traffic. A district is Live only when direct crowd evidence exists.",
    summary: {
      districtCount: districts.length,
      activeDistricts: districts.filter((district) => district.score >= 54).length,
      liveDistricts: districts.filter((district) => district.mode === "live").length,
      topDistrict: districts[0] || null,
    },
    districts,
  });
}
