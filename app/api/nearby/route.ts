import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getVenueImage } from "../../../src/lib/venue-image";
import { ACTIVITY_DISTRICTS, distanceMiles, type ActivityDistrict } from "../../../src/lib/buzz/districts";

export const dynamic = "force-dynamic";

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type Bounds = { west: number; south: number; east: number; north: number };
type VenueRow = Record<string, unknown> & { id: string; name: string; lat?: number; lng?: number };
type EventRow = {
  id: string;
  name?: string | null;
  venue_name?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  ticket_status?: string | null;
  source_url?: string | null;
};
type EventMappingRow = { event_id: string; venue_id?: string | null };
type PresenceRow = { venue_id?: string | null; device_id?: string | null };
type TrafficRow = { source: string; value: number; observed_at: string; expires_at: string };
type ScoreFactor = { source?: string; label?: string; points?: number };
type ScoreRow = {
  venue_id: string;
  score: number;
  label: string;
  score_mode: "live" | "forecast";
  confidence: "low" | "medium" | "high";
  version: string;
  computed_at: string;
  expires_at: string;
  evidence_age_minutes?: number | null;
  source_families?: string[] | null;
  explanation?: string | null;
  factors?: unknown;
};

type DistrictEventStats = {
  active: number;
  soon: number;
  total: number;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const normalize = (value: unknown) => String(value || "").toLowerCase().normalize("NFKD").replace(/\p{Diacritic}/gu, "").replace(/&/g, " and ").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
const canonical = (value: unknown) => normalize(value).replace(/^the\s+/, "");
const numberParam = (value: string | null) => value !== null && Number.isFinite(Number(value)) ? Number(value) : null;

function parseBounds(value: string | null): Bounds | null {
  if (!value) return null;
  const [west, south, east, north] = value.split(",").map(Number);
  return [west, south, east, north].every(Number.isFinite) && south < north ? { west, south, east, north } : null;
}

function inside(lat: number, lng: number, bounds: Bounds) {
  const longitude = bounds.west <= bounds.east ? lng >= bounds.west && lng <= bounds.east : lng >= bounds.west || lng <= bounds.east;
  return longitude && lat >= bounds.south && lat <= bounds.north;
}

function hoursFromNow(value?: string | null) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? (timestamp - Date.now()) / 3_600_000 : null;
}

function kindFor(text: string) {
  if (/restaurant|food|diner|cafe|pizza|grill|kitchen|taco|burger|bakery|seafood|brunch/.test(text)) return "food";
  if (/bar|brew|cocktail|wine|pub|club|dj|nightlife|lounge|music/.test(text)) return "nightlife";
  if (/park|trail|beach|garden|outdoor|museum|shopping|mall|market|arcade|bowling|golf|zoo|aquarium|theater|theatre|comedy/.test(text)) return "activity";
  return "other";
}

function categoryMatch(category: string, kind: string, text: string, hasEvent: boolean) {
  if (!category || category === "all") return true;
  if (category === "events") return hasEvent;
  if (category === "drinks") return kind === "nightlife";
  if (category === "outdoors" || category === "shopping" || category === "explore") return kind === "activity";
  return kind === category || text.includes(category);
}

function ticketSignal(status?: string | null) {
  const value = normalize(status);
  if (!value) return { points: 0, strength: "none" as const };
  if (/sold out|not available|no tickets|unavailable/.test(value)) return { points: 16, strength: "strong" as const };
  if (/limited|low|few|selling fast/.test(value)) return { points: 11, strength: "strong" as const };
  if (/available|on sale/.test(value)) return { points: 2, strength: "weak" as const };
  return { points: 0, strength: "none" as const };
}

function eventSignal(event: EventRow | null) {
  if (!event) return { points: 0, active: false, soon: false, hours: null as number | null };
  const startHours = hoursFromNow(event.start_time);
  const endHours = hoursFromNow(event.end_time);
  const active = startHours !== null && startHours <= 0.75 && (endHours === null ? startHours >= -3 : endHours >= 0);
  if (active) return { points: 18, active: true, soon: false, hours: startHours };
  if (startHours === null || startHours < -3) return { points: 0, active: false, soon: false, hours: startHours };
  if (startHours <= 2) return { points: 14, active: false, soon: true, hours: startHours };
  if (startHours <= 6) return { points: 8, active: false, soon: true, hours: startHours };
  if (startHours <= 24) return { points: 3, active: false, soon: false, hours: startHours };
  return { points: 0, active: false, soon: false, hours: startHours };
}

