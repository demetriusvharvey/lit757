import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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
type PresenceRow = { venue_id?: string | null; device_id?: string | null };
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

function miles(lat1: number, lng1: number, lat2: number, lng2: number) {
  const rad = (n: number) => n * Math.PI / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function hoursFromNow(value?: string | null) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? (timestamp - Date.now()) / 3_600_000 : null;
}

function kindFor(text: string, hasEvent: boolean) {
  if (hasEvent) return "events";
  if (/restaurant|food|diner|cafe|pizza|grill|kitchen|taco|burger|bakery|seafood|brunch/.test(text)) return "food";
  if (/bar|brew|cocktail|wine|pub|club|dj|nightlife|lounge|music/.test(text)) return "nightlife";
  if (/park|trail|beach|garden|outdoor|museum|shopping|mall|market|arcade|bowling|golf|zoo|aquarium|theater|theatre|comedy/.test(text)) return "activity";
  return "other";
}

function categoryMatch(category: string, kind: string, text: string) {
  if (!category || category === "all") return true;
  if (category === "drinks") return kind === "nightlife";
  if (category === "outdoors" || category === "shopping" || category === "explore") return kind === "activity";
  return kind === category || text.includes(category);
}

function ticketSignal(status?: string | null) {
  const value = normalize(status);
  if (!value) return { points: 0, strength: "none" as const };
  if (/sold out|not available|no tickets|unavailable/.test(value)) return { points: 18, strength: "strong" as const };
  if (/limited|low|few|selling fast/.test(value)) return { points: 12, strength: "strong" as const };
  if (/available|on sale/.test(value)) return { points: 2, strength: "weak" as const };
  return { points: 0, strength: "none" as const };
}

