import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { recomputeBuzzScore, saveBuzzSignals } from "../../../../src/lib/buzz/repository";
import type { BuzzSignal, VenueForBuzz } from "../../../../src/lib/buzz/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

type VenueRow = VenueForBuzz & {
  lat: number | string | null;
  lng: number | string | null;
};

type TomTomFlow = {
  currentSpeed?: number;
  freeFlowSpeed?: number;
  currentTravelTime?: number;
  freeFlowTravelTime?: number;
  confidence?: number;
  roadClosure?: boolean;
  frc?: string;
};

type TrafficPoint = { lat: number; lng: number; label: string };
type TrafficZone = {
  id: string;
  name: string;
  city: string;
  center: { lat: number; lng: number };
  radiusMiles: number;
  points: TrafficPoint[];
};

// Three road samples across eight activity districts = 24 calls per run.
// At a 15-minute cadence this is 2,304 calls/day, below TomTom's current
// 2,500 daily non-tile request freemium allowance.
const TRAFFIC_ZONES: TrafficZone[] = [
  {
    id: "virginia-beach-oceanfront",
    name: "Virginia Beach Oceanfront",
    city: "Virginia Beach",
    center: { lat: 36.8529, lng: -75.9780 },
    radiusMiles: 1.8,
    points: [
      { lat: 36.8529, lng: -75.9780, label: "Atlantic Avenue central" },
      { lat: 36.8612, lng: -75.9815, label: "31st Street arrivals" },
      { lat: 36.8348, lng: -75.9745, label: "Rudee Inlet arrivals" },
    ],
  },
  {
    id: "virginia-beach-town-center",
    name: "Virginia Beach Town Center",
    city: "Virginia Beach",
    center: { lat: 36.8424, lng: -76.1356 },
    radiusMiles: 1.3,
    points: [
      { lat: 36.8424, lng: -76.1356, label: "Town Center core" },
      { lat: 36.8384, lng: -76.1305, label: "Virginia Beach Boulevard" },
      { lat: 36.8451, lng: -76.1392, label: "Independence Boulevard" },
    ],
  },
  {
    id: "downtown-norfolk-waterside",
    name: "Downtown Norfolk & Waterside",
    city: "Norfolk",
    center: { lat: 36.8468, lng: -76.2920 },
    radiusMiles: 1.3,
    points: [
      { lat: 36.8468, lng: -76.2920, label: "Waterside Drive" },
      { lat: 36.8515, lng: -76.2894, label: "Granby Street" },
      { lat: 36.8434, lng: -76.2872, label: "St. Paul's Boulevard" },
    ],
  },
  {
    id: "ghent-neon",
    name: "Ghent & NEON District",
    city: "Norfolk",
    center: { lat: 36.8702, lng: -76.2886 },
    radiusMiles: 1.3,
    points: [
      { lat: 36.8702, lng: -76.2886, label: "21st Street" },
      { lat: 36.8643, lng: -76.2856, label: "NEON district" },
      { lat: 36.8746, lng: -76.2952, label: "Colley Avenue" },
    ],
  },
  {
    id: "olde-towne-portsmouth",
    name: "Olde Towne Portsmouth",
    city: "Portsmouth",
    center: { lat: 36.8353, lng: -76.2983 },
    radiusMiles: 1.2,
    points: [
      { lat: 36.8353, lng: -76.2983, label: "High Street waterfront" },
      { lat: 36.8311, lng: -76.3062, label: "Effingham Street" },
      { lat: 36.8391, lng: -76.3040, label: "Crawford connector" },
    ],
  },
  {
    id: "summit-pointe-greenbrier",
    name: "Summit Pointe & Greenbrier",
    city: "Chesapeake",
    center: { lat: 36.7687, lng: -76.2350 },
    radiusMiles: 1.5,
    points: [
      { lat: 36.7687, lng: -76.2350, label: "Summit Pointe core" },
      { lat: 36.7755, lng: -76.2290, label: "Greenbrier Parkway" },
      { lat: 36.7604, lng: -76.2408, label: "Volvo Parkway arrivals" },
    ],
  },
  {
    id: "hampton-coliseum-peninsula-town-center",
    name: "Hampton Coliseum & Peninsula Town Center",
    city: "Hampton",
    center: { lat: 37.0390, lng: -76.3920 },
    radiusMiles: 1.8,
    points: [
      { lat: 37.0390, lng: -76.3828, label: "Hampton Coliseum" },
      { lat: 37.0428, lng: -76.3937, label: "Peninsula Town Center" },
      { lat: 37.0340, lng: -76.4050, label: "Mercury Boulevard arrivals" },
    ],
  },
  {
    id: "city-center-oyster-point",
    name: "City Center at Oyster Point",
    city: "Newport News",
    center: { lat: 37.0877, lng: -76.4730 },
    radiusMiles: 1.5,
    points: [
      { lat: 37.0877, lng: -76.4730, label: "City Center core" },
      { lat: 37.0914, lng: -76.4804, label: "Jefferson Avenue" },
      { lat: 37.0837, lng: -76.4652, label: "Oyster Point Road" },
    ],
  },
];

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  return request.headers.get("authorization") === `Bearer ${secret}` || request.headers.get("x-cron-secret") === secret;
}

