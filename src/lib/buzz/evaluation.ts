import { localCalendarIndices, localNightKey } from "./local-time";

/**
 * Offline evaluation of Buzz predictions against ground truth.
 *
 * The rule this module is built around: a prediction is evaluated exactly as it
 * was published. Predictions arrive here already frozen — captured at the moment
 * the observation was ingested — and nothing in this file recomputes a score,
 * reads live signals, or consults a calibration model. Recomputing would leak
 * the outcome into its own input and make every metric below meaningless.
 *
 * See `FrozenPrediction`: it carries only values, never a venue handle or a
 * database client, so there is nothing here to recompute from.
 */

export const ACTIVITY_BANDS = ["quiet", "steady", "busy", "packed"] as const;
export type ActivityBand = (typeof ACTIVITY_BANDS)[number];

/** Representative score for an observed band when no percentage was recorded. */
const BAND_MIDPOINT: Record<ActivityBand, number> = {
  quiet: 15,
  steady: 45,
  busy: 75,
  packed: 95,
};

/** A venue at or above this predicted score is being presented as hot. */
export const HOT_THRESHOLD = 76;
/** An observation at or above this is genuinely busy. */
export const ACTUALLY_BUSY_THRESHOLD = 70;

/**
 * A prediction as it was published, captured before its observation existed.
 * Deliberately plain data. There is no venue reference and no client here, so
 * this type cannot be used to recompute a score during evaluation.
 */
export type FrozenPrediction = {
  venueId: string;
  score: number;
  mode: "live" | "forecast" | "unknown";
  confidence: "low" | "medium" | "high" | "unknown";
  trend?: "rising" | "steady" | "cooling" | "unknown";
  scoreVersion: string;
  calibrationVersion?: string;
  predictedAt: string;
  /** Minutes between the prediction and the moment it was predicted *for*. */
  forecastHorizonMinutes?: number;
  /** Distinct signal families that backed the prediction. */
  sourceFamilies?: string[];
  /**
   * Per-family point contributions as published. Frozen so ablation can ask
   * what the score would have been without a given signal, using arithmetic on
   * this record rather than a recomputation that would see the outcome.
   */
  factors?: FrozenFactor[];
};

/** One signal family's contribution to a published score. */
export type FrozenFactor = {
  family: string;
  label?: string;
  points: number;
  source?: string;
};

export type Observation = {
  venueId: string;
  observedAt: string;
  band: ActivityBand;
  occupancyPct?: number | null;
  observerType?: string;
  trend?: "rising" | "steady" | "cooling" | "unknown";
};

export type EvaluatedSample = {
  venueId: string;
  observedAt: string;
  nightKey: string;
  localHour: number;
  localDayOfWeek: number;
  predicted: number;
  observed: number;
  predictedBand: ActivityBand;
  observedBand: ActivityBand;
  error: number;
  absoluteError: number;
  bandCorrect: boolean;
  withinOneBand: boolean;
  trendCorrect: boolean | null;
  falseHot: boolean;
  falseQuiet: boolean;
  mode: FrozenPrediction["mode"];
  confidence: FrozenPrediction["confidence"];
  scoreVersion: string;
  calibrationVersion: string;
  forecastHorizonMinutes: number | null;
  sourceFamilyCount: number;
  /** Families that contributed points to this prediction. */
  contributingFamilies: string[];
};

export function scoreToBand(score: number): ActivityBand {
  if (score >= 85) return "packed";
  if (score >= 60) return "busy";
  if (score >= 30) return "steady";
  return "quiet";
}

export function observedValue(observation: Observation) {
  // occupancy_pct is nullable in the database and most observations are
  // band-only. Number(null) is 0, not NaN, so a plain isFinite check would read
  // every band-only observation as a dead room and invent enormous errors.
  if (observation.occupancyPct === null || observation.occupancyPct === undefined) {
    return BAND_MIDPOINT[observation.band];
  }
  const pct = Number(observation.occupancyPct);
  return Number.isFinite(pct) ? clamp(pct, 0, 100) : BAND_MIDPOINT[observation.band];
}

const clamp = (value: number, min: number, max: number) =>
  Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : min;

/**
 * Pair one frozen prediction with the observation that tested it.
 *
 * Returns null when the pair is unusable, rather than guessing. A missing
 * frozen prediction means the observation cannot be scored at all: inventing
 * one now would be the leak this module exists to prevent.
 */