function eventSignal(event: EventRow | null) {
  if (!event) return { points: 0, active: false, hours: null as number | null };
  const startHours = hoursFromNow(event.start_time);
  const endHours = hoursFromNow(event.end_time);
  const active = startHours !== null && startHours <= 0.75 && (endHours === null ? startHours >= -3 : endHours >= 0);
  if (active) return { points: 20, active: true, hours: startHours };
  if (startHours === null || startHours < -3) return { points: 0, active: false, hours: startHours };
  if (startHours <= 2) return { points: 15, active: false, hours: startHours };
  if (startHours <= 6) return { points: 9, active: false, hours: startHours };
  if (startHours <= 24) return { points: 4, active: false, hours: startHours };
  return { points: 0, active: false, hours: startHours };
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

  const [venueResult, eventResult, presenceResult, scoreResult] = await Promise.all([
    db.from("venues").select("id,name,city,address,lat,lng,type,category,ai_score,ai_summary,google_rating,google_place_id,photo_source,phone,website,hours,enriched_at").limit(2500),
    db.from("events").select("id,name,venue_name,start_time,end_time,ticket_status,source_url").gte("start_time", eventStart).lte("start_time", eventEnd).order("start_time").limit(1200),
    db.from("venue_live_reports").select("venue_id,device_id").eq("report_type", "nearby_presence").gte("created_at", presenceStart).limit(3000),
    db.from("buzz_score_snapshots").select("venue_id,score,label,score_mode,confidence,version,computed_at,expires_at,evidence_age_minutes,source_families,explanation,factors").gt("expires_at", new Date(now.getTime() - 10 * 60 * 1000).toISOString()).limit(3000),
  ]);

  if (venueResult.error) return NextResponse.json({ success: false, error: venueResult.error.message }, { status: 500 });
  if (eventResult.error) console.error("Event signals unavailable", eventResult.error.message);
  if (presenceResult.error) console.error("Live presence signals unavailable", presenceResult.error.message);
  if (scoreResult.error) console.error("Buzz v1 snapshots unavailable; using fallback scoring", scoreResult.error.message);

  const events = new Map<string, EventRow>();
  for (const event of (eventResult.data || []) as EventRow[]) {
    const key = canonical(event.venue_name);
    if (key && !events.has(key)) events.set(key, event);
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

  const ranked = ((venueResult.data || []) as VenueRow[]).flatMap((venue) => {
    const venueLat = Number(venue.lat);
    const venueLng = Number(venue.lng);
    if (!Number.isFinite(venueLat) || !Number.isFinite(venueLng) || (!venueLat && !venueLng)) return [];
    if (bounds && !inside(venueLat, venueLng, bounds)) return [];
    const distance = lat !== null && lng !== null ? miles(lat, lng, venueLat, venueLng) : null;
    if (!bounds && distance !== null && distance > radius) return [];

    const event = events.get(canonical(venue.name)) || null;
    const text = normalize(`${venue.name} ${venue.city} ${venue.address} ${venue.type} ${venue.category} ${venue.ai_summary} ${event?.name}`);
    const kind = kindFor(text, Boolean(event));
    if (!categoryMatch(category, kind, text)) return [];
    if (query && !query.split(" ").every(term => text.includes(term))) return [];

    const livePresenceCount = presence.get(venue.id)?.size || 0;
    const expectedPrior = 30 + clamp(Number(venue.ai_score || 45), 0, 100) * 0.35;
    const livePresencePoints = Math.min(35, livePresenceCount * 10);
    const eventEvidence = eventSignal(event);
    const ticketEvidence = ticketSignal(event?.ticket_status);
    let fallbackScore = Math.round(expectedPrior + livePresencePoints + eventEvidence.points + ticketEvidence.points);
    const fallbackLive = livePresenceCount > 0;
    const fallbackStrongEvent = eventEvidence.active && ticketEvidence.strength === "strong";
    if (!fallbackLive && !fallbackStrongEvent) fallbackScore = Math.min(fallbackScore, 74);
    fallbackScore = clamp(fallbackScore, 0, 100);

    const snapshot = scoreMap.get(venue.id);
    const buzzScore = snapshot ? clamp(Number(snapshot.score), 0, 100) : fallbackScore;
    const confidence = snapshot?.confidence || (livePresenceCount >= 4 || (livePresenceCount >= 2 && eventEvidence.active) ? "high" : livePresenceCount >= 1 || fallbackStrongEvent || eventEvidence.active ? "medium" : "low");
    const scoreMode = snapshot?.score_mode || (fallbackLive || fallbackStrongEvent ? "live" : "forecast");
    const trendLabel = snapshot?.explanation || (livePresenceCount >= 2 ? "Verified activity building" : livePresenceCount === 1 ? "Live activity reported" : eventEvidence.active ? "Event in progress" : eventEvidence.points > 0 ? "Event approaching" : "Forecast only");
    const photoUrl = venue.google_place_id ? `/api/venue-photo?placeId=${encodeURIComponent(String(venue.google_place_id))}` : null;

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
      reason: event?.name || snapshot?.explanation || venue.ai_summary || `A ${venue.type || venue.category || "place"} you can do right now`,
      openNow: null,
      phone: venue.phone || null,
      website: venue.website || null,
      score: buzzScore,
      distanceMiles: distance === null ? null : Number(distance.toFixed(2)),
      activity: {
        score: buzzScore,
        label: snapshot?.label || (buzzScore >= 88 ? "On Fire" : buzzScore >= 76 ? "Heating Up" : buzzScore >= 60 ? "Active" : "Chill"),
        trendLabel,
        confidence,
        scoreMode,
        updatedAt: snapshot?.computed_at || now.toISOString(),
        expiresAt: snapshot?.expires_at || null,
        evidenceAgeMinutes: snapshot?.evidence_age_minutes ?? null,
        scoreVersion: snapshot?.version || "buzz-v0.2-fallback",
        sourceFamilies: snapshot?.source_families || [],
        explanation: snapshot?.explanation || trendLabel,
        factors: snapshot?.factors || null,
        signals: snapshot ? undefined : {
          expectedPrior: Math.round(expectedPrior),
          livePresenceCount,
          livePresencePoints,
          eventPoints: eventEvidence.points,
          eventActive: eventEvidence.active,
          ticketPoints: ticketEvidence.points,
          ticketStatus: event?.ticket_status || null,
        },
      },
      event: event ? { id: event.id, name: event.name || "Event", startTime: event.start_time || null, sourceUrl: event.source_url || null, ticketStatus: event.ticket_status || null } : null,
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
    scoreVersion: scoreMap.size ? "buzz-v1" : "buzz-v0.2-fallback",
    scoreNotice: "Live scores use expiring evidence. Forecast-only scores are capped and cannot claim a venue is currently packed.",
    scope,
    resultCount: ranked.length,
    picks: venues.slice(0, 40),
    venues,
  }, { headers: { "Cache-Control": "private, no-store" } });
}