function localClock(reference: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    hour12: false,
  }).formatToParts(reference);
  const weekday = parts.find((part) => part.type === "weekday")?.value || "Mon";
  const hour = Number(parts.find((part) => part.type === "hour")?.value || 0) % 24;
  return { weekday, hour };
}

function expectedPeak(kind: string, reference: Date) {
  const { weekday, hour } = localClock(reference);
  const weekend = weekday === "Fri" || weekday === "Sat";
  const sunday = weekday === "Sun";

  if (kind === "nightlife") {
    if (weekend && (hour >= 20 || hour < 2)) return { points: 11, label: "Usually a peak nightlife time" };
    if ((weekday === "Thu" || sunday) && hour >= 19 && hour < 24) return { points: 7, label: "Usually a busy nightlife time" };
    if (hour >= 19 && hour < 24) return { points: 4, label: "Nightlife activity normally builds now" };
  }

  if (kind === "food") {
    if ((hour >= 11 && hour < 14) || (hour >= 17 && hour < 21)) return { points: 8, label: "Usually a peak dining time" };
    if ((weekend || sunday) && hour >= 9 && hour < 14) return { points: 6, label: "Usually a busy brunch time" };
  }

  if (kind === "activity" && hour >= 10 && hour < 20) {
    return { points: weekend || sunday ? 5 : 3, label: "Usually an active time for this place" };
  }

  return { points: 0, label: null as string | null };
}

function nearestDistrict(lat: number, lng: number): ActivityDistrict | null {
  let match: { district: ActivityDistrict; distance: number } | null = null;
  for (const district of ACTIVITY_DISTRICTS) {
    const distance = distanceMiles(district.center.lat, district.center.lng, lat, lng);
    if (distance > district.radiusMiles) continue;
    if (!match || distance < match.distance) match = { district, distance };
  }
  return match?.district || null;
}

function districtStatus(traffic: number, stats: DistrictEventStats) {
  if (traffic >= 65 && (stats.active > 0 || stats.soon > 1)) return "Hot";
  if (traffic >= 40 || stats.active > 1) return "Busy";
  if (traffic >= 20 || stats.soon > 0) return "Building";
  return "Calm";
}

function mobilityPoints(factors: unknown) {
  if (!Array.isArray(factors)) return 0;
  return factors.reduce((sum, factor) => {
    const row = factor as ScoreFactor;
    return String(row.source || "").startsWith("tomtom:") ? sum + Math.max(0, Number(row.points || 0)) : sum;
  }, 0);
}

function addVenueEvent(map: Map<string, EventRow[]>, venueId: string, event: EventRow) {
  const current = map.get(venueId) || [];
  if (!current.some((candidate) => candidate.id === event.id)) map.set(venueId, [...current, event]);
}

