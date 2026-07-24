import {
  evaluateSample,
  summarize,
  type EvaluatedSample,
  type EvaluationSummary,
  type FrozenPrediction,
  type Observation,
} from "./evaluation";

/**
 * Offline ablation: what would accuracy have been without a given signal?
 *
 * Answered by arithmetic on the frozen factors of a published prediction, never
 * by recomputing. A recomputation would run after the observation exists and
 * would see the outcome it is supposed to be graded against.
 *
 * Because every published score is the sum of its factor points, removing a
 * family's points reconstructs exactly the score that would have been published
 * had that family contributed nothing.
 */

/** Signal families whose contribution can be isolated. */
export const ABLATABLE_FAMILIES = [
  "foot_traffic",
  "verified_users",
  "first_party_occupancy",
  "commercial_demand",
  "event_forecast",
  "mobility",
  "historical_learning",
] as const;

/** Named groupings the accuracy brief asks about directly. */
export const ABLATION_SCENARIOS: Record<string, readonly string[]> = {
  without_traffic: ["mobility"],
  without_event_demand: ["event_forecast", "commercial_demand"],
  without_calibration: ["historical_learning"],
  without_crowd_signals: ["verified_users", "first_party_occupancy", "foot_traffic"],
};

export type PredictionObservation = {
  prediction: FrozenPrediction;
  observation: Observation;
};

const clamp = (value: number, min: number, max: number) =>
  Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : min;

/**
 * Rebuild the prediction as it would have been published without `families`.
 *
 * Returns null when the removal is a no-op, so callers can measure only the
 * predictions the signal actually touched. Including untouched predictions
 * would dilute every delta toward zero and make a useless signal look harmless.
 */
export function ablate(
  prediction: FrozenPrediction,
  families: readonly string[],
): FrozenPrediction | null {
  const removed = new Set(families);
  const factors = prediction.factors || [];
  const removedPoints = factors
    .filter(factor => removed.has(factor.family))
    .reduce((sum, factor) => sum + (Number(factor.points) || 0), 0);

  if (removedPoints === 0) return null;

  return {
    ...prediction,
    score: clamp(Math.round(prediction.score - removedPoints), 0, 100),
    factors: factors.filter(factor => !removed.has(factor.family)),
    sourceFamilies: (prediction.sourceFamilies || []).filter(family => !removed.has(family)),
  };
}

export type AblationResult = {
  scenario: string;
  families: string[];
  /** Predictions this signal actually contributed to. */
  affectedSamples: number;
  baseline: EvaluationSummary;
  ablated: EvaluationSummary;
  /** Positive means removing the signal made error worse, so it was helping. */
  meanAbsoluteErrorDelta: number | null;
  /** Positive means removing the signal raised false Hot, so it was suppressing them. */
  falseHotRateDelta: number | null;
  verdict: "helps" | "hurts" | "neutral" | "insufficient_data";
};

const round = (value: number | null, decimals = 3) => {
  if (value === null || !Number.isFinite(value)) return null;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

/** Below this many affected samples a delta is noise, not evidence. */
export const MINIMUM_ABLATION_SAMPLES = 20;
/** Error deltas smaller than this are not treated as a real difference. */
export const MATERIAL_ERROR_DELTA = 0.5;

export function runAblation(
  pairs: PredictionObservation[],
  scenario: string,
  families: readonly string[],
): AblationResult {
  const baselineSamples: EvaluatedSample[] = [];
  const ablatedSamples: EvaluatedSample[] = [];

  for (const { prediction, observation } of pairs) {
    const ablatedPrediction = ablate(prediction, families);
    if (!ablatedPrediction) continue;

    const baseline = evaluateSample(prediction, observation);
    const ablated = evaluateSample(ablatedPrediction, observation);
    // Both must grade, so the two summaries always cover the same observations.
    if (!baseline || !ablated) continue;

    baselineSamples.push(baseline);
    ablatedSamples.push(ablated);
  }

  const baseline = summarize(baselineSamples);
  const ablated = summarize(ablatedSamples);

  const errorDelta = baseline.meanAbsoluteError === null || ablated.meanAbsoluteError === null
    ? null
    : round(ablated.meanAbsoluteError - baseline.meanAbsoluteError, 2);
  const falseHotDelta = baseline.falseHotRate === null || ablated.falseHotRate === null
    ? null
    : round(ablated.falseHotRate - baseline.falseHotRate);

  return {
    scenario,
    families: [...families],
    affectedSamples: baselineSamples.length,
    baseline,
    ablated,
    meanAbsoluteErrorDelta: errorDelta,
    falseHotRateDelta: falseHotDelta,
    verdict: verdictFor(baselineSamples.length, errorDelta),
  };
}

function verdictFor(affectedSamples: number, errorDelta: number | null): AblationResult["verdict"] {
  if (affectedSamples < MINIMUM_ABLATION_SAMPLES || errorDelta === null) return "insufficient_data";
  if (errorDelta > MATERIAL_ERROR_DELTA) return "helps";
  if (errorDelta < -MATERIAL_ERROR_DELTA) return "hurts";
  return "neutral";
}

export type AblationReport = {
  generatedAt: string;
  totalPairs: number;
  scenarios: AblationResult[];
  perFamily: AblationResult[];
  /** Signals that made error worse than leaving them out. */
  addingNoise: string[];
  /** Signals whose removal raised the false-Hot rate. */
  suppressingFalseHot: string[];
  note: string;
};

export function ablationReport(
  pairs: PredictionObservation[],
  now = new Date(),
): AblationReport {
  const scenarios = Object.entries(ABLATION_SCENARIOS)
    .map(([scenario, families]) => runAblation(pairs, scenario, families));
  const perFamily = ABLATABLE_FAMILIES
    .map(family => runAblation(pairs, family, [family]));

  return {
    generatedAt: now.toISOString(),
    totalPairs: pairs.length,
    scenarios,
    perFamily,
    addingNoise: perFamily
      .filter(result => result.verdict === "hurts")
      .map(result => result.scenario),
    suppressingFalseHot: perFamily
      .filter(result => result.falseHotRateDelta !== null && result.falseHotRateDelta > 0)
      .map(result => result.scenario),
    note: "Deltas describe the predictions each signal actually contributed to, not the whole dataset. A verdict of insufficient_data means the signal has not yet touched enough graded predictions to draw a conclusion.",
  };
}
