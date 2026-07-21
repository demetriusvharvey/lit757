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

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  return request.headers.get("authorization") === `Bearer ${secret}` || request.headers.get("x-cron-secret") === secret;
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

async function fetchFlow(apiKey: string, lat: number, lng: number) {
  const url = new URL("https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/14/json");
  url.searchParams.set("key", apiKey);
  url.searchParams.set("point", `${lat},${lng}`);
  url.searchParams.set("unit", "MPH");

  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`TomTom traffic request failed (${response.status})`);
  const payload = await response.json() as { flowSegmentData?: TomTomFlow };
  if (!payload.flowSegmentData) throw new Error("TomTom returned no road segment");
  return payload.flowSegmentData;
}

function flowSignal(flow: TomTomFlow, observedAt = new Date()): BuzzSignal {
  const currentSpeed = Math.max(0, Number(flow.currentSpeed || 0));
  const freeFlowSpeed = Math.max(0, Number(flow.freeFlowSpeed || 0));
  const currentTravelTime = Math.max(0, Number(flow.currentTravelTime || 0));
  const freeFlowTravelTime = Math.max(0, Number(flow.freeFlowTravelTime || 0));
  const speedCongestion = freeFlowSpeed > 0 ? (1 - currentSpeed / freeFlowSpeed) * 100 : 0;
  const delayCongestion = freeFlowTravelTime > 0 ? ((currentTravelTime - freeFlowTravelTime) / freeFlowTravelTime) * 100 : 0;
  const congestion = flow.roadClosure ? 100 : clamp(Math.max(speedCongestion, delayCongestion), 0, 100);
  const providerConfidence = clamp(Number(flow.confidence ?? 0.5), 0, 1);

  return {
    source: "tomtom",
    family: "mobility",
    type: "traffic_congestion",
    value: Number(congestion.toFixed(1)),
    // Traffic is current, but it is indirect evidence. It must never make a venue Live by itself.
    isLive: false,
    confidence: Number((providerConfidence * 0.65).toFixed(3)),
    observedAt: observedAt.toISOString(),
    expiresAt: new Date(observedAt.getTime() + 20 * 60 * 1000).toISOString(),
    metadata: {
      sampledLive: true,
      currentSpeed,
      freeFlowSpeed,
      currentTravelTime,
      freeFlowTravelTime,
      providerConfidence,
      roadClosure: Boolean(flow.roadClosure),
      roadClass: flow.frc || null,
    },
  };
}

async function run(request: Request) {
  if (!authorized(request)) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const apiKey = process.env.TOMTOM_API_KEY;
  if (!apiKey) {
    return NextResponse.json({
      success: true,
      provider: "tomtom",
      skipped: true,
      message: "TOMTOM_API_KEY is not configured",
    });
  }

  const url = new URL(request.url);
  const limit = clamp(Math.round(Number(url.searchParams.get("limit") || 25)), 1, 50);
  const { data, error } = await db
    .from("venues")
    .select("id,name,address,city,type,category,ai_score,lat,lng")
    .not("lat", "is", null)
    .not("lng", "is", null)
    .order("ai_score", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  const venues = ((data || []) as VenueRow[]).filter(venue => Number.isFinite(Number(venue.lat)) && Number.isFinite(Number(venue.lng)));
  const details: Array<{ venueId: string; status: string; congestion?: number; error?: string }> = [];
  let succeeded = 0;
  let failed = 0;

  await mapLimit(venues, 4, async venue => {
    const lat = Number(venue.lat);
    const lng = Number(venue.lng);
    const checkedAt = new Date();
    try {
      const flow = await fetchFlow(apiKey, lat, lng);
      const signal = flowSignal(flow, checkedAt);
      await saveBuzzSignals(db, venue.id, [signal]);
      await recomputeBuzzScore(db, venue);
      await db.from("buzz_provider_venues").upsert({
        venue_id: venue.id,
        provider: "tomtom",
        external_id: `${lat.toFixed(5)},${lng.toFixed(5)}`,
        coverage_status: "covered",
        last_checked_at: checkedAt.toISOString(),
        last_success_at: checkedAt.toISOString(),
        metadata: signal.metadata || {},
        updated_at: checkedAt.toISOString(),
      }, { onConflict: "venue_id,provider" });
      succeeded += 1;
      details.push({ venueId: venue.id, status: "covered", congestion: signal.value });
    } catch (refreshError) {
      failed += 1;
      details.push({ venueId: venue.id, status: "error", error: refreshError instanceof Error ? refreshError.message : "Unknown error" });
      await db.from("buzz_provider_venues").upsert({
        venue_id: venue.id,
        provider: "tomtom",
        external_id: `${lat.toFixed(5)},${lng.toFixed(5)}`,
        coverage_status: "error",
        last_checked_at: checkedAt.toISOString(),
        updated_at: checkedAt.toISOString(),
      }, { onConflict: "venue_id,provider" });
    }
  });

  return NextResponse.json({
    success: true,
    provider: "tomtom",
    generatedAt: new Date().toISOString(),
    attempted: venues.length,
    succeeded,
    failed,
    details,
  });
}

export async function GET(request: Request) {
  return run(request);
}

export async function POST(request: Request) {
  return run(request);
}
