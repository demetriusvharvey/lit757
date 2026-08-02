import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { getVenueImage } from "../../../src/lib/venue-image";
import { distanceMiles, nearestActivityDistrict, type ActivityDistrict } from "../../../src/lib/buzz/districts";
import {
  DIRECT_PRESENCE_WINDOW_MINUTES,
  groupDirectPresence,
  type DirectPresenceRow,
} from "../../../src/lib/buzz/direct-presence";
import { clamp, openHoursAdjustment, passivePresenceEvidence, trafficEvidence } from "../../../src/lib/buzz/forecast-v2";
import {
  loadPublicActivityContext,
  transitEvidenceForDistrict,
  weatherEvidenceForVenue,
  type SupportingEvidence,
} from "../../../src/lib/integrations/public-context";
import { dedupeVenueRows } from "../../../src/lib/venue-dedupe";
import { activityStatusLabel } from "../../../src/lib/buzz/truth-labels";
import { venueKinds, type VenueKind } from "../../../src/lib/venue-kind";

export const dynamic = "force-dynamic";

const db = getSupabaseAdmin();

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
type TrafficRow = {
  source: string;
  value: number;
  observed_at: string;
  expires_at: string;
  metadata?: Record<string, unknown> | null;
};
type ScoreFactor = { family?: string; source?: string; label?: string; points?: number };
type Confidence = "low" | "medium" | "high";
type ScoreRow = {
  venue_id: string;
  score: number;
  label: string;
  score_mode: "live" | "forecast";
  confidence: Confidence;
  version: string;
  computed_at: string;
  expires_at: string;
  evidence_age_minutes?: number | null;
  source_families?: string[] | null;
  explanation?: string | null;
  factors?: unknown;
};
type DistrictEventStats = { active: number; soon: number; total: number };

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

function hoursFromNow(value?: string | null, reference = Date.now()) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? (timestamp - reference) / 3_600_000 : null;
}

function outdoorVenue(text: string) {
  return /park|trail|beach|garden|outdoor|boardwalk|golf|zoo|festival|amphitheater|amphitheatre/.test(text);
}

function categoryMatch(category: string, kinds: VenueKind[], text: string, hasEvent: boolean) {
  if (!category || category === "all") return true;
  if (category === "events") return hasEvent;
  if (category === "drinks") return kinds.includes("nightlife");
  if (category === "outdoors" || category === "shopping" || category === "explore") return kinds.includes("activity");
  return kinds.includes(category as VenueKind) || text.includes(category);
}

function ticketSignal(status?: string | null) {
  const value = normalize(status);
  if (!value) return { points: 0, strength: "none" as const, label: null as string | null };
  if (/sold out|not available|no tickets|unavailable/.test(value)) return { points: 15, strength: "strong" as const, label: "Ticket demand is extremely high" };
  if (/limited|low|few|selling fast/.test(value)) return { points: 10, strength: "strong" as const, label: "Tickets are becoming scarce" };
  if (/available|on sale/.test(value)) return { points: 2, strength: "weak" as const, label: null as string | null };
  return { points: 0, strength: "none" as const, label: null as string | null };
}

function eventSignal(event: EventRow | null, reference: Date) {
  if (!event) return { points: 0, active: false, soon: false, hours: null as number | null, phase: "none" as const };
  const now = reference.getTime();
  const startHours = hoursFromNow(event.start_time, now);
  const endHours = hoursFromNow(event.end_time, now);
  if (startHours === null) return { points: 0, active: false, soon: false, hours: null, phase: "none" as const };

  const hasNotEnded = endHours === null ? startHours >= -3.5 : endHours >= 0;
  if (startHours <= 0.5 && startHours >= -0.75 && hasNotEnded) {
    return { points: 20, active: true, soon: false, hours: startHours, phase: "arrival_or_start" as const };
  }
  if (startHours < -0.75 && hasNotEnded) {
    return { points: startHours >= -2.5 ? 17 : 11, active: true, soon: false, hours: startHours, phase: "happening" as const };
  }
  if (startHours > 0.5 && startHours <= 1.5) return { points: 15, active: false, soon: true, hours: startHours, phase: "soon" as const };
  if (startHours <= 4) return { points: 9, active: false, soon: true, hours: startHours, phase: "later_today" as const };
  if (startHours <= 24) return { points: 3, active: false, soon: false, hours: startHours, phase: "today" as const };
  return { points: 0, active: false, soon: false, hours: startHours, phase: "future" as const };
}