function chooseEvent(events: EventRow[]) {
  return [...events].sort((left, right) => {
    const leftHours = Math.abs(hoursFromNow(left.start_time) ?? 9999);
    const rightHours = Math.abs(hoursFromNow(right.start_time) ?? 9999);
    return leftHours - rightHours;
  })[0] || null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const lat = numberParam(url.searchParams.get("lat"));
  const lng = numberParam(url.searchParams.get("lng"));
  const radius = clamp(numberParam(url.searchParams.get("radius")) || 3, 0.25, 50);
  const bounds = parseBounds(url.searchParams.get("bounds"));
  const query = normalize(url.searchParams.get("q"));
  const category = normalize(url.searchParams.get("category"));
  const limit = clamp(Math.round(numberParam(url.searchParams.get("limit")) || 220), 1, 400);
  const now = new Date();
  const eventStart = new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString();
  const eventEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const presenceStart = new Date(now.getTime() - 45 * 60 * 1000).toISOString();

  const [venueResult, eventResult, mappingResult, presenceResult, scoreResult, trafficResult] = await Promise.all([
    db.from("venues").select("id,name,city,address,lat,lng,type,category,ai_score,ai_summary,google_rating,google_place_id,photo_source,phone,website,hours,enriched_at").limit(2500),
    db.from("events").select("id,name,venue_name,start_time,end_time,ticket_status,source_url").gte("start_time", eventStart).lte("start_time", eventEnd).order("start_time").limit(1800),
    db.from("buzz_provider_events").select("event_id,venue_id").not("venue_id", "is", null).limit(4000),
    db.from("venue_live_reports").select("venue_id,device_id").eq("report_type", "nearby_presence").gte("created_at", presenceStart).limit(3000),
    db.from("buzz_score_snapshots").select("venue_id,score,label,score_mode,confidence,version,computed_at,expires_at,evidence_age_minutes,source_families,explanation,factors").gt("expires_at", new Date(now.getTime() - 10 * 60 * 1000).toISOString()).limit(3000),
    db.from("buzz_signal_snapshots").select("source,value,observed_at,expires_at").like("source", "tomtom:%").gt("expires_at", now.toISOString()).order("observed_at", { ascending: false }).limit(1000),
  ]);

  if (venueResult.error) return NextResponse.json({ success: false, error: venueResult.error.message }, { status: 500 });
  if (eventResult.error) console.error("Event signals unavailable", eventResult.error.message);
  if (mappingResult.error) console.error("Event mappings unavailable", mappingResult.error.message);
  if (presenceResult.error) console.error("Live presence signals unavailable", presenceResult.error.message);
  if (scoreResult.error) console.error("Buzz snapshots unavailable; using fallback scoring", scoreResult.error.message);
  if (trafficResult.error) console.error("TomTom area signals unavailable", trafficResult.error.message);

  const venueRows = (venueResult.data || []) as VenueRow[];
  const eventRows = (eventResult.data || []) as EventRow[];
  const eventsById = new Map(eventRows.map((event) => [event.id, event]));
  const venueByCanonical = new Map(venueRows.map((venue) => [canonical(venue.name), venue.id]));
  const eventsByVenueId = new Map<string, EventRow[]>();

  for (const mapping of (mappingResult.data || []) as EventMappingRow[]) {
    if (!mapping.venue_id) continue;
    const event = eventsById.get(mapping.event_id);
    if (event) addVenueEvent(eventsByVenueId, mapping.venue_id, event);
  }

  for (const event of eventRows) {
    const venueId = venueByCanonical.get(canonical(event.venue_name));
    if (venueId) addVenueEvent(eventsByVenueId, venueId, event);
  }

  const presence = new Map<string, Set<string>>();
  for (const report of (presenceResult.data || []) as PresenceRow[]) {
    if (!report.venue_id || !report.device_id) continue;
    const devices = presence.get(report.venue_id) || new Set<string>();
    devices.add(report.device_id);
    presence.set(report.venue_id, devices);
  }

  const scoreMap = new Map<string, ScoreRow>();
  for (const snapshot of (scoreResult.data || []) as ScoreRow[]) scoreMap.set(snapshot.venue_id, snapshot);

  const trafficByDistrict = new Map<string, TrafficRow>();
  for (const signal of (trafficResult.data || []) as TrafficRow[]) {
    const districtId = signal.source.replace(/^tomtom:/, "");
    if (!trafficByDistrict.has(districtId)) trafficByDistrict.set(districtId, signal);
  }

  const districtByVenueId = new Map<string, ActivityDistrict>();
  for (const venue of venueRows) {
    const venueLat = Number(venue.lat);
    const venueLng = Number(venue.lng);
    if (!Number.isFinite(venueLat) || !Number.isFinite(venueLng)) continue;
    const district = nearestDistrict(venueLat, venueLng);
    if (district) districtByVenueId.set(venue.id, district);
  }

  const districtEvents = new Map<string, DistrictEventStats>();
  for (const [venueId, venueEvents] of eventsByVenueId) {
    const district = districtByVenueId.get(venueId);
    if (!district) continue;
    const stats = districtEvents.get(district.id) || { active: 0, soon: 0, total: 0 };
    for (const event of venueEvents) {
      const evidence = eventSignal(event);
      stats.total += 1;
      if (evidence.active) stats.active += 1;
      else if (evidence.soon) stats.soon += 1;
    }
    districtEvents.set(district.id, stats);
  }

  const ranked = venueRows.flatMap((venue) => {
    const venueLat = Number(venue.lat);
    const venueLng = Number(venue.lng);
    if (!Number.isFinite(venueLat) || !Number.isFinite(venueLng) || (!venueLat && !venueLng)) return [];
    if (bounds && !inside(venueLat, venueLng, bounds)) return [];
    const distance = lat !== null && lng !== null ? distanceMiles(lat, lng, venueLat, venueLng) : null;
    if (!bounds && distance !== null && distance > radius) return [];

    const event = chooseEvent(eventsByVenueId.get(venue.id) || []);
    const text = normalize(`${venue.name} ${venue.city} ${venue.address} ${venue.type} ${venue.category} ${venue.ai_summary} ${event?.name}`);
    const baseKind = kindFor(text);
    const kind = event ? "events" : baseKind;
    if (!categoryMatch(category, baseKind, text, Boolean(event))) return [];
    if (query && !query.split(" ").every((term) => text.includes(term))) return [];

    const livePresenceCount = presence.get(venue.id)?.size || 0;
    const livePresencePoints = Math.min(35, livePresenceCount * 10);
    const expectedPrior = 30 + clamp(Number(venue.ai_score || 45), 0, 100) * 0.35;
    const eventEvidence = eventSignal(event);
    const ticketEvidence = ticketSignal(event?.ticket_status);
    const peakEvidence = expectedPeak(baseKind, now);
    const district = districtByVenueId.get(venue.id) || null;
    const districtTraffic = district ? clamp(Number(trafficByDistrict.get(district.id)?.value || 0), 0, 100) : 0;
    const districtEventStats = district ? (districtEvents.get(district.id) || { active: 0, soon: 0, total: 0 }) : { active: 0, soon: 0, total: 0 };
    const areaTrafficPoints = Math.round(districtTraffic * 0.1);
    const areaEventPoints = Math.min(8, districtEventStats.active * 4 + districtEventStats.soon * 2);

    const snapshot = scoreMap.get(venue.id);
    const snapshotWithoutCopiedTraffic = snapshot ? Math.max(0, Number(snapshot.score) - mobilityPoints(snapshot.factors)) : null;
    const baseScore = snapshotWithoutCopiedTraffic ?? Math.round(expectedPrior + livePresencePoints);
    let buzzScore = Math.round(baseScore + eventEvidence.points + ticketEvidence.points + peakEvidence.points + areaTrafficPoints + areaEventPoints);

    const live = snapshot?.score_mode === "live" || livePresenceCount > 0;
    if (!live) {
      const supportedForecast = eventEvidence.active || eventEvidence.soon || districtTraffic >= 20 || peakEvidence.points >= 6 || districtEventStats.active > 0;
      buzzScore = Math.min(buzzScore, supportedForecast ? 84 : 74);
    }
    buzzScore = clamp(buzzScore, 0, 100);

    const evidenceCount = [
      eventEvidence.points > 0,
      ticketEvidence.points > 0,
      peakEvidence.points > 0,
      areaTrafficPoints > 0,
      areaEventPoints > 0,
    ].filter(Boolean).length;

    const confidence = live
      ? snapshot?.confidence || (livePresenceCount >= 3 ? "high" : "medium")
      : evidenceCount >= 2 ? "medium" : "low";
    const scoreMode = live ? "live" : "forecast";

    const explanationParts: string[] = [];
    if (livePresenceCount >= 2) explanationParts.push(`${livePresenceCount} verified people nearby`);
    else if (livePresenceCount === 1) explanationParts.push("Verified person nearby");
    if (eventEvidence.active) explanationParts.push(`${event?.name || "Event"} happening now`);
    else if (eventEvidence.soon) explanationParts.push(`${event?.name || "Event"} starts soon`);
    if (district && districtTraffic >= 40) explanationParts.push(`${district.shortName} traffic is elevated`);
    else if (district && districtTraffic >= 20) explanationParts.push(`${district.shortName} traffic is building`);
    if (!eventEvidence.active && districtEventStats.active > 0) explanationParts.push(`${districtEventStats.active} nearby event${districtEventStats.active === 1 ? "" : "s"} happening`);
    if (peakEvidence.label) explanationParts.push(peakEvidence.label);
    const trendLabel = explanationParts.slice(0, 3).join(" · ") || "No strong activity signal yet";

    const photoUrl = getVenueImage({
      name: venue.name,
      kind,
      category: venue.category,
      type: venue.type,
      googlePlaceId: venue.google_place_id,
      lat: venueLat,
      lng: venueLng,
    });

    return [{
      id: venue.id,
      name: venue.name,
      city: String(venue.city || "Nearby"),
      address: venue.address || null,
      lat: venueLat,
      lng: venueLng,
      type: String(venue.type || venue.category || "Local spot"),
      category: String(venue.category || venue.type || "Local spot"),
      kind,
      photoUrl,
      reason: trendLabel,
      openNow: null,
      phone: venue.phone || null,
      website: venue.website || null,
      score: buzzScore,
      distanceMiles: distance === null ? null : Number(distance.toFixed(2)),
      area: district ? {
        id: district.id,
        name: district.name,
        shortName: district.shortName,
        status: districtStatus(districtTraffic, districtEventStats),
        traffic: Math.round(districtTraffic),
        eventsActive: districtEventStats.active,
        eventsSoon: districtEventStats.soon,
      } : null,
      activity: {
        score: buzzScore,
        label: buzzScore >= 88 ? "On Fire" : buzzScore >= 76 ? "Heating Up" : buzzScore >= 60 ? "Active" : "Chill",
        trendLabel,
        confidence,
        scoreMode,
        updatedAt: snapshot?.computed_at || now.toISOString(),
        expiresAt: snapshot?.expires_at || null,
        evidenceAgeMinutes: snapshot?.evidence_age_minutes ?? null,
        scoreVersion: "buzz-v1.1-area-context",
        sourceFamilies: [...new Set([
          ...(snapshot?.source_families || []),
          ...(district ? ["mobility"] : []),
          ...(event ? ["event"] : []),
          ...(peakEvidence.points ? ["expected_peak"] : []),
        ])],
        explanation: trendLabel,
        factors: {
          baseScore,
          livePresencePoints,
          eventPoints: eventEvidence.points,
          ticketPoints: ticketEvidence.points,
          expectedPeakPoints: peakEvidence.points,
          areaTrafficPoints,
          areaEventPoints,
          districtTraffic: Math.round(districtTraffic),
        },
      },
      event: event ? {
        id: event.id,
        name: event.name || "Event",
        startTime: event.start_time || null,
        sourceUrl: event.source_url || null,
        ticketStatus: event.ticket_status || null,
      } : null,
    }];
  }).sort((left, right) => right.score - left.score || (left.distanceMiles ?? 999) - (right.distanceMiles ?? 999));

  const venues = ranked.slice(0, limit);
  const scope = bounds
    ? { type: "bounds", label: "this map area", bounds }
    : lat !== null && lng !== null
      ? { type: "radius", label: `within ${radius} mile${radius === 1 ? "" : "s"}`, center: { latitude: lat, longitude: lng }, radius }
      : query
        ? { type: "search", label: `matching ${url.searchParams.get("q") || ""}` }
        : { type: "market", label: "available things to do" };

  return NextResponse.json({
    success: true,
    generatedAt: now.toISOString(),
    scoreVersion: "buzz-v1.1-area-context",
    scoreNotice: "Buzz automatically combines area traffic, event timing, expected peak hours, and direct evidence. Traffic and forecasts never claim a venue is live by themselves.",
    scope,
    resultCount: ranked.length,
    picks: venues.slice(0, 40),
    venues,
  }, { headers: { "Cache-Control": "private, no-store" } });
}
