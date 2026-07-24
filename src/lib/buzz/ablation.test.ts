import assert from "node:assert/strict";
import test from "node:test";
import {
  ablate,
  ablationReport,
  ABLATION_SCENARIOS,
  MINIMUM_ABLATION_SAMPLES,
  runAblation,
  type PredictionObservation,
} from "./ablation";
import type { FrozenPrediction, Observation } from "./evaluation";

function prediction(overrides: Partial<FrozenPrediction> = {}): FrozenPrediction {
  return {
    venueId: "v1",
    score: 80,
    mode: "forecast",
    confidence: "medium",
    scoreVersion: "buzz-v3",
    predictedAt: "2026-07-18T01:00:00Z",
    sourceFamilies: ["prior", "mobility"],
    factors: [
      { family: "prior", label: "Baseline", points: 50 },
      { family: "mobility", label: "Traffic", points: 30 },
    ],
    ...overrides,
  };
}

function observation(overrides: Partial<Observation> = {}): Observation {
  return { venueId: "v1", observedAt: "2026-07-18T02:00:00Z", band: "steady", occupancyPct: 50, ...overrides };
}

/** n pairs where traffic contributed `trafficPoints` and the room was `observed` busy. */
function pairs(count: number, trafficPoints: number, observedPct: number): PredictionObservation[] {
  return Array.from({ length: count }, (_, index) => ({
    prediction: prediction({
      score: 50 + trafficPoints,
      factors: [
        { family: "prior", label: "Baseline", points: 50 },
        { family: "mobility", label: "Traffic", points: trafficPoints },
      ],
    }),
    observation: observation({
      observedAt: `2026-07-${String(4 + (index % 20)).padStart(2, "0")}T02:00:00Z`,
      occupancyPct: observedPct,
      band: observedPct >= 70 ? "busy" : "steady",
    }),
  }));
}

test("ablation subtracts a family's points from the published score", () => {
  const ablated = ablate(prediction(), ["mobility"]);
  assert.ok(ablated);
  assert.equal(ablated.score, 50, "80 published minus 30 from traffic");
  assert.deepEqual(ablated.factors?.map(factor => factor.family), ["prior"]);
  assert.deepEqual(ablated.sourceFamilies, ["prior"]);
});

test("ablation never recomputes: it only rearranges the frozen record", () => {
  const original = prediction();
  const before = JSON.stringify(original);
  ablate(original, ["mobility"]);
  assert.equal(JSON.stringify(original), before, "the frozen prediction was mutated");
});

test("removing a family that contributed nothing is a no-op, not a zero delta", () => {
  // Counting untouched predictions would dilute every delta toward zero and
  // make a useless signal look harmless.
  assert.equal(ablate(prediction(), ["event_forecast"]), null);
  assert.equal(ablate(prediction({ factors: [] }), ["mobility"]), null);
});

test("an ablated score stays inside the public range", () => {
  const ablated = ablate(prediction({
    score: 20,
    factors: [{ family: "mobility", label: "Traffic", points: 90 }],
  }), ["mobility"]);
  assert.equal(ablated?.score, 0, "cannot fall below zero");
});

test("a signal that moves predictions toward reality reads as helping", () => {
  // Baseline 50 plus 25 of traffic lands on an observed 75. Removing traffic
  // leaves 50, which is 25 off.
  const result = runAblation(pairs(30, 25, 75), "without_traffic", ["mobility"]);

  assert.equal(result.affectedSamples, 30);
  assert.equal(result.baseline.meanAbsoluteError, 0);
  assert.equal(result.ablated.meanAbsoluteError, 25);
  assert.equal(result.meanAbsoluteErrorDelta, 25, "error rises without it");
  assert.equal(result.verdict, "helps");
});

test("a signal that pushes predictions away from reality reads as hurting", () => {
  // Baseline 50 matches an observed 50; traffic adds 30 of pure noise.
  const result = runAblation(pairs(30, 30, 50), "without_traffic", ["mobility"]);

  assert.equal(result.baseline.meanAbsoluteError, 30);
  assert.equal(result.ablated.meanAbsoluteError, 0);
  assert.equal(result.meanAbsoluteErrorDelta, -30, "error falls without it");
  assert.equal(result.verdict, "hurts");
});