export function evaluateSample(
  prediction: FrozenPrediction,
  observation: Observation,
): EvaluatedSample | null {
  if (prediction.venueId !== observation.venueId) return null;
  if (!Number.isFinite(prediction.score)) return null;
  const observedAt = new Date(observation.observedAt);
  if (Number.isNaN(observedAt.getTime())) return null;

  const predicted = clamp(prediction.score, 0, 100);
  const observed = observedValue(observation);
  const predictedBand = scoreToBand(predicted);
  const error = predicted - observed;
  const { hour, dayOfWeek } = localCalendarIndices(observedAt);

  const predictedIndex = ACTIVITY_BANDS.indexOf(predictedBand);
  const observedIndex = ACTIVITY_BANDS.indexOf(observation.band);

  const presentedHot = predicted >= HOT_THRESHOLD;
  const actuallyBusy = observed >= ACTUALLY_BUSY_THRESHOLD
    || observation.band === "busy"
    || observation.band === "packed";

  const trendCorrect = prediction.trend && observation.trend
    && prediction.trend !== "unknown" && observation.trend !== "unknown"
    ? prediction.trend === observation.trend
    : null;

  return {
    venueId: prediction.venueId,
    observedAt: observedAt.toISOString(),
    nightKey: localNightKey(observedAt),
    localHour: hour,
    localDayOfWeek: dayOfWeek,
    predicted,
    observed,
    predictedBand,
    observedBand: observation.band,
    error,
    absoluteError: Math.abs(error),
    bandCorrect: predictedBand === observation.band,
    withinOneBand: Math.abs(predictedIndex - observedIndex) <= 1,
    trendCorrect,
    falseHot: presentedHot && !actuallyBusy,
    falseQuiet: !presentedHot && actuallyBusy,
    mode: prediction.mode,
    confidence: prediction.confidence,
    scoreVersion: prediction.scoreVersion || "unknown",
    calibrationVersion: prediction.calibrationVersion || "none",
    forecastHorizonMinutes: Number.isFinite(Number(prediction.forecastHorizonMinutes))
      ? Number(prediction.forecastHorizonMinutes)
      : null,
    sourceFamilyCount: new Set(prediction.sourceFamilies || []).size,
    contributingFamilies: [...new Set(
      (prediction.factors || [])
        .filter(factor => Number.isFinite(Number(factor.points)) && Number(factor.points) !== 0)
        .map(factor => factor.family),
    )],
  };
}

