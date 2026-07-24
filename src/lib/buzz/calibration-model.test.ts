import assert from "node:assert/strict";
import test from "node:test";
import { applyCalibration, buildCalibrationFeatures, emptyCalibrationModel } from "./calibration-model";
import type { BuzzSignal, VenueForBuzz } from "./types";

const venue: VenueForBuzz = { id: "v1", name: "Venue One", ai_score: 55 };
const signals: BuzzSignal[] = [{
  source: "tomtom",
  family: "mobility",
  type: "traffic_congestion",
  value: 80,
  isLive: false,
  confidence: 0.8,
  observedAt: "2026-07-23T00:00:00Z",
  expiresAt: "2026-07-23T01:00:00Z",
}];

test("builds venue, calendar, family and source calibration features", () => {
  const features = buildCalibrationFeatures(venue, signals, 62, new Date("2026-07-23T04:00:00Z"));
  assert.equal(features.venueId, "v1");
  assert.equal(features.baseScore, 62);
  assert.ok(Math.abs((features.familyStrength.mobility ?? 0) - 0.64) < 1e-9);
  assert.ok(Math.abs((features.sourceStrength.tomtom ?? 0) - 0.64) < 1e-9);
});

test("derives calendar features in Hampton Roads local time", () => {
  // 04:00 UTC Thursday is midnight EDT Thursday.
  const features = buildCalibrationFeatures(venue, signals, 62, new Date("2026-07-23T04:00:00Z"));
  assert.equal(features.hour, 0);
  assert.equal(features.dayOfWeek, 4);
  assert.equal(features.month, 6);
});

test("does not apply an untrained calibration model", () => {
  const features = buildCalibrationFeatures(venue, signals, 62);
  const result = applyCalibration(emptyCalibrationModel(), features);
  assert.deepEqual(result, { score: 62, adjustment: 0, applied: false });
});

test("applies bounded venue, calendar and signal corrections", () => {
  const model = emptyCalibrationModel();
  model.trainingRows = 30;
  model.intercept = 2;
  model.venueOffsets.v1 = 4;
  model.hourOffsets[0] = 3;
  model.dayOfWeekOffsets[4] = 2;
  model.monthOffsets[6] = 1;
  model.sourceFamilyWeights.mobility = 2;
  model.sourceWeights.tomtom = 1;
  const features = buildCalibrationFeatures(venue, signals, 62, new Date("2026-07-23T04:00:00Z"));
  const result = applyCalibration(model, features);
  assert.equal(result.applied, true);
  // 2 intercept + 3 hour + 2 weekday + 1 month + 4 venue
  // + (2 x 0.64 mobility) + (1 x 0.64 tomtom) = 13.92 on a base of 62.
  assert.equal(result.adjustment, 13.92);
  assert.equal(result.score, 76);
});

test("clamps a runaway model to a bounded adjustment", () => {
  const model = emptyCalibrationModel();
  model.trainingRows = 500;
  model.intercept = 999;
  model.venueOffsets.v1 = 999;
  const features = buildCalibrationFeatures(venue, signals, 50);
  const result = applyCalibration(model, features);
  assert.equal(result.adjustment, 20, "adjustment is capped at +/-20 points");
  assert.equal(result.score, 70);
});

test("never returns a score outside the public 0-100 range", () => {
  const model = emptyCalibrationModel();
  model.trainingRows = 500;
  model.intercept = -999;
  const features = buildCalibrationFeatures(venue, signals, 5);
  assert.equal(applyCalibration(model, features).score, 0);
});