function localClock(reference: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    hour12: false,
  }).formatToParts(reference);
  const weekday = parts.find(part => part.type === "weekday")?.value || "Mon";
  const hour = Number(parts.find(part => part.type === "hour")?.value || 0) % 24;
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
  if (kind === "activity" && hour >= 10 && hour < 20) return { points: weekend || sunday ? 5 : 3, label: "Usually an active time for this place" };
  return { points: 0, label: null as string | null };
}

function districtStatus(mobilityPoints: number, stats: DistrictEventStats, nearbyPhones: number) {
  if (nearbyPhones >= 5 || (mobilityPoints >= 9 && (stats.active > 0 || stats.soon > 1))) return "Hot";
  if (nearbyPhones >= 3 || mobilityPoints >= 6 || stats.active > 1) return "Busy";
  if (mobilityPoints >= 3 || stats.soon > 0) return "Building";
  return "Calm";
}

function snapshotSupportPoints(factors: unknown) {
  if (!Array.isArray(factors)) return 0;
  const allowed = new Set(["foot_traffic", "verified_users", "first_party_occupancy", "commercial_demand"]);
  return Math.min(48, factors.reduce((sum, factor) => {
    const row = factor as ScoreFactor;
    return allowed.has(String(row.family || "")) ? sum + Math.max(0, Number(row.points || 0)) : sum;
  }, 0));
}

function addVenueEvent(map: Map<string, EventRow[]>, venueId: string, event: EventRow) {
  const current = map.get(venueId) || [];
  if (!current.some(candidate => candidate.id === event.id)) map.set(venueId, [...current, event]);
}

function chooseEvent(events: EventRow[], reference: Date) {
  return [...events].sort((left, right) => {
    const leftHours = Math.abs(hoursFromNow(left.start_time, reference.getTime()) ?? 9999);
    const rightHours = Math.abs(hoursFromNow(right.start_time, reference.getTime()) ?? 9999);
    return leftHours - rightHours;
  })[0] || null;
}

function neutralEvidence(): SupportingEvidence {
  return { available: false, points: 0, cap: null, label: null, confidencePenalty: false, metadata: {} };
}