function radians(value: number) {
  return value * Math.PI / 180;
}

function miles(lat1: number, lng1: number, lat2: number, lng2: number) {
  const dLat = radians(lat2 - lat1);
  const dLng = radians(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLng / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function mapLimit<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>) {
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => run()));
}

async function fetchFlow(apiKey: string, point: TrafficPoint) {
  const url = new URL("https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/14/json");
  url.searchParams.set("key", apiKey);
  url.searchParams.set("point", `${point.lat},${point.lng}`);
  url.searchParams.set("unit", "MPH");

  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`TomTom traffic request failed (${response.status})`);
  const payload = await response.json() as { flowSegmentData?: TomTomFlow };
  if (!payload.flowSegmentData) throw new Error("TomTom returned no road segment");
  return payload.flowSegmentData;
}

function congestionFor(flow: TomTomFlow) {
  const currentSpeed = Math.max(0, Number(flow.currentSpeed || 0));
  const freeFlowSpeed = Math.max(0, Number(flow.freeFlowSpeed || 0));
  const currentTravelTime = Math.max(0, Number(flow.currentTravelTime || 0));
  const freeFlowTravelTime = Math.max(0, Number(flow.freeFlowTravelTime || 0));
  const speedCongestion = freeFlowSpeed > 0 ? (1 - currentSpeed / freeFlowSpeed) * 100 : 0;
  const delayCongestion = freeFlowTravelTime > 0 ? ((currentTravelTime - freeFlowTravelTime) / freeFlowTravelTime) * 100 : 0;
  return flow.roadClosure ? 100 : clamp(Math.max(speedCongestion, delayCongestion), 0, 100);
}

function zoneSignal(zone: TrafficZone, samples: Array<{ point: TrafficPoint; flow: TomTomFlow }>, observedAt = new Date()): BuzzSignal {
  const values = samples.map(sample => congestionFor(sample.flow));
  const average = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
  const peak = Math.max(...values, 0);
  const congestion = clamp(average * 0.7 + peak * 0.3, 0, 100);
  const providerConfidence = samples.reduce((sum, sample) => sum + clamp(Number(sample.flow.confidence ?? 0.5), 0, 1), 0) / Math.max(1, samples.length);

  return {
    source: `tomtom:${zone.id}`,
    family: "mobility",
    type: "traffic_congestion",
    value: Number(congestion.toFixed(1)),
    // Current road traffic is indirect evidence, not proof of people inside venues.
    isLive: false,
    confidence: Number((providerConfidence * 0.65).toFixed(3)),
    observedAt: observedAt.toISOString(),
    expiresAt: new Date(observedAt.getTime() + 20 * 60 * 1000).toISOString(),
    metadata: {
      sampledLive: true,
      zoneId: zone.id,
      zoneName: zone.name,
      city: zone.city,
      averageCongestion: Number(average.toFixed(1)),
      peakCongestion: Number(peak.toFixed(1)),
      sampleCount: samples.length,
      points: samples.map(({ point, flow }, index) => ({
        label: point.label,
        congestion: Number(values[index].toFixed(1)),
        currentSpeed: Number(flow.currentSpeed || 0),
        freeFlowSpeed: Number(flow.freeFlowSpeed || 0),
        roadClosure: Boolean(flow.roadClosure),
      })),
    },
  };
}