test("a thin sample refuses to render a verdict", () => {
  const result = runAblation(pairs(MINIMUM_ABLATION_SAMPLES - 1, 25, 75), "without_traffic", ["mobility"]);
  assert.equal(result.verdict, "insufficient_data");
  assert.ok(result.affectedSamples < MINIMUM_ABLATION_SAMPLES);
});

test("a signal that helps as often as it hurts is neutral, not a finding", () => {
  // Traffic adds one point. On half the nights that point closes the gap, on
  // the other half it opens one. The deltas cancel, so there is no finding.
  const build = (observedPct: number, index: number): PredictionObservation => ({
    prediction: prediction({
      score: 51,
      factors: [
        { family: "prior", label: "Baseline", points: 50 },
        { family: "mobility", label: "Traffic", points: 1 },
      ],
    }),
    observation: observation({
      observedAt: `2026-07-${String(4 + (index % 20)).padStart(2, "0")}T02:00:00Z`,
      occupancyPct: observedPct,
      band: "steady",
    }),
  });

  const result = runAblation(
    [
      ...Array.from({ length: 15 }, (_, index) => build(51, index)),
      ...Array.from({ length: 15 }, (_, index) => build(49, index)),
    ],
    "without_traffic",
    ["mobility"],
  );

  assert.equal(result.meanAbsoluteErrorDelta, 0);
  assert.equal(result.verdict, "neutral");
});

test("baseline and ablated summaries always cover the same observations", () => {
  const result = runAblation(pairs(30, 25, 75), "without_traffic", ["mobility"]);
  assert.equal(
    result.baseline.samples,
    result.ablated.samples,
    "comparing different sample sets would make the delta meaningless",
  );
});

test("a noisy signal that inflates scores shows up as suppressing nothing", () => {
  // Traffic pushes every prediction to 90 on rooms that were quiet: pure false Hot.
  const noisy = Array.from({ length: 30 }, (_, index) => ({
    prediction: prediction({
      score: 90,
      factors: [
        { family: "prior", label: "Baseline", points: 20 },
        { family: "mobility", label: "Traffic", points: 70 },
      ],
    }),
    observation: observation({
      observedAt: `2026-07-${String(4 + (index % 20)).padStart(2, "0")}T02:00:00Z`,
      band: "quiet",
      occupancyPct: 10,
    }),
  }));

  const result = runAblation(noisy, "without_traffic", ["mobility"]);
  assert.equal(result.baseline.falseHotRate, 1, "every hot call was wrong");
  assert.equal(result.ablated.falseHotRate, null, "nothing presents as hot once traffic is removed");
  assert.equal(result.verdict, "hurts");
});

test("the report answers the scenarios the accuracy brief asks about", () => {
  const report = ablationReport(pairs(30, 25, 75));
  const names = report.scenarios.map(scenario => scenario.scenario);

  for (const expected of Object.keys(ABLATION_SCENARIOS)) {
    assert.ok(names.includes(expected), `missing scenario ${expected}`);
  }
  assert.equal(report.totalPairs, 30);
  assert.ok(report.note.includes("insufficient_data"), "the report explains its own limits");
});

test("the report names signals that are adding noise", () => {
  const report = ablationReport(pairs(30, 30, 50));
  assert.ok(report.addingNoise.includes("mobility"), "a purely noisy signal is called out");
});

test("families that never contributed are reported as insufficient data, not as clean", () => {
  const report = ablationReport(pairs(30, 25, 75));
  const eventForecast = report.perFamily.find(result => result.scenario === "event_forecast")!;

  assert.equal(eventForecast.affectedSamples, 0);
  assert.equal(eventForecast.verdict, "insufficient_data");
  assert.ok(!report.addingNoise.includes("event_forecast"), "absence is not evidence of noise");
});
