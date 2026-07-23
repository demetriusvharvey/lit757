import assert from "node:assert/strict";
import test from "node:test";
import { applyCalibration, buildCalibrationFeatures, confidenceFromCalibration, emptyCalibrationModel } from "./calibration";
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
  const features = buildCalibrationFeatures(venue, signals, 62, new Date("2026-07-23T00:00:00"));
  assert.equal(features.venueId, "v1");
  assert.equal(features.baseScore, 62);
  assert.equal(features.familyStrength.mobility, 0.64);
  assert.equal(features.sourceStrength.tomtom, 0.64);
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
  const features = buildCalibrationFeatures(venue, signals, 62, new Date("2026-07-23T00:00:00"));
  const result = applyCalibration(model, features);
  assert.equal(result.applied, true);
  assert.equal(result.score, 75);
});

test("uses internal model error to improve confidence conservatively", () => {
  const model = emptyCalibrationModel();
  model.trainingRows = 40;
  model.meanAbsoluteError = 9;
  assert.equal(confidenceFromCalibration("medium", model), "high");
  assert.equal(confidenceFromCalibration("low", model), "low");
});
