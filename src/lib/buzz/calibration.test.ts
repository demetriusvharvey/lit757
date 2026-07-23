import assert from "node:assert/strict";
import test from "node:test";
import { buildCalibrationProfile, calibrationSignal, type BuzzGroundTruthSample } from "./calibration";
import type { VenueForBuzz } from "./types";

const venue: VenueForBuzz = { id: "venue-1", name: "Test Venue", ai_score: 70 };
const now = new Date("2026-07-24T02:00:00.000Z"); // Thu 10 PM ET

function sample(overrides: Partial<BuzzGroundTruthSample> = {}): BuzzGroundTruthSample {
  return {
    predictedScore: 50,
    actualScore: 70,
    observedAt: "2026-07-17T02:00:00.000Z",
    weight: 1,
    ...overrides,
  };
}

test("calibration waits for more than one meaningful observation", () => {
  const profile = buildCalibrationProfile(venue, [sample()], now);
  assert.equal(profile.sampleCount, 1);
  assert.equal(calibrationSignal(profile, now), null);
});

test("weighted online calibration learns venue, hour, weekday, season, and recent behavior", () => {
  const samples = Array.from({ length: 14 }, (_, index) => sample({
    predictedScore: 48 + index % 3,
    actualScore: 72 + index % 4,
    observedAt: new Date(now.getTime() - index * 7 * 86_400_000).toISOString(),
    weight: 0.9,
  }));
  const profile = buildCalibrationProfile(venue, samples, now);
  const signal = calibrationSignal(profile, now);

  assert.ok(profile.effectiveSampleSize >= 8, `effective size was ${profile.effectiveSampleSize}`);
  assert.ok(profile.signedBias > 15, `bias was ${profile.signedBias}`);
  assert.ok(profile.venueAdjustment > 0);
  assert.ok(profile.hourAdjustment > 0);
  assert.ok(profile.dayAdjustment > 0);
  assert.ok(profile.confidenceWeight > 0.45);
  assert.ok(signal);
  assert.equal(signal.family, "historical_learning");
  assert.equal(signal.type, "calibration_adjustment");
  assert.ok(signal.value > 0 && signal.value <= 18, `signal value was ${signal.value}`);
  assert.equal(signal.metadata?.model, "weighted-online-residual-v1");
});

test("recent higher-quality ground truth outweighs stale weak observations", () => {
  const stale = Array.from({ length: 8 }, (_, index) => sample({
    predictedScore: 70,
    actualScore: 40,
    observedAt: new Date(now.getTime() - (150 + index) * 86_400_000).toISOString(),
    weight: 0.35,
  }));
  const recent = Array.from({ length: 8 }, (_, index) => sample({
    predictedScore: 45,
    actualScore: 75,
    observedAt: new Date(now.getTime() - index * 86_400_000).toISOString(),
    weight: 1.2,
  }));
  const profile = buildCalibrationProfile(venue, [...stale, ...recent], now);
  assert.ok(profile.signedBias > 10, `weighted bias was ${profile.signedBias}`);
  assert.ok(profile.recentAdjustment > 0);
});

test("calibration remains bounded even after extreme repeated misses", () => {
  const samples = Array.from({ length: 40 }, (_, index) => sample({
    predictedScore: 5,
    actualScore: 100,
    observedAt: new Date(now.getTime() - index * 86_400_000).toISOString(),
    weight: 1.25,
  }));
  const signal = calibrationSignal(buildCalibrationProfile(venue, samples, now), now);
  assert.ok(signal);
  assert.equal(signal.value, 18);
  assert.ok(Number(signal.metadata?.meanAbsoluteError) > 80);
  assert.ok(signal.confidence < 0.4, `confidence was ${signal.confidence}`);
});
