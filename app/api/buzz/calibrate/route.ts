import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { hasBearerSecret } from "../../../../src/lib/server/request-guards";
import { trainCalibrationModel, type CalibrationTrainingRow } from "../../../../src/lib/buzz/training";
import { MINIMUM_TRAINING_ROWS } from "../../../../src/lib/buzz/calibration-model";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: Request) {
  // Training reads raw ground truth and writes the artifact that can move public
  // scores. It sits on the same trust boundary as ground-truth ingestion.
  // CRON_SECRET is deliberately not accepted here: it is distributed to
  // schedulers for read-only refresh work and must not broaden access.
  return hasBearerSecret(request, process.env.BUZZ_GROUND_TRUTH_SECRET);
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
  if (!authorized(request)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("buzz_ground_truth")
    .select("venue_id,observed_at,occupancy_pct,occupancy_band,metadata")
    .order("observed_at", { ascending: false })
    .limit(5000);
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  // Only observations carrying the prediction that was frozen at ingest time can
  // train the model. Recomputing a prediction now would leak the outcome into
  // its own input and make the reported error meaningless.
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
    observationsScanned: (data || []).length,
    trainingRows: model.trainingRows,
    skippedWithoutFrozenPrediction: (data || []).length - rows.length,
    meanAbsoluteError: model.meanAbsoluteError,
    trainedAt: model.trainedAt,
    ready: model.trainingRows >= MINIMUM_TRAINING_ROWS,
    truthNote: "This trains and stores a candidate calibration artifact. It does not change any public score. Promotion requires held-out evaluation against observations the model was not trained on.",
  }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}

export async function GET(request: Request) {
  return calibrate(request);
}

export async function POST(request: Request) {
  return calibrate(request);
}
