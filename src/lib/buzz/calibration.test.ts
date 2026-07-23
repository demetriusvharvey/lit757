import assert from "node:assert/strict";
import test from "node:test";
import { buildCalibrationProfile, calibrationSignal } from "./calibration";

test("learns venue, hour, day, and seasonal correction from ground truth", () => {
  const now = new Date("2026-07-24T22:00:00Z");
  const samples = Array.from({ length: 12 }, (_, index) => ({
    predictedScore: 55 + (index % 3),
    actualScore: 72 + (index % 2),
    observedAt: new Date(Date.UTC(2026, 6, 3 + index * 7, 22, 0, 0)).toISOString(),
  }));
  const profile = buildCalibrationProfile({ id: "v1", name: "Venue" }, samples, now);
  assert.equal(profile.sampleCount, 12);
  assert.ok(profile.venueAdjustment > 0);
  assert.ok(profile.hourAdjustment > 0);
  assert.ok(profile.dayAdjustment > 0);
  assert.ok(profile.seasonalAdjustment > 0);
  assert.ok(profile.confidenceWeight > 0.5);
});

test("does not emit a calibration signal before two verified samples", () => {
  const profile = buildCalibrationProfile({ id: "v1", name: "Venue" }, [{
    predictedScore: 60,
    actualScore: 80,
    observedAt: "2026-07-24T22:00:00Z",
  }]);
  assert.equal(calibrationSignal(profile), null);
});

test("caps learned corrections so small beta datasets cannot destabilize scores", () => {
  const samples = Array.from({ length: 30 }, (_, index) => ({
    predictedScore: 5,
    actualScore: 100,
    observedAt: new Date(Date.UTC(2026, 6, 1 + index, 22, 0, 0)).toISOString(),
  }));
  const signal = calibrationSignal(buildCalibrationProfile({ id: "v1", name: "Venue" }, samples, new Date("2026-07-24T22:00:00Z")));
  assert.ok(signal);
  assert.ok(signal.value <= 18);
  assert.ok(signal.value >= -18);
  assert.equal(signal.isLive, false);
  assert.equal(signal.type, "calibration_adjustment");
});