function mean(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

const round = (value: number | null, decimals = 2) => {
  if (value === null || !Number.isFinite(value)) return null;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

const ratio = (numerator: number, denominator: number) =>
  denominator > 0 ? round(numerator / denominator, 4) : null;

export type BandPerformance = {
  band: ActivityBand;
  predicted: number;
  actual: number;
  truePositive: number;
  precision: number | null;
  recall: number | null;
};

export type EvaluationSummary = {
  samples: number;
  meanAbsoluteError: number | null;
  medianAbsoluteError: number | null;
  rootMeanSquaredError: number | null;
  bias: number | null;
  bandAccuracy: number | null;
  withinOneBandAccuracy: number | null;
  falseHotRate: number | null;
  falseQuietRate: number | null;
  trendAccuracy: number | null;
  trendSamples: number;
  perBand: BandPerformance[];
};

export function summarize(samples: EvaluatedSample[]): EvaluationSummary {
  const absoluteErrors = samples.map(sample => sample.absoluteError);
  const trendScored = samples.filter(sample => sample.trendCorrect !== null);
  // False-Hot rate is measured against the predictions that actually presented
  // as hot. Dividing by all samples would let a quiet night hide a bad one.
  const hotPredictions = samples.filter(sample => sample.predicted >= HOT_THRESHOLD);
  const notHotPredictions = samples.filter(sample => sample.predicted < HOT_THRESHOLD);

  return {
    samples: samples.length,
    meanAbsoluteError: round(mean(absoluteErrors)),
    medianAbsoluteError: round(median(absoluteErrors)),
    rootMeanSquaredError: round(
      samples.length ? Math.sqrt(mean(samples.map(sample => sample.error ** 2)) as number) : null,
    ),
    bias: round(mean(samples.map(sample => sample.error))),
    bandAccuracy: ratio(samples.filter(sample => sample.bandCorrect).length, samples.length),
    withinOneBandAccuracy: ratio(samples.filter(sample => sample.withinOneBand).length, samples.length),
    falseHotRate: ratio(hotPredictions.filter(sample => sample.falseHot).length, hotPredictions.length),
    falseQuietRate: ratio(notHotPredictions.filter(sample => sample.falseQuiet).length, notHotPredictions.length),
    trendAccuracy: ratio(trendScored.filter(sample => sample.trendCorrect).length, trendScored.length),
    trendSamples: trendScored.length,
    perBand: ACTIVITY_BANDS.map(band => {
      const predicted = samples.filter(sample => sample.predictedBand === band);
      const actual = samples.filter(sample => sample.observedBand === band);
      const truePositive = predicted.filter(sample => sample.observedBand === band).length;
      return {
        band,
        predicted: predicted.length,
        actual: actual.length,
        truePositive,
        precision: ratio(truePositive, predicted.length),
        recall: ratio(truePositive, actual.length),
      };
    }),
  };
}

export function groupBy<K extends string | number>(
  samples: EvaluatedSample[],
  key: (sample: EvaluatedSample) => K,
) {
  const groups = new Map<K, EvaluatedSample[]>();
  for (const sample of samples) {
    const value = key(sample);
    const existing = groups.get(value);
    if (existing) existing.push(sample);
    else groups.set(value, [sample]);
  }
  return Object.fromEntries(
    [...groups.entries()].map(([name, rows]) => [String(name), summarize(rows)]),
  );
}

/**
 * Reliability of the confidence label: for each level, how accurate were the
 * predictions that claimed it? A high-confidence bucket that is not the most
 * accurate means the label is not earning its name.
 */
export function confidenceCalibration(samples: EvaluatedSample[]) {
  return (["high", "medium", "low", "unknown"] as const).map(level => {
    const rows = samples.filter(sample => sample.confidence === level);
    return {
      confidence: level,
      samples: rows.length,
      meanAbsoluteError: round(mean(rows.map(sample => sample.absoluteError))),
      bandAccuracy: ratio(rows.filter(sample => sample.bandCorrect).length, rows.length),
      falseHotRate: ratio(
        rows.filter(sample => sample.falseHot).length,
        rows.filter(sample => sample.predicted >= HOT_THRESHOLD).length,
      ),
    };
  });
}

export type Split = { training: EvaluatedSample[]; holdout: EvaluatedSample[] };

/**
 * Chronological split. The most recent nights become the holdout so the
 * evaluation answers "would this have worked going forward", which is the only
 * question that matters for a forecast.
 *
 * A random split would scatter observations from one night across both sides
 * and quietly inflate every metric, because the same night's conditions would
 * appear in training and holdout at once.
 */
export function timeBasedSplit(samples: EvaluatedSample[], holdoutFraction = 0.3): Split {
  const nights = [...new Set(samples.map(sample => sample.nightKey))].sort();
  if (nights.length < 2) return { training: samples, holdout: [] };

  const holdoutCount = Math.max(1, Math.round(nights.length * clamp(holdoutFraction, 0.05, 0.95)));
  const holdoutNights = new Set(nights.slice(-holdoutCount));

  return {
    training: samples.filter(sample => !holdoutNights.has(sample.nightKey)),
    holdout: samples.filter(sample => holdoutNights.has(sample.nightKey)),
  };
}

/**
 * One fold per night, each holding that whole night out. Better than a
 * chronological split on small datasets, where a single holdout window may
 * contain only a handful of observations.
 */
export function leaveOneNightOut(samples: EvaluatedSample[]): Split[] {
  const nights = [...new Set(samples.map(sample => sample.nightKey))].sort();
  if (nights.length < 2) return [];
  return nights.map(night => ({
    training: samples.filter(sample => sample.nightKey !== night),
    holdout: samples.filter(sample => sample.nightKey === night),
  }));
}

/** Nights, venues and observation counts backing a result set. */
export function coverage(samples: EvaluatedSample[]) {
  return {
    samples: samples.length,
    venues: new Set(samples.map(sample => sample.venueId)).size,
    nights: new Set(samples.map(sample => sample.nightKey)).size,
  };
}
