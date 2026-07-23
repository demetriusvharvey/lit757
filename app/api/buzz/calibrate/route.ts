import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { trainCalibrationModel, type CalibrationTrainingRow } from "../../../../src/lib/buzz/training";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

function authorized(request: Request) {
  const secret = process.env.BUZZ_GROUND_TRUTH_SECRET || process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  return request.headers.get("authorization") === `Bearer ${secret}`
    || request.headers.get("x-buzz-ground-truth-secret") === secret;
}

function actualScore(row: { occupancy_pct?: number | null; occupancy_band?: string | null }) {
  if (row.occupancy_pct != null && Number.isFinite(Number(row.occupancy_pct))) {
    return Math.max(0, Math.min(100, Number(row.occupancy_pct)));
  }
  const band = String(row.occupancy_band || "").toLowerCase();
  if (band === "packed") return 95;
  if (band === "busy") return 75;
  if (band === "steady") return 45;
  return 15;
}

async function calibrate(request: Request) {
  if (!authorized(request)) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const { data, error } = await db
    .from("buzz_ground_truth")
    .select("venue_id,observed_at,occupancy_pct,occupancy_band,metadata")
    .order("observed_at", { ascending: false })
    .limit(5000);
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  const rows: CalibrationTrainingRow[] = (data || []).flatMap(row => {
    const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata as Record<string, unknown> : {};
    const predictedScore = Number(metadata.predictedScore);
    if (!Number.isFinite(predictedScore)) return [];
    return [{
      venueId: String(row.venue_id),
      predictedScore,
      actualScore: actualScore(row),
      observedAt: String(row.observed_at),
    }];
  });

  const model = trainCalibrationModel(rows);
  const { error: upsertError } = await db.from("buzz_calibration_models").upsert({
    model_key: "global",
    version: model.version,
    model,
    training_rows: model.trainingRows,
    mean_absolute_error: model.meanAbsoluteError,
    trained_at: model.trainedAt,
    updated_at: new Date().toISOString(),
  }, { onConflict: "model_key" });
  if (upsertError) return NextResponse.json({ success: false, error: upsertError.message }, { status: 500 });

  return NextResponse.json({
    success: true,
    modelKey: "global",
    version: model.version,
    trainingRows: model.trainingRows,
    meanAbsoluteError: model.meanAbsoluteError,
    trainedAt: model.trainedAt,
    ready: model.trainingRows >= 8,
    highConfidenceReady: model.trainingRows >= 40 && model.meanAbsoluteError != null && model.meanAbsoluteError <= 10,
    truthNote: "Calibration improves from verified ground truth over time. A successful training run does not prove 9/10 accuracy until held-out beta observations confirm low prediction error.",
  }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}

export async function GET(request: Request) {
  return calibrate(request);
}

export async function POST(request: Request) {
  return calibrate(request);
}
