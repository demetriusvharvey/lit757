import type { BuzzSignal, VenueForBuzz } from "./types";

export type BuzzCalibrationProfile = {
  sampleCount: number;
  meanAbsoluteError: number;
  signedBias: number;
  venueAdjustment: number;
  hourAdjustment: number;
  dayAdjustment: number;
  seasonalAdjustment: number;
  confidenceWeight: number;
};

export type BuzzGroundTruthSample = {
  predictedScore: number;
  actualScore: number;
  observedAt: string;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function boundedMean(values: number[], fallback = 0) {
  const clean = values.filter(Number.isFinite);
  if (!clean.length) return fallback;
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

function hourBucket(date: Date) {
  return date.getHours();
}

function monthBucket(date: Date) {
  return date.getMonth();
}

export function buildCalibrationProfile(
  venue: VenueForBuzz,
  samples: BuzzGroundTruthSample[],
  referenceTime = new Date(),
): BuzzCalibrationProfile {
  const valid = samples
    .map(sample => ({
      predictedScore: Number(sample.predictedScore),
      actualScore: Number(sample.actualScore),
      observedAt: new Date(sample.observedAt),
    }))
    .filter(sample => Number.isFinite(sample.predictedScore) && Number.isFinite(sample.actualScore) && Number.isFinite(sample.observedAt.getTime()));

  const errors = valid.map(sample => sample.actualScore - sample.predictedScore);
  const absoluteErrors = errors.map(Math.abs);
  const signedBias = boundedMean(errors);
  const meanAbsoluteError = boundedMean(absoluteErrors, 25);
  const currentHour = hourBucket(referenceTime);
  const currentDay = referenceTime.getDay();
  const currentMonth = monthBucket(referenceTime);

  const hourErrors = valid
    .filter(sample => hourBucket(sample.observedAt) === currentHour)
    .map(sample => sample.actualScore - sample.predictedScore);
  const dayErrors = valid
    .filter(sample => sample.observedAt.getDay() === currentDay)
    .map(sample => sample.actualScore - sample.predictedScore);
  const seasonalErrors = valid
    .filter(sample => monthBucket(sample.observedAt) === currentMonth)
    .map(sample => sample.actualScore - sample.predictedScore);

  const maturity = clamp(valid.length / 25, 0, 1);
  const venueAdjustment = clamp(signedBias * maturity, -12, 12);
  const hourAdjustment = clamp(boundedMean(hourErrors) * clamp(hourErrors.length / 8, 0, 1), -8, 8);
  const dayAdjustment = clamp(boundedMean(dayErrors) * clamp(dayErrors.length / 6, 0, 1), -7, 7);
  const seasonalAdjustment = clamp(boundedMean(seasonalErrors) * clamp(seasonalErrors.length / 10, 0, 1), -5, 5);
  const confidenceWeight = clamp(1 - meanAbsoluteError / 45, 0.35, 1);

  return {
    sampleCount: valid.length,
    meanAbsoluteError: Number(meanAbsoluteError.toFixed(2)),
    signedBias: Number(signedBias.toFixed(2)),
    venueAdjustment: Number(venueAdjustment.toFixed(2)),
    hourAdjustment: Number(hourAdjustment.toFixed(2)),
    dayAdjustment: Number(dayAdjustment.toFixed(2)),
    seasonalAdjustment: Number(seasonalAdjustment.toFixed(2)),
    confidenceWeight: Number(confidenceWeight.toFixed(3)),
  };
}

export function calibrationSignal(profile: BuzzCalibrationProfile, observedAt = new Date()): BuzzSignal | null {
  if (profile.sampleCount < 2) return null;
  const totalAdjustment = clamp(
    profile.venueAdjustment + profile.hourAdjustment + profile.dayAdjustment + profile.seasonalAdjustment,
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
      sampleCount: profile.sampleCount,
      meanAbsoluteError: profile.meanAbsoluteError,
      signedBias: profile.signedBias,
      venueAdjustment: profile.venueAdjustment,
      hourAdjustment: profile.hourAdjustment,
      dayAdjustment: profile.dayAdjustment,
      seasonalAdjustment: profile.seasonalAdjustment,
    },
  };
}
