import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { ACTIVITY_DISTRICTS, distanceMiles, nearestActivityDistrict } from "../../../src/lib/buzz/districts";
import { dedupeVenueRows } from "../../../src/lib/venue-dedupe";
import { districtActivityLabel, districtTruthMode } from "../../../src/lib/buzz/truth-labels";
import {
  DIRECT_PRESENCE_WINDOW_MINUTES,
  groupDirectPresence,
  presenceMeetsLiveThreshold,
  type DirectPresenceRow,
} from "../../../src/lib/buzz/direct-presence";

export const dynamic = "force-dynamic";

const db = getSupabaseAdmin();

const clamp = (value: number) => Math.max(0, Math.min(100, value));
const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const canonical = (value: unknown) => String(value || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim().replace(/^the\s+/, "");

function arrivalLabel(value: number) {
  if (value >= 72) return "Heavy arrival pressure";
  if (value >= 48) return "Busy arrivals";
  if (value >= 24) return "Building arrivals";
  return "Normal arrivals";
}

type VenueRow = { id: string; name: string; city?: string | null; address?: string | null; lat: number | string | null; lng: number | string | null; ai_score?: number | null };
type ScoreRow = { venue_id: string; score: number; label: string; score_mode: "live" | "forecast"; computed_at: string; expires_at: string };
type SignalRow = { venue_id: string; source: string; value: number; is_live: boolean; observed_at: string; expires_at: string };
type EventRow = { id: string; name?: string | null; venue_name?: string | null; start_time?: string | null; end_time?: string | null; source_url?: string | null };

export async function GET() {
  const now = new Date();
  const eventStart = new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString();
  const eventEnd = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  const presenceStart = new Date(now.getTime() - DIRECT_PRESENCE_WINDOW_MINUTES * 60_000).toISOString();

  const [venueResult, scoreResult, signalResult, eventResult, presenceResult] = await Promise.all([
    db.from("venues").select("id,name,city,address,lat,lng,ai_score").not("lat", "is", null).not("lng", "is", null).limit(3000),
    db.from("buzz_score_snapshots").select("venue_id,score,label,score_mode,computed_at,expires_at").gt("expires_at", now.toISOString()).limit(5000),
    db.from("buzz_signal_snapshots").select("venue_id,source,value,is_live,observed_at,expires_at").gt("expires_at", now.toISOString()).limit(5000),
    db.from("events").select("id,name,venue_name,start_time,end_time,source_url").gte("start_time", eventStart).lte("start_time", eventEnd).order("start_time").limit(2500),
    db.from("venue_live_reports").select("venue_id,device_id,report_type,created_at").in("report_type", ["nearby_presence", "passive_presence"]).gte("created_at", presenceStart).order("created_at", { ascending: false }).limit(5000),
  ]);

  if (venueResult.error) return NextResponse.json({ success: false, error: venueResult.error.message }, { status: 500 });
  if (presenceResult.error) console.error("District direct presence unavailable", presenceResult.error.message);

  const venueIdentity = dedupeVenueRows(((venueResult.data || []) as VenueRow[])
    .filter((venue) => Number.isFinite(Number(venue.lat)) && Number.isFinite(Number(venue.lng))));
  const venues = venueIdentity.venues;
  const primaryVenueIdBySourceId = venueIdentity.primaryVenueIdBySourceId;
  const scores = (scoreResult.data || []) as ScoreRow[];
  const signals = (signalResult.data || []) as SignalRow[];
  const events = (eventResult.data || []) as EventRow[];
  const groupedPresence = groupDirectPresence((presenceResult.data || []) as DirectPresenceRow[], now).byVenue;
  const presenceByVenue = new Map<string, { passive: Set<string>; verified: Set<string> }>();
  for (const [sourceVenueId, group] of groupedPresence) {
    const venueId = primaryVenueIdBySourceId.get(sourceVenueId) || sourceVenueId;
    const current = presenceByVenue.get(venueId) || { passive: new Set<string>(), verified: new Set<string>() };
    for (const deviceId of group.passive) current.passive.add(deviceId);
    for (const deviceId of group.verified) current.verified.add(deviceId);
    presenceByVenue.set(venueId, current);
  }
  const scoreMap = new Map<string, ScoreRow>();
  for (const row of scores) {
    const venueId = primaryVenueIdBySourceId.get(row.venue_id) || row.venue_id;
    const current = scoreMap.get(venueId);
    if (!current || new Date(row.computed_at).getTime() > new Date(current.computed_at).getTime()) {
      scoreMap.set(venueId, { ...row, venue_id: venueId });
    }
  }
  const eventsByVenue = new Map<string, EventRow[]>();

  for (const event of events) {
    const key = canonical(event.venue_name);
    if (key) eventsByVenue.set(key, [...(eventsByVenue.get(key) || []), event]);
  }

  const districtIdByVenueId = new Map(venues.map(venue => [
    venue.id,
    nearestActivityDistrict(Number(venue.lat), Number(venue.lng), venue.city)?.id || null,
  ]));

  const districts = ACTIVITY_DISTRICTS.map((district) => {
    const nearby = venues
      .filter(venue => districtIdByVenueId.get(venue.id) === district.id)
      .map((venue) => ({ venue, distance: distanceMiles(district.center.lat, district.center.lng, Number(venue.lat), Number(venue.lng)) }))
      .sort((left, right) => Number(scoreMap.get(right.venue.id)?.score || right.venue.ai_score || 35) - Number(scoreMap.get(left.venue.id)?.score || left.venue.ai_score || 35));

    const topScores = nearby.slice(0, 5).map((item) => Number(scoreMap.get(item.venue.id)?.score || item.venue.ai_score || 35));
    const venueScore = average(topScores);

    const traffic = signals
      .filter((signal) => signal.source === `tomtom:${district.id}`)
      .sort((left, right) => new Date(right.observed_at).getTime() - new Date(left.observed_at).getTime());
    const newestTrafficAt = traffic[0]?.observed_at || null;
    const newestTimestamp = newestTrafficAt ? new Date(newestTrafficAt).getTime() : 0;
    const latestTraffic = traffic.filter((signal) => Math.abs(new Date(signal.observed_at).getTime() - newestTimestamp) < 60_000);
    const arrivalPressure = Math.round(average(latestTraffic.map((signal) => clamp(Number(signal.value)))));

    const liveSnapshotVenueIds = new Set(nearby
      .map(item => item.venue.id)
      .filter(venueId => scoreMap.get(venueId)?.score_mode === "live"));
    const directPresenceVenueIds = new Set(nearby
      .map(item => item.venue.id)
      .filter(venueId => {
        const group = presenceByVenue.get(venueId);
        return Boolean(group && presenceMeetsLiveThreshold({
          passiveDevices: group.passive.size,
          verifiedDevices: group.verified.size,
        }));
      }));
    const liveVenueIds = new Set([...liveSnapshotVenueIds, ...directPresenceVenueIds]);
    const liveSignals = signals.filter((signal) => {
      const venueId = primaryVenueIdBySourceId.get(signal.venue_id) || signal.venue_id;
      return liveVenueIds.has(venueId) && signal.is_live && !signal.source.startsWith("tomtom:");
    });
    const liveSources = new Set(liveSignals.map((signal) => signal.source));
    if (directPresenceVenueIds.size) liveSources.add("direct_presence");

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
    const liveBoost = Math.min(18, liveSources.size * 7 + liveSignals.length * 2 + directPresenceVenueIds.size * 3);
    const mode = districtTruthMode([
      ...[...liveSnapshotVenueIds].map(venueId => scoreMap.get(venueId)?.score_mode),
      ...[...directPresenceVenueIds].map(() => "live"),
    ]);
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
      liveVenueIds.size ? `${liveVenueIds.size} venue${liveVenueIds.size === 1 ? "" : "s"} with direct Live evidence` : "no direct crowd evidence yet",
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
      label: districtActivityLabel(score, mode),
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
      liveSignalCount: liveSignals.length + directPresenceVenueIds.size,
      liveVenueCount: liveVenueIds.size,
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