function lowerConfidence(confidence: Confidence): Confidence {
  return confidence === "high" ? "medium" : "low";
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
  const eventStart = new Date(now.getTime() - 4 * 60 * 60 * 1000).toISOString();
  const eventEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const presenceStart = new Date(now.getTime() - DIRECT_PRESENCE_WINDOW_MINUTES * 60_000).toISOString();

  const [venueResult, eventResult, mappingResult, presenceResult, scoreResult, trafficResult, publicContext] = await Promise.all([
    db.from("venues").select("id,name,city,address,lat,lng,type,category,ai_score,ai_summary,google_rating,google_place_id,photo_source,phone,website,hours,enriched_at").limit(2500),
    db.from("events").select("id,name,venue_name,start_time,end_time,ticket_status,source_url").gte("start_time", eventStart).lte("start_time", eventEnd).order("start_time").limit(1800),
    db.from("buzz_provider_events").select("event_id,venue_id").not("venue_id", "is", null).limit(4000),
    db.from("venue_live_reports").select("venue_id,device_id,report_type,created_at").in("report_type", ["nearby_presence", "passive_presence"]).gte("created_at", presenceStart).order("created_at", { ascending: false }).limit(5000),
    db.from("buzz_score_snapshots").select("venue_id,score,label,score_mode,confidence,version,computed_at,expires_at,evidence_age_minutes,source_families,explanation,factors").gt("expires_at", now.toISOString()).limit(3000),
    db.from("buzz_signal_snapshots").select("source,value,observed_at,expires_at,metadata").like("source", "tomtom:%").gt("expires_at", now.toISOString()).order("observed_at", { ascending: false }).limit(1000),
    loadPublicActivityContext().catch(error => {
      console.error("Public weather/transit context unavailable", error instanceof Error ? error.message : error);
      return null;
    }),
  ]);

  if (venueResult.error) return NextResponse.json({ success: false, error: venueResult.error.message }, { status: 500 });
  if (eventResult.error) console.error("Event signals unavailable", eventResult.error.message);
  if (mappingResult.error) console.error("Event mappings unavailable", mappingResult.error.message);
  if (presenceResult.error) console.error("Passive presence unavailable", presenceResult.error.message);
  if (scoreResult.error) console.error("Buzz snapshots unavailable; using autonomous forecast", scoreResult.error.message);
  if (trafficResult.error) console.error("TomTom area signals unavailable", trafficResult.error.message);

  const venueIdentity = dedupeVenueRows((venueResult.data || []) as VenueRow[]);
  const venueRows = venueIdentity.venues;
  const primaryVenueIdBySourceId = venueIdentity.primaryVenueIdBySourceId;
  const eventRows = (eventResult.data || []) as EventRow[];
  const eventsById = new Map(eventRows.map(event => [event.id, event]));
  const venueByCanonical = new Map(venueRows.map(venue => [canonical(venue.name), venue.id]));
  const eventsByVenueId = new Map<string, EventRow[]>();
  for (const mapping of (mappingResult.data || []) as EventMappingRow[]) {
    if (!mapping.venue_id) continue;
    const venueId = primaryVenueIdBySourceId.get(mapping.venue_id) || mapping.venue_id;
    const event = eventsById.get(mapping.event_id);
    if (event) addVenueEvent(eventsByVenueId, venueId, event);
  }
  for (const event of eventRows) {
    const venueId = venueByCanonical.get(canonical(event.venue_name));
    if (venueId) addVenueEvent(eventsByVenueId, venueId, event);
  }

  const rawPresence = groupDirectPresence((presenceResult.data || []) as DirectPresenceRow[], now).byVenue;
  const presence = new Map<string, { passive: Set<string>; verified: Set<string> }>();
  for (const [sourceVenueId, group] of rawPresence) {
    const venueId = primaryVenueIdBySourceId.get(sourceVenueId) || sourceVenueId;
    const current = presence.get(venueId) || { passive: new Set<string>(), verified: new Set<string>() };
    for (const deviceId of group.passive) current.passive.add(deviceId);
    for (const deviceId of group.verified) current.verified.add(deviceId);
    presence.set(venueId, current);
  }

  const scoreMap = new Map<string, ScoreRow>();
  for (const snapshot of (scoreResult.data || []) as ScoreRow[]) {
    const venueId = primaryVenueIdBySourceId.get(snapshot.venue_id) || snapshot.venue_id;
    const current = scoreMap.get(venueId);
    const snapshotTime = new Date(snapshot.computed_at).getTime();
    const currentTime = new Date(current?.computed_at || 0).getTime();
    if (
      !current
      || (snapshot.score_mode === "live" && current.score_mode !== "live")
      || (snapshot.score_mode === current.score_mode && snapshotTime > currentTime)
    ) {
      scoreMap.set(venueId, { ...snapshot, venue_id: venueId });
    }
  }

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
    const district = nearestActivityDistrict(venueLat, venueLng, String(venue.city || ""));
    if (district) districtByVenueId.set(venue.id, district);
  }

  const districtEvents = new Map<string, DistrictEventStats>();
  for (const [venueId, venueEvents] of eventsByVenueId) {
    const district = districtByVenueId.get(venueId);
    if (!district) continue;
    const stats = districtEvents.get(district.id) || { active: 0, soon: 0, total: 0 };
    for (const event of venueEvents) {
      const evidence = eventSignal(event, now);
      stats.total += 1;
      if (evidence.active) stats.active += 1;
      else if (evidence.soon) stats.soon += 1;
    }
    districtEvents.set(district.id, stats);
  }

  const ranked = venueRows.flatMap(venue => {
    const venueLat = Number(venue.lat);
    const venueLng = Number(venue.lng);
    if (!Number.isFinite(venueLat) || !Number.isFinite(venueLng) || (!venueLat && !venueLng)) return [];
    if (bounds && !inside(venueLat, venueLng, bounds)) return [];
    const distance = lat !== null && lng !== null ? distanceMiles(lat, lng, venueLat, venueLng) : null;
    if (!bounds && distance !== null && distance > radius) return [];

    const event = chooseEvent(eventsByVenueId.get(venue.id) || [], now);
    const text = normalize(`${venue.name} ${venue.city} ${venue.address} ${venue.type} ${venue.category} ${venue.ai_summary} ${event?.name}`);
    const baseKinds = venueKinds({
      name: venue.name,
      type: venue.type,
      category: venue.category,
      summary: venue.ai_summary,
    });
    const baseKind = baseKinds[0];
    const kind = event ? "events" : baseKind;
    if (!categoryMatch(category, baseKinds, text, Boolean(event))) return [];
    if (query && !query.split(" ").every(term => text.includes(term))) return [];

    const eventEvidence = eventSignal(event, now);
    const ticketEvidence = ticketSignal(event?.ticket_status);
    const peakEvidence = expectedPeak(baseKind, now);
    const hoursEvidence = openHoursAdjustment({
      hours: venue.hours,
      eventActive: eventEvidence.active,
      eventSoon: eventEvidence.soon,
      reference: now,
    });
    const district = districtByVenueId.get(venue.id) || null;
    const trafficRow = district ? trafficByDistrict.get(district.id) : undefined;
    const areaTraffic = trafficEvidence(Number(trafficRow?.value || 0), trafficRow?.metadata);
    const districtEventStats = district ? (districtEvents.get(district.id) || { active: 0, soon: 0, total: 0 }) : { active: 0, soon: 0, total: 0 };
    const spilloverMultiplier = baseKind === "food" || baseKind === "nightlife" ? 1 : 0.5;
    const areaEventPoints = Math.round(Math.min(7, districtEventStats.active * 3 + districtEventStats.soon * 1.5) * spilloverMultiplier);
    const weatherEvidence = publicContext
      ? weatherEvidenceForVenue(publicContext, venueLat, venueLng, outdoorVenue(text))
      : neutralEvidence();
    const transitEvidence = publicContext
      ? transitEvidenceForDistrict(publicContext, district?.id || null)
      : neutralEvidence();

    const group = presence.get(venue.id) || { passive: new Set<string>(), verified: new Set<string>() };
    const phoneEvidence = passivePresenceEvidence({ passiveDevices: group.passive.size, verifiedDevices: group.verified.size });
    const snapshot = scoreMap.get(venue.id);
    const providerSupport = snapshotSupportPoints(snapshot?.factors);
    const expectedPrior = 12 + clamp(Number(venue.ai_score || 45), 0, 100) * 0.22;
    const baseScore = Math.round(expectedPrior + providerSupport + phoneEvidence.points);

    let buzzScore = Math.round(
      baseScore +
      eventEvidence.points +
      ticketEvidence.points +
      peakEvidence.points +
      hoursEvidence.points +
      areaTraffic.points +
      areaEventPoints +
      weatherEvidence.points +
      transitEvidence.points
    );

    const live = snapshot?.score_mode === "live" || phoneEvidence.live;
    const evidenceCount = [
      eventEvidence.points >= 8,
      ticketEvidence.strength === "strong",
      peakEvidence.points >= 6,
      hoursEvidence.open === true,
      areaTraffic.points >= 3,
      areaEventPoints >= 3,
      transitEvidence.points >= 2,
      providerSupport >= 8,
      phoneEvidence.points >= 4,
    ].filter(Boolean).length;

    if (hoursEvidence.cap !== null) buzzScore = Math.min(buzzScore, hoursEvidence.cap);
    if (weatherEvidence.cap !== null) buzzScore = Math.min(buzzScore, weatherEvidence.cap);
    if (!live) {
      const stronglySupported = evidenceCount >= 3 && hoursEvidence.open !== false;
      buzzScore = Math.min(buzzScore, stronglySupported ? 84 : evidenceCount >= 2 ? 76 : 68);
    }
    buzzScore = clamp(buzzScore, 0, 100);

    let confidence: Confidence = live
      ? snapshot?.confidence || phoneEvidence.confidence
      : evidenceCount >= 4 && areaTraffic.baselineReady ? "high"
        : evidenceCount >= 2 ? "medium"
          : "low";
    if (!live && (weatherEvidence.confidencePenalty || transitEvidence.confidencePenalty)) {
      confidence = lowerConfidence(confidence);
    }
    const scoreMode = live ? "live" : "forecast";

    const explanationParts: string[] = [];
    if (hoursEvidence.open === false) explanationParts.push(hoursEvidence.label || "Closed now");
    if (weatherEvidence.label && weatherEvidence.points < 0) explanationParts.push(weatherEvidence.label);
    if (phoneEvidence.label) explanationParts.push(phoneEvidence.label);
    if (eventEvidence.active) explanationParts.push(`${event?.name || "Event"} happening now`);
    else if (eventEvidence.soon) explanationParts.push(`${event?.name || "Event"} starts soon`);
    if (ticketEvidence.label) explanationParts.push(ticketEvidence.label);
    if (areaTraffic.label && district) explanationParts.push(`${district.shortName}: ${areaTraffic.label.toLowerCase()}`);
    if (transitEvidence.label && transitEvidence.points !== 0) explanationParts.push(transitEvidence.label);
    if (!eventEvidence.active && districtEventStats.active > 0) explanationParts.push(`${districtEventStats.active} nearby event${districtEventStats.active === 1 ? "" : "s"} happening`);
    if (weatherEvidence.label && weatherEvidence.points > 0) explanationParts.push(weatherEvidence.label);
    if (hoursEvidence.open === true && peakEvidence.label) explanationParts.push(peakEvidence.label);
    else if (hoursEvidence.open === true && !eventEvidence.active) explanationParts.push("Open now");
    const trendLabel = explanationParts.slice(0, 3).join(" · ") || "Conservative forecast; no strong activity signal yet";

    const photoUrl = getVenueImage({
      name: venue.name,
      kind,
      category: venue.category,
      type: venue.type,
      googlePlaceId: venue.google_place_id,
      lat: venueLat,
      lng: venueLng,
    });
    const districtMobilityPoints = areaTraffic.points + Math.max(0, transitEvidence.points);

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
      kinds: event ? [...new Set<VenueKind>(["events", ...baseKinds])] : baseKinds,
      photoUrl,
      reason: trendLabel,
      openNow: hoursEvidence.open,
      phone: venue.phone || null,
      website: venue.website || null,
      score: buzzScore,
      distanceMiles: distance === null ? null : Number(distance.toFixed(2)),
      area: district ? {
        id: district.id,
        name: district.name,
        shortName: district.shortName,
        status: districtStatus(districtMobilityPoints, districtEventStats, phoneEvidence.passive + phoneEvidence.verified),
        traffic: Math.round(areaTraffic.raw),
        trafficBaseline: areaTraffic.baseline,
        trafficAnomaly: areaTraffic.anomaly,
        transitArrivals30Minutes: Number(transitEvidence.metadata.arrivals30Minutes || 0),
        transitArrivals60Minutes: Number(transitEvidence.metadata.arrivals60Minutes || 0),
        transitDelayMinutes: transitEvidence.metadata.averageDelayMinutes ?? null,
        transitDegraded: transitEvidence.metadata.degraded === true,
        eventsActive: districtEventStats.active,
        eventsSoon: districtEventStats.soon,
      } : null,
      activity: {
        score: buzzScore,
        label: activityStatusLabel(buzzScore, scoreMode),
        trendLabel,
        confidence,
        scoreMode,
        updatedAt: snapshot?.computed_at || now.toISOString(),
        expiresAt: snapshot?.expires_at || null,
        evidenceAgeMinutes: snapshot?.evidence_age_minutes ?? null,
        scoreVersion: "buzz-v2.1-public-context",
        sourceFamilies: [...new Set([
          ...(snapshot?.source_families || []),
          ...(district ? ["mobility"] : []),
          ...(event ? ["event"] : []),
          ...(peakEvidence.points ? ["expected_peak"] : []),
          ...(hoursEvidence.open !== null ? ["operating_hours"] : []),
          ...(phoneEvidence.points ? ["passive_presence"] : []),
          ...(weatherEvidence.available ? ["weather"] : []),
          ...(transitEvidence.available ? ["public_transit"] : []),
        ])],
        explanation: trendLabel,
        factors: {
          basePrior: Math.round(expectedPrior),
          providerSupport,
          passivePresencePoints: phoneEvidence.points,
          passivePhones: phoneEvidence.passive,
          verifiedPhones: phoneEvidence.verified,
          eventPoints: eventEvidence.points,
          ticketPoints: ticketEvidence.points,
          expectedPeakPoints: peakEvidence.points,
          openHoursPoints: hoursEvidence.points,
          areaTrafficPoints: areaTraffic.points,
          areaEventPoints,
          weatherPoints: weatherEvidence.points,
          weather: weatherEvidence.metadata,
          transitPoints: transitEvidence.points,
          transit: transitEvidence.metadata,
          districtTraffic: Math.round(areaTraffic.raw),
          districtTrafficBaseline: areaTraffic.baseline,
          districtTrafficAnomaly: areaTraffic.anomaly,
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
    scoreVersion: "buzz-v2.1-public-context",
    scoreNotice: "Buzz combines open hours, venue patterns, mapped events, tickets, abnormal area traffic, cached weather, HRT arrivals, provider signals, and passive nearby phones. Weather and transit only adjust forecasts and can never prove a venue is Live.",
    supportingContext: publicContext ? {
      generatedAt: publicContext.generatedAt,
      availability: publicContext.availability,
      errors: publicContext.errors,
    } : {
      generatedAt: null,
      availability: { weather: false, hrtStatic: false, hrtRealtime: false, hrtVehiclePositions: false },
      errors: { weather: ["Public context unavailable"], hrtStatic: null, hrtRealtime: null },
    },
    scope,
    resultCount: ranked.length,
    picks: venues.slice(0, 40),
    venues,
  }, { headers: { "Cache-Control": "private, no-store" } });
}
