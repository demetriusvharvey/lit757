import { NextRequest, NextResponse } from "next/server";
import { buildCityPulse, buildCollections, enrichVenue, privacySafeAreaActivity, productMetrics, rankVenues, type RawVenue } from "../../../src/lib/buzz/platform-suite";
import type { IntentId } from "../../../src/lib/buzz/product-intelligence";

export const dynamic = "force-dynamic";

const INTENTS = new Set<IntentId>(["best_now", "high_energy", "chill", "short_line", "easy_parking", "food_now", "date_night", "group", "family", "free", "open_late", "ending_soon", "different"]);
const HORIZONS: Record<string, number> = { now: 0, soon: 30, hour: 60, later: 120, typical: 0 };

function numberParam(value: string | null) {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("mode") || "all";
  const city = url.searchParams.get("city") || "All 757";
  const query = url.searchParams.get("q") || "";
  const intentValue = url.searchParams.get("intent") as IntentId | null;
  const intent: IntentId = intentValue && INTENTS.has(intentValue) ? intentValue : "best_now";
  const horizonKey = url.searchParams.get("horizon") || "now";
  const horizonMinutes = HORIZONS[horizonKey] ?? 0;
  const latitude = numberParam(url.searchParams.get("lat"));
  const longitude = numberParam(url.searchParams.get("lng"));

  const discoverParams = new URLSearchParams({ mode, city });
  if (query) discoverParams.set("q", query);
  const discoverUrl = new URL(`/api/discover?${discoverParams}`, url.origin);
  const authorization = request.headers.get("authorization");
  const response = await fetch(discoverUrl, {
    cache: "no-store",
    headers: authorization ? { authorization } : undefined,
  });
  const payload = await response.json().catch(() => null) as { success?: boolean; generatedAt?: string; venues?: RawVenue[]; picks?: RawVenue[]; context?: unknown; freshness?: unknown; error?: string } | null;
  if (!response.ok || !payload?.success) {
    return NextResponse.json({ success: false, error: payload?.error || "Could not load live activity." }, { status: response.status || 500 });
  }

  const generatedAt = payload.generatedAt ? new Date(payload.generatedAt) : new Date();
  const distance = (venue: RawVenue) => {
    if (latitude == null || longitude == null) return null;
    const radius = 3958.8;
    const radians = (value: number) => value * Math.PI / 180;
    const dLat = radians(venue.lat - latitude);
    const dLng = radians(venue.lng - longitude);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(latitude)) * Math.cos(radians(venue.lat)) * Math.sin(dLng / 2) ** 2;
    return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };

  const enriched = (payload.venues || []).map(venue => enrichVenue(venue, { generatedAt, distanceMiles: distance(venue), horizonMinutes, intent }));
  const ranked = rankVenues(enriched, intent);
  const pickIds = new Set((payload.picks || []).map(venue => venue.id));
  const picks = ranked.filter(venue => pickIds.has(venue.id)).concat(ranked.filter(venue => !pickIds.has(venue.id))).slice(0, 8);

  return NextResponse.json({
    success: true,
    generatedAt: generatedAt.toISOString(),
    intent,
    horizon: horizonKey,
    context: payload.context,
    freshness: payload.freshness,
    pulse: buildCityPulse(ranked),
    collections: buildCollections(ranked),
    metrics: productMetrics(ranked),
    privacySafeAreas: privacySafeAreaActivity(ranked),
    picks,
    venues: ranked,
  }, {
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "X-Buzz-Truth-Contract": "v1",
    },
  });
}
