import { localParts } from "./local-time";
import type { BuzzSignal, VenueForBuzz } from "./types";

export type BuzzCalibrationProfile = {
  sampleCount: number;
  effectiveSampleSize: number;
  meanAbsoluteError: number;
  signedBias: number;
  venueAdjustment: number;
  hourAdjustment: number;
  dayAdjustment: number;
  seasonalAdjustment: number;
  recentAdjustment: number;
  confidenceWeight: number;
};

export type BuzzGroundTruthSample = {
  predictedScore: number;
  actualScore: number;
  observedAt: string;
  weight?: number;
};

type WeightedError = {
  error: number;
  absoluteError: number;
  weight: number;
  observedAt: Date;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function weightedMean(rows: WeightedError[], selector: (row: WeightedError) => number, fallback = 0) {
  const totalWeight = rows.reduce((sum, row) => sum + row.weight, 0);
  if (totalWeight <= 0) return fallback;
  return rows.reduce((sum, row) => sum + selector(row) * row.weight, 0) / totalWeight;
}

function effectiveSize(rows: WeightedError[]) {
  const sum = rows.reduce((total, row) => total + row.weight, 0);
  const squares = rows.reduce((total, row) => total + row.weight ** 2, 0);
  return squares > 0 ? (sum ** 2) / squares : 0;
}

function shrink(value: number, sampleWeight: number, priorWeight: number, cap: number) {
  return clamp(value * (sampleWeight / (sampleWeight + priorWeight)), -cap, cap);
}

function recencyWeight(observedAt: Date, referenceTime: Date) {
  const ageDays = Math.max(0, (referenceTime.getTime() - observedAt.getTime()) / 86_400_000);
  return Math.pow(0.5, ageDays / 75);
}

export function buildCalibrationProfile(
  _venue: VenueForBuzz,
  samples: BuzzGroundTruthSample[],
  referenceTime = new Date(),
): BuzzCalibrationProfile {
  const valid: WeightedError[] = samples
    .map(sample => {
      const predictedScore = Number(sample.predictedScore);
      const actualScore = Number(sample.actualScore);
      const observedAt = new Date(sample.observedAt);
      const baseWeight = clamp(Number(sample.weight ?? 1), 0.1, 1.5);
      const error = actualScore - predictedScore;
      return {
        error,
        absoluteError: Math.abs(error),
        weight: baseWeight * recencyWeight(observedAt, referenceTime),
        observedAt,
      };
    })
    .filter(row => Number.isFinite(row.error) && Number.isFinite(row.observedAt.getTime()) && row.weight > 0);

  const reference = localParts(referenceTime);
  const signedBias = weightedMean(valid, row => row.error);
  const meanAbsoluteError = weightedMean(valid, row => row.absoluteError, 25);
  const effectiveSampleSize = effectiveSize(valid);
  const hourRows = valid.filter(row => localParts(row.observedAt).hour === reference.hour);
  const dayRows = valid.filter(row => localParts(row.observedAt).weekday === reference.weekday);
  const seasonalRows = valid.filter(row => localParts(row.observedAt).month === reference.month);
  const recentCutoff = referenceTime.getTime() - 21 * 86_400_000;
  const recentRows = valid.filter(row => row.observedAt.getTime() >= recentCutoff);

  const venueAdjustment = shrink(signedBias, effectiveSampleSize, 12, 11);
  const hourAdjustment = shrink(weightedMean(hourRows, row => row.error), effectiveSize(hourRows), 7, 6);
  const dayAdjustment = shrink(weightedMean(dayRows, row => row.error), effectiveSize(dayRows), 6, 5);
  const seasonalAdjustment = shrink(weightedMean(seasonalRows, row => row.error), effectiveSize(seasonalRows), 10, 4);
  const recentAdjustment = shrink(weightedMean(recentRows, row => row.error), effectiveSize(recentRows), 8, 5);
  const maturity = clamp(effectiveSampleSize / 20, 0, 1);
  const accuracy = clamp(1 - meanAbsoluteError / 45, 0.2, 1);
  const confidenceWeight = clamp((0.38 + maturity * 0.62) * accuracy, 0.2, 0.98);

  return {
    sampleCount: valid.length,
    effectiveSampleSize: Number(effectiveSampleSize.toFixed(2)),
    meanAbsoluteError: Number(meanAbsoluteError.toFixed(2)),
    signedBias: Number(signedBias.toFixed(2)),
    venueAdjustment: Number(venueAdjustment.toFixed(2)),
    hourAdjustment: Number(hourAdjustment.toFixed(2)),
    dayAdjustment: Number(dayAdjustment.toFixed(2)),
    seasonalAdjustment: Number(seasonalAdjustment.toFixed(2)),
    recentAdjustment: Number(recentAdjustment.toFixed(2)),
    confidenceWeight: Number(confidenceWeight.toFixed(3)),
  };
}

export function calibrationSignal(profile: BuzzCalibrationProfile, observedAt = new Date()): BuzzSignal | null {
  if (profile.sampleCount < 2 || profile.effectiveSampleSize < 1.25) return null;
  const totalAdjustment = clamp(
    profile.venueAdjustment
      + profile.hourAdjustment
      + profile.dayAdjustment
      + profile.seasonalAdjustment
      + profile.recentAdjustment,
    -18,
    18,
  );
  const expiresAt = new Date(observedAt.getTime() + 90 * 60_000);
  return {
    source: "buzz_ml",
    family: "historical_learning",
    type: "calibration_adjustment",
    value: totalAdjustment,
    isLive: false,
    confidence: profile.confidenceWeight,
    observedAt: observedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    metadata: {
      model: "weighted-online-residual-v1",
      sampleCount: profile.sampleCount,
      effectiveSampleSize: profile.effectiveSampleSize,
      meanAbsoluteError: profile.meanAbsoluteError,
      signedBias: profile.signedBias,
      venueAdjustment: profile.venueAdjustment,
      hourAdjustment: profile.hourAdjustment,
      dayAdjustment: profile.dayAdjustment,
      seasonalAdjustment: profile.seasonalAdjustment,
      recentAdjustment: profile.recentAdjustment,
    },
  };
}