function zoneLabel(value: number) {
  if (value >= 65) return "Heavy arrival traffic";
  if (value >= 40) return "Busy arrival traffic";
  if (value >= 20) return "Some arrival pressure";
  return "Roads moving normally";
}

async function run(request: Request) {
  if (!authorized(request)) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const apiKey = process.env.TOMTOM_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ success: true, provider: "tomtom", skipped: true, message: "TOMTOM_API_KEY is not configured" });
  }

  const { data, error } = await db
    .from("venues")
    .select("id,name,address,city,type,category,ai_score,lat,lng")
    .not("lat", "is", null)
    .not("lng", "is", null)
    .limit(2500);

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  const venues = ((data || []) as VenueRow[]).filter(venue => Number.isFinite(Number(venue.lat)) && Number.isFinite(Number(venue.lng)));
  const generatedAt = new Date();
  const zoneResults: Array<Record<string, unknown>> = [];
  let calls = 0;
  let failedCalls = 0;
  let venueSignals = 0;

  await mapLimit(TRAFFIC_ZONES, 2, async zone => {
    const samples: Array<{ point: TrafficPoint; flow: TomTomFlow }> = [];
    await mapLimit(zone.points, 3, async point => {
      calls += 1;
      try {
        samples.push({ point, flow: await fetchFlow(apiKey, point) });
      } catch {
        failedCalls += 1;
      }
    });

    if (!samples.length) {
      zoneResults.push({ id: zone.id, name: zone.name, city: zone.city, status: "error", samples: 0 });
      return;
    }

    const signal = zoneSignal(zone, samples, generatedAt);
    const coveredVenues = venues
      .map(venue => ({ venue, distance: miles(zone.center.lat, zone.center.lng, Number(venue.lat), Number(venue.lng)) }))
      .filter(item => item.distance <= zone.radiusMiles)
      .sort((left, right) => right.venue.ai_score! - left.venue.ai_score! || left.distance - right.distance)
      .slice(0, 5);

    await mapLimit(coveredVenues, 3, async ({ venue, distance }) => {
      await saveBuzzSignals(db, venue.id, [{
        ...signal,
        metadata: { ...signal.metadata, venueDistanceMiles: Number(distance.toFixed(2)) },
      }]);
      await recomputeBuzzScore(db, venue);
      await db.from("buzz_provider_venues").upsert({
        venue_id: venue.id,
        provider: "tomtom",
        external_id: zone.id,
        coverage_status: "covered",
        last_checked_at: generatedAt.toISOString(),
        last_success_at: generatedAt.toISOString(),
        metadata: signal.metadata || {},
        updated_at: generatedAt.toISOString(),
      }, { onConflict: "venue_id,provider" });
      venueSignals += 1;
    });

    zoneResults.push({
      id: zone.id,
      name: zone.name,
      city: zone.city,
      status: "covered",
      congestion: signal.value,
      label: zoneLabel(signal.value),
      samples: samples.length,
      venuesSupported: coveredVenues.length,
    });
  });

  return NextResponse.json({
    success: true,
    provider: "tomtom",
    generatedAt: generatedAt.toISOString(),
    model: "activity-district-arrival-pressure-v1",
    truthNote: "Road traffic is supporting arrival evidence, not direct foot traffic or venue occupancy.",
    calls,
    failedCalls,
    venueSignals,
    zones: zoneResults,
  });
}

export async function GET(request: Request) {
  return run(request);
}

export async function POST(request: Request) {
  return run(request);
}
