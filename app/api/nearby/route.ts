import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type Bounds = { west: number; south: number; east: number; north: number };
type VenueRow = Record<string, unknown> & { id: string; name: string; lat?: number; lng?: number };
type EventRow = { id: string; name?: string | null; venue_name?: string | null; start_time?: string | null; source_url?: string | null };

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

function kindFor(text: string, hasEvent: boolean) {
  if (hasEvent) return "events";
  if (/restaurant|food|diner|cafe|pizza|grill|kitchen|taco|burger|bakery|seafood|brunch/.test(text)) return "food";
  if (/bar|brew|cocktail|wine|pub|club|dj|nightlife|lounge|music/.test(text)) return "nightlife";
  if (/park|trail|beach|garden|outdoor|museum|shopping|mall|market|arcade|bowling|golf/.test(text)) return "activity";
  return "other";
}

function categoryMatch(category: string, kind: string, text: string) {
  if (!category || category === "all") return true;
  if (category === "drinks") return kind === "nightlife";
  if (category === "outdoors" || category === "shopping" || category === "explore") return kind === "activity";
  return kind === category || text.includes(category);
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
  const eventStart = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const eventEnd = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const [venueResult, eventResult] = await Promise.all([
    db.from("venues").select("id,name,city,address,lat,lng,type,category,ai_score,ai_summary,google_rating,google_place_id,photo_source,phone,website").limit(2500),
    db.from("events").select("id,name,venue_name,start_time,source_url").gte("start_time", eventStart).lte("start_time", eventEnd).order("start_time").limit(1200),
  ]);
  if (venueResult.error) return NextResponse.json({ success: false, error: venueResult.error.message }, { status: 500 });

  const events = new Map<string, EventRow>();
  for (const event of (eventResult.data || []) as EventRow[]) {
    const key = canonical(event.venue_name);
    if (key && !events.has(key)) events.set(key, event);
  }

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
    if (query && !query.split(" ").every((term) => text.includes(term))) return [];

    const base = Number(venue.ai_score || 0) || Number(venue.google_rating || 0) * 18 || 58;
    const score = clamp(Math.round(base + (event ? 10 : 0) - Math.min(24, (distance || 0) * 1.8)), 0, 100);
    const photoUrl = venue.photo_source === "google_streetview" && venue.google_place_id ? `/api/venue-photo?placeId=${encodeURIComponent(String(venue.google_place_id))}` : null;
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
      reason: event?.name || venue.ai_summary || `Popular ${venue.type || venue.category || "place"} nearby`,
      openNow: null,
      phone: venue.phone || null,
      website: venue.website || null,
      score,
      distanceMiles: distance === null ? null : Number(distance.toFixed(2)),
      activity: { score, label: score >= 88 ? "Very Busy" : score >= 76 ? "Heating Up" : score >= 60 ? "Active" : "Chill", trendLabel: score >= 76 ? "Getting Busier" : "Steady" },
      event: event ? { id: event.id, name: event.name || "Event", startTime: event.start_time || null, sourceUrl: event.source_url || null } : null,
    }];
  }).sort((a, b) => b.score - a.score || (a.distanceMiles ?? 999) - (b.distanceMiles ?? 999));

  const venues = ranked.slice(0, limit);
  const scope = bounds ? { type: "bounds", label: "this map area", bounds } : lat !== null && lng !== null ? { type: "radius", label: `within ${radius} mile${radius === 1 ? "" : "s"}`, center: { latitude: lat, longitude: lng }, radius } : query ? { type: "search", label: `matching ${url.searchParams.get("q") || ""}` } : { type: "market", label: "available places" };
  return NextResponse.json({ success: true, generatedAt: new Date().toISOString(), scope, resultCount: ranked.length, picks: venues.slice(0, 40), venues }, { headers: { "Cache-Control": "private, no-store" } });
}
