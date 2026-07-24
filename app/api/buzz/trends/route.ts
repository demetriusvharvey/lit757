import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import {
  exceedsRequestRate,
  guardErrorResponse,
  readBoundedJson,
  requestClientKey,
} from "../../../../src/lib/server/request-guards";

export const dynamic = "force-dynamic";

const db = getSupabaseAdmin();

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HISTORY_WINDOW_HOURS = 6;
const MAX_REQUESTED_VENUES = 100;
const MAX_HISTORY_ROWS = 8_000;
const MAX_SPARKLINE_POINTS = 12;

type HistoryRow = {
  venue_id: string;
  score: number;
  computed_at: string;
};

type TrendDirection = "rising_fast" | "rising" | "steady" | "cooling" | "cooling_fast" | "new";

function compactSamples(rows: HistoryRow[]) {
  const ordered = [...rows]
    .filter(row => Number.isFinite(Number(row.score)) && Number.isFinite(new Date(row.computed_at).getTime()))
    .sort((left, right) => new Date(left.computed_at).getTime() - new Date(right.computed_at).getTime());

  if (ordered.length <= MAX_SPARKLINE_POINTS) return ordered;

  const samples: HistoryRow[] = [];
  for (let index = 0; index < MAX_SPARKLINE_POINTS; index += 1) {
    const sourceIndex = Math.round(index * (ordered.length - 1) / (MAX_SPARKLINE_POINTS - 1));
    const row = ordered[sourceIndex];
    if (!samples.some(sample => sample.computed_at === row.computed_at)) samples.push(row);
  }
  return samples;
}

function describeTrend(rows: HistoryRow[]) {
  const samples = compactSamples(rows);
  if (samples.length < 2) {
    return {
      direction: "new" as TrendDirection,
      label: "New signal",
      samples: samples.map(row => Math.round(Number(row.score))),
      delta: 0,
      windowMinutes: 0,
    };
  }

  const first = samples[0];
  const last = samples[samples.length - 1];
  const delta = Math.round(Number(last.score) - Number(first.score));
  const windowMinutes = Math.max(1, Math.round(
    (new Date(last.computed_at).getTime() - new Date(first.computed_at).getTime()) / 60_000,
  ));

  let direction: TrendDirection = "steady";
  let label = "Holding steady";
  if (delta >= 12) {
    direction = "rising_fast";
    label = "Rising fast";
  } else if (delta >= 5) {
    direction = "rising";
    label = "Trending up";
  } else if (delta <= -12) {
    direction = "cooling_fast";
    label = "Cooling fast";
  } else if (delta <= -5) {
    direction = "cooling";
    label = "Cooling down";
  }

  return {
    direction,
    label,
    samples: samples.map(row => Math.round(Number(row.score))),
    delta,
    windowMinutes,
  };
}

export async function POST(request: Request) {
  if (exceedsRequestRate(`buzz-trends:${requestClientKey(request)}`, 30, 60_000)) {
    return NextResponse.json({ success: false, error: "Too many requests" }, { status: 429 });
  }

  let body: Record<string, unknown>;
  try {
    body = await readBoundedJson(request, 16_384);
  } catch (error) {
    return guardErrorResponse(error);
  }

  const venueIds = [...new Set(
    (Array.isArray(body.venueIds) ? body.venueIds : [])
      .map(String)
      .filter(id => UUID_PATTERN.test(id))
      .slice(0, MAX_REQUESTED_VENUES),
  )];

  if (!venueIds.length) {
    return NextResponse.json({ success: true, trends: {}, generatedAt: new Date().toISOString() });
  }

  const cutoff = new Date(Date.now() - HISTORY_WINDOW_HOURS * 60 * 60 * 1000).toISOString();
  const { data, error } = await db
    .from("buzz_score_history")
    .select("venue_id,score,computed_at")
    .gte("computed_at", cutoff)
    .order("computed_at", { ascending: true })
    .limit(MAX_HISTORY_ROWS);

  if (error) {
    console.error("Buzz trend history unavailable", error.message);
    return NextResponse.json({ success: false, error: "Trend history is temporarily unavailable" }, { status: 503 });
  }

  const requested = new Set(venueIds);
  const grouped = new Map<string, HistoryRow[]>();
  for (const row of (data || []) as HistoryRow[]) {
    if (!requested.has(row.venue_id)) continue;
    grouped.set(row.venue_id, [...(grouped.get(row.venue_id) || []), row]);
  }

  const trends = Object.fromEntries(
    venueIds.map(venueId => [venueId, describeTrend(grouped.get(venueId) || [])]),
  );

  return NextResponse.json({
    success: true,
    generatedAt: new Date().toISOString(),
    windowHours: HISTORY_WINDOW_HOURS,
    trends,
  }, { headers: { "Cache-Control": "private, no-store" } });
}
