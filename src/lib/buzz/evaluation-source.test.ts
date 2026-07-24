import assert from "node:assert/strict";
import test from "node:test";
import {
  evidenceBucket,
  horizonBucket,
  loadPairs,
  toPredictionObservation,
  type GroundTruthRow,
} from "./evaluation-source";

function row(overrides: Partial<GroundTruthRow> = {}): GroundTruthRow {
  return {
    venue_id: "v1",
    observed_at: "2026-07-18T02:00:00Z",
    occupancy_band: "busy",
    occupancy_pct: 78,
    observer_type: "trusted_field_observer",
    metadata: {
      predictedScore: 72,
      predictedMode: "forecast",
      predictedConfidence: "medium",
      predictedVersion: "buzz-v3",
      predictedAt: "2026-07-18T01:00:00Z",
      predictedSourceFamilies: ["prior", "mobility"],
      predictedFactors: [
        { family: "prior", label: "Baseline", points: 50 },
        { family: "mobility", label: "Traffic", points: 22 },
      ],
    },
    ...overrides,
  };
}

test("reconstructs a prediction only from what was frozen at ingest", () => {
  const pair = toPredictionObservation(row())!;

  assert.equal(pair.prediction.score, 72);
  assert.equal(pair.prediction.mode, "forecast");
  assert.equal(pair.prediction.confidence, "medium");
  assert.equal(pair.prediction.scoreVersion, "buzz-v3");
  assert.equal(pair.prediction.factors?.length, 2);
  assert.equal(pair.observation.band, "busy");
  assert.equal(pair.observation.occupancyPct, 78);
});

test("an observation with no frozen prediction is not graded", () => {
  // These are real observations but ungraded evidence. Inventing a prediction
  // for them, or dropping them from the denominator silently, would both lie.
  assert.equal(toPredictionObservation(row({ metadata: {} })), null);
  assert.equal(toPredictionObservation(row({ metadata: null })), null);
  assert.equal(toPredictionObservation(row({ metadata: { predictedScore: "not a number" } })), null);
});

test("an unrecognised band is rejected rather than coerced", () => {
  assert.equal(toPredictionObservation(row({ occupancy_band: "rammed" })), null);
});

test("forecast horizon is the gap between prediction and observation", () => {
  const pair = toPredictionObservation(row())!;
  assert.equal(pair.prediction.forecastHorizonMinutes, 60);
});

test("a prediction stamped after its observation has no usable horizon", () => {
  const pair = toPredictionObservation(row({
    metadata: { ...row().metadata, predictedAt: "2026-07-18T03:00:00Z" },
  }))!;
  assert.equal(pair.prediction.forecastHorizonMinutes, undefined, "a negative horizon is not reported as zero");
});

test("malformed factors are discarded without discarding the prediction", () => {
  const pair = toPredictionObservation(row({
    metadata: {
      ...row().metadata,
      predictedFactors: [
        { family: "prior", points: 50 },
        { family: "mobility", points: "lots" },
        { label: "no family", points: 5 },
        "not an object",
      ],
    },
  }))!;

  assert.equal(pair.prediction.factors?.length, 1);
  assert.equal(pair.prediction.factors?.[0].family, "prior");
});

test("unknown mode and confidence degrade to unknown rather than a default", () => {
  const pair = toPredictionObservation(row({
    metadata: { predictedScore: 50, predictedMode: "guess", predictedConfidence: "very" },
  }))!;

  assert.equal(pair.prediction.mode, "unknown");
  assert.equal(pair.prediction.confidence, "unknown");
  assert.equal(pair.prediction.scoreVersion, "unknown");
});

test("coverage reports how much of the dataset is actually gradable", () => {
  const { pairs, summary } = loadPairs([
    row(),
    row(),
    row({ metadata: {} }),
    row({ metadata: { predictedScore: 40 } }),
  ]);

  assert.equal(pairs.length, 3);
  assert.equal(summary.rows, 4);
  assert.equal(summary.graded, 3);
  assert.equal(summary.ungraded, 1);
  assert.equal(summary.coverage, 0.75);
  assert.equal(summary.withFrozenFactors, 2, "only the rows carrying factors can drive ablation");
});

test("an empty dataset reports null coverage, not full coverage", () => {
  const { summary } = loadPairs([]);
  assert.equal(summary.coverage, null);
  assert.equal(summary.graded, 0);
});

test("horizon buckets separate near-term from long-range forecasts", () => {
  assert.equal(horizonBucket(0), "0-15m");
  assert.equal(horizonBucket(15), "0-15m");
  assert.equal(horizonBucket(45), "15-60m");
  assert.equal(horizonBucket(120), "1-3h");
  assert.equal(horizonBucket(600), "3h+");
  assert.equal(horizonBucket(null), "unknown");
});

test("evidence buckets distinguish corroborated predictions from lone signals", () => {
  assert.equal(evidenceBucket(0), "none");
  assert.equal(evidenceBucket(1), "single_family");
  assert.equal(evidenceBucket(2), "two_families");
  assert.equal(evidenceBucket(5), "three_plus_families");
});
