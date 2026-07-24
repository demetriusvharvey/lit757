import type { FrozenFactor, FrozenPrediction, Observation } from "./evaluation";
import type { PredictionObservation } from "./ablation";

/**
 * Reads stored ground-truth rows into the pairs the evaluator grades.
 *
 * The prediction is reconstructed only from what was frozen into `metadata` at
 * ingest time. Nothing here reaches for a current score, because a current
 * score has already seen the observation it would be graded against.
 */

export type GroundTruthRow = {
  venue_id: string;
  observed_at: string;
  occupancy_band: string;
  occupancy_pct?: number | null;
  observer_type?: string | null;
  metadata?: Record<string, unknown> | null;
};

const BANDS = new Set(["quiet", "steady", "busy", "packed"]);

function asFactors(value: unknown): FrozenFactor[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(entry => {
    if (!entry || typeof entry !== "object") return [];
    const factor = entry as Record<string, unknown>;
    const points = Number(factor.points);
    if (typeof factor.family !== "string" || !Number.isFinite(points)) return [];
    return [{
      family: factor.family,
      label: typeof factor.label === "string" ? factor.label : undefined,
      points,
      source: typeof factor.source === "string" ? factor.source : undefined,
    }];
  });
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function asMode(value: unknown): FrozenPrediction["mode"] {
  return value === "live" || value === "forecast" ? value : "unknown";
}

function asConfidence(value: unknown): FrozenPrediction["confidence"] {
  return value === "low" || value === "medium" || value === "high" ? value : "unknown";
}

/**
 * Minutes between when the prediction was computed and when it was tested.
 * A prediction made two hours before the observation was forecasting further
 * ahead than one made two minutes before, and should be judged accordingly.
 */
function horizonMinutes(predictedAt: unknown, observedAt: string) {
  if (typeof predictedAt !== "string") return undefined;
  const predicted = new Date(predictedAt).getTime();
  const observed = new Date(observedAt).getTime();
  if (Number.isNaN(predicted) || Number.isNaN(observed)) return undefined;
  const minutes = (observed - predicted) / 60_000;
  return minutes >= 0 ? Math.round(minutes) : undefined;
}

/**
 * Returns null when the row carries no frozen prediction. Those rows are real
 * observations but ungraded evidence: counting them as anything else would
 * either invent a prediction or silently distort coverage.
 */
export function toPredictionObservation(row: GroundTruthRow): PredictionObservation | null {
  const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
  const score = Number((metadata as Record<string, unknown>).predictedScore);
  if (!Number.isFinite(score)) return null;
  if (!BANDS.has(String(row.occupancy_band))) return null;

  const meta = metadata as Record<string, unknown>;
  const prediction: FrozenPrediction = {
    venueId: String(row.venue_id),
    score,
    mode: asMode(meta.predictedMode),
    confidence: asConfidence(meta.predictedConfidence),
    scoreVersion: typeof meta.predictedVersion === "string" ? meta.predictedVersion : "unknown",
    calibrationVersion: typeof meta.predictedCalibrationVersion === "string"
      ? meta.predictedCalibrationVersion
      : undefined,
    predictedAt: typeof meta.predictedAt === "string" ? meta.predictedAt : row.observed_at,
    forecastHorizonMinutes: horizonMinutes(meta.predictedAt, row.observed_at),
    sourceFamilies: asStringArray(meta.predictedSourceFamilies),
    factors: asFactors(meta.predictedFactors),
  };

  const observation: Observation = {
    venueId: String(row.venue_id),
    observedAt: row.observed_at,
    band: row.occupancy_band as Observation["band"],
    occupancyPct: row.occupancy_pct ?? null,
    observerType: row.observer_type || undefined,
  };

  return { prediction, observation };
}

export type SourceSummary = {
  rows: number;
  graded: number;
  ungraded: number;
  /** Share of observations that carried a frozen prediction. */
  coverage: number | null;
  /** Graded rows that also carried frozen factors, so ablation can use them. */
  withFrozenFactors: number;
};

export function loadPairs(rows: GroundTruthRow[]) {
  const pairs = rows.flatMap(row => {
    const pair = toPredictionObservation(row);
    return pair ? [pair] : [];
  });

  const summary: SourceSummary = {
    rows: rows.length,
    graded: pairs.length,
    ungraded: rows.length - pairs.length,
    coverage: rows.length ? Number((pairs.length / rows.length).toFixed(4)) : null,
    withFrozenFactors: pairs.filter(pair => (pair.prediction.factors || []).length > 0).length,
  };

  return { pairs, summary };
}

/** Bucketed forecast horizon, so error can be reported against lead time. */
export function horizonBucket(minutes: number | null) {
  if (minutes === null) return "unknown";
  if (minutes <= 15) return "0-15m";
  if (minutes <= 60) return "15-60m";
  if (minutes <= 180) return "1-3h";
  return "3h+";
}

/** How much independent evidence backed a prediction. */
export function evidenceBucket(sourceFamilyCount: number) {
  if (sourceFamilyCount === 0) return "none";
  if (sourceFamilyCount === 1) return "single_family";
  if (sourceFamilyCount === 2) return "two_families";
  return "three_plus_families";
}
