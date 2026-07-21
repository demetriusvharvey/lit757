import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

type GroundTruthRow = {
  venue_id: string;
  observed_at: string;
  occupancy_band: "quiet" | "steady" | "busy" | "packed";
  occupancy_pct?: number | null;
  observer_type: string;
  metadata?: Record<string, unknown> | null;
};

type CalibrationSample = {
  predicted: number;
  observed: number;
  predictedBand: string;
  observedBand: string;
  confidence: string;
  mode: string;
  version: string;
};

const bandOrder = ["quiet", "steady", "busy", "packed"];
const bandValue: Record<string, number> = { quiet: 15, steady: 45, busy: 75, packed: 95 };
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

function scoreBand(score: number) {
  if (score >= 85) return "packed";
  if (score >= 60) return "busy";
  if (score >= 30) return "steady";
  return "quiet";
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function rounded(value: number | null, decimals = 1) {
  if (value === null || !Number.isFinite(value)) return null;
  const multiplier = 10 ** decimals;
  return Math.round(value * multiplier) / multiplier;
}

function groupMetrics(samples: CalibrationSample[], key: "confidence" | "mode" | "version") {
  const groups = new Map<string, CalibrationSample[]>();
  for (const sample of samples) {
    const value = sample[key] || "unknown";
    groups.set(value, [...(groups.get(value) || []), sample]);
  }
  return Object.fromEntries([...groups.entries()].map(([name, rows]) => [name, metrics(rows)]));
}

function metrics(samples: CalibrationSample[]) {
  const errors = samples.map(sample => Math.abs(sample.predicted - sample.observed));
  const signedErrors = samples.map(sample => sample.predicted - sample.observed);
  const exact = samples.filter(sample => sample.predictedBand === sample.observedBand).length;
  const adjacent = samples.filter(sample => {
    const predictedIndex = bandOrder.indexOf(sample.predictedBand);
    const observedIndex = bandOrder.indexOf(sample.observedBand);
    return predictedIndex >= 0 && observedIndex >= 0 && Math.abs(predictedIndex - observedIndex) <= 1;
  }).length;

  return {
    samples: samples.length,
    meanAbsoluteError: rounded(average(errors)),
    bias: rounded(average(signedErrors)),
    exactBandAccuracyPct: samples.length ? rounded(exact / samples.length * 100) : null,
    withinOneBandPct: samples.length ? rounded(adjacent / samples.length * 100) : null,
  };
}

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const days = clamp(Math.round(Number(url.searchParams.get("days") || 30)), 1, 365);
  const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await db
    .from("buzz_ground_truth")
    .select("venue_id,observed_at,occupancy_band,occupancy_pct,observer_type,metadata")
    .gte("observed_at", start)
    .order("observed_at", { ascending: false })
    .limit(5000);

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  const rows = (data || []) as GroundTruthRow[];
  const samples: CalibrationSample[] = rows.flatMap(row => {
    const predicted = Number(row.metadata?.predictedScore);
    if (!Number.isFinite(predicted)) return [];
    const observed = Number.isFinite(Number(row.occupancy_pct))
      ? Number(row.occupancy_pct)
      : bandValue[row.occupancy_band];
    return [{
      predicted,
      observed,
      predictedBand: scoreBand(predicted),
      observedBand: row.occupancy_band,
      confidence: String(row.metadata?.predictedConfidence || "unknown"),
      mode: String(row.metadata?.predictedMode || "unknown"),
      version: String(row.metadata?.predictedVersion || "unknown"),
    }];
  });

  const observers = Object.fromEntries([...new Set(rows.map(row => row.observer_type))].map(observer => [
    observer,
    rows.filter(row => row.observer_type === observer).length,
  ]));

  return NextResponse.json({
    success: true,
    generatedAt: new Date().toISOString(),
    windowDays: days,
    groundTruthRows: rows.length,
    usablePredictionSamples: samples.length,
    coveragePct: rows.length ? rounded(samples.length / rows.length * 100) : null,
    readyForWeightTuning: samples.length >= 50,
    recommendation: samples.length >= 50
      ? "Enough calibration samples exist to begin evidence-based weight tuning."
      : `Collect ${Math.max(0, 50 - samples.length)} more independent ground-truth samples before changing core weights.`,
    overall: metrics(samples),
    byConfidence: groupMetrics(samples, "confidence"),
    byMode: groupMetrics(samples, "mode"),
    byVersion: groupMetrics(samples, "version"),
    observerTypes: observers,
  }, { headers: { "Cache-Control": "private, no-store" } });
}
