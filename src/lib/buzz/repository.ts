import type { SupabaseClient } from "@supabase/supabase-js";
import { applyCalibration, buildCalibrationFeatures, confidenceFromCalibration, type BuzzCalibrationModel } from "./calibration";
import { calculateBuzzScore } from "./score-v1";
import type { BuzzSignal, VenueForBuzz } from "./types";

type SignalRow = {
  source: string;
  signal_family: BuzzSignal["family"];
  signal_type: BuzzSignal["type"];
  value: number;
  is_live: boolean;
  confidence: number;
  observed_at: string;
  expires_at: string;
  metadata?: Record<string, unknown> | null;
};

export function signalToRow(venueId: string, signal: BuzzSignal) {
  return {
    venue_id: venueId,
    source: signal.source,
    signal_family: signal.family,
    signal_type: signal.type,
    value: signal.value,
    is_live: signal.isLive,
    confidence: signal.confidence,
    observed_at: signal.observedAt,
    expires_at: signal.expiresAt,
    metadata: signal.metadata || {},
  };
}

export function rowToSignal(row: SignalRow): BuzzSignal {
  return {
    source: row.source,
    family: row.signal_family,
    type: row.signal_type,
    value: Number(row.value),
    isLive: Boolean(row.is_live),
    confidence: Number(row.confidence),
    observedAt: row.observed_at,
    expiresAt: row.expires_at,
    metadata: row.metadata || {},
  };
}

export async function saveBuzzSignals(db: SupabaseClient, venueId: string, signals: BuzzSignal[]) {
  if (!signals.length) return;
  const { error } = await db.from("buzz_signal_snapshots").upsert(
    signals.map(signal => signalToRow(venueId, signal)),
    { onConflict: "venue_id,source,signal_type,observed_at", ignoreDuplicates: true },
  );
  if (error) throw new Error(`Could not save Buzz signals: ${error.message}`);
}

export async function loadActiveSignals(db: SupabaseClient, venueId: string, now = new Date()) {
  const { data, error } = await db
    .from("buzz_signal_snapshots")
    .select("source,signal_family,signal_type,value,is_live,confidence,observed_at,expires_at,metadata")
    .eq("venue_id", venueId)
    .gt("expires_at", now.toISOString())
    .order("observed_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(`Could not load Buzz signals: ${error.message}`);
  return (data || []).map(row => rowToSignal(row as SignalRow));
}

async function loadCalibrationModel(db: SupabaseClient) {
  const { data, error } = await db
    .from("buzz_calibration_models")
    .select("model")
    .eq("model_key", "global")
    .maybeSingle();
  if (error || !data?.model) return null;
  return data.model as BuzzCalibrationModel;
}

export async function recomputeBuzzScore(db: SupabaseClient, venue: VenueForBuzz, now = new Date()) {
  const signals = await loadActiveSignals(db, venue.id, now);
  const base = calculateBuzzScore(venue, signals, now);
  const model = await loadCalibrationModel(db);
  const features = buildCalibrationFeatures(venue, signals, base.score, now);
  const calibrated = applyCalibration(model, features);
  const score = {
    ...base,
    score: calibrated.score,
    confidence: confidenceFromCalibration(base.confidence, model),
    version: calibrated.applied ? "buzz-ml-v1" as const : base.version,
    factors: calibrated.applied && Math.abs(calibrated.adjustment) >= 0.5
      ? [...base.factors, {
          family: "calibration" as const,
          label: "Historical calibration",
          points: calibrated.adjustment,
          source: "buzz-ml-v1",
        }]
      : base.factors,
  };
  const snapshot = {
    venue_id: venue.id,
    score: score.score,
    label: score.label,
    score_mode: score.mode,
    confidence: score.confidence,
    version: score.version,
    computed_at: score.computedAt,
    expires_at: score.expiresAt,
    evidence_age_minutes: score.evidenceAgeMinutes,
    source_families: score.sourceFamilies,
    explanation: score.explanation,
    factors: score.factors,
  };

  const [{ error: snapshotError }, { error: historyError }] = await Promise.all([
    db.from("buzz_score_snapshots").upsert({ ...snapshot, updated_at: now.toISOString() }, { onConflict: "venue_id" }),
    db.from("buzz_score_history").upsert(snapshot, { onConflict: "venue_id,computed_at", ignoreDuplicates: true }),
  ]);
  if (snapshotError) throw new Error(`Could not save Buzz score: ${snapshotError.message}`);
  if (historyError) throw new Error(`Could not save Buzz score history: ${historyError.message}`);
  return score;
}
