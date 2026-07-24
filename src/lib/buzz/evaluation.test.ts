import assert from "node:assert/strict";
import test from "node:test";
import {
  ACTIVITY_BANDS,
  coverage,
  confidenceCalibration,
  evaluateSample,
  groupBy,
  leaveOneNightOut,
  observedValue,
  scoreToBand,
  summarize,
  timeBasedSplit,
  type FrozenPrediction,
  type Observation,
} from "./evaluation";

function prediction(overrides: Partial<FrozenPrediction> = {}): FrozenPrediction {
  return {
    venueId: "v1",
    score: 80,
    mode: "forecast",
    confidence: "medium",
    scoreVersion: "buzz-v2",
    predictedAt: "2026-07-18T01:00:00Z",
    ...overrides,
  };
}

function observation(overrides: Partial<Observation> = {}): Observation {
  return {
    venueId: "v1",
    observedAt: "2026-07-18T02:00:00Z",
    band: "packed",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Leakage regressions. These exist to prove an observation can never influence
// the prediction it is grading.
// ---------------------------------------------------------------------------

test("evaluation cannot recompute a score: the frozen prediction carries only values", () => {
  const frozen = prediction({ score: 80 });
  const sample = evaluateSample(frozen, observation({ band: "quiet", occupancyPct: 10 }));

  assert.ok(sample);
  assert.equal(sample.predicted, 80, "the published score is graded, not a fresh one");
  // A venue handle or db client on the frozen prediction would make silent
  // recomputation possible. There must be nothing here to recompute from.
  for (const key of Object.keys(frozen)) {
    assert.ok(
      !["venue", "db", "client", "supabase", "signals", "recompute"].includes(key),
      `FrozenPrediction must not expose "${key}"`,
    );
  }
});

test("grading a prediction does not mutate it or the observation", () => {
  const frozen = prediction({ score: 80 });
  const observed = observation({ band: "quiet", occupancyPct: 5 });
  const frozenBefore = JSON.stringify(frozen);
  const observedBefore = JSON.stringify(observed);

  evaluateSample(frozen, observed);

  assert.equal(JSON.stringify(frozen), frozenBefore, "prediction was mutated during evaluation");
  assert.equal(JSON.stringify(observed), observedBefore, "observation was mutated during evaluation");
});

test("a later, better prediction cannot retroactively improve an earlier verdict", () => {
  // Calibration improving the model must never change what was already graded.
  const original = evaluateSample(prediction({ score: 80 }), observation({ band: "quiet", occupancyPct: 10 }));
  const recalibrated = evaluateSample(prediction({ score: 12 }), observation({ band: "quiet", occupancyPct: 10 }));

  assert.equal(original?.absoluteError, 70);
  assert.equal(recalibrated?.absoluteError, 2);
  assert.equal(original?.predicted, 80, "the earlier verdict still reflects what was published");
});

test("an observation with no frozen prediction is dropped, never imputed", () => {
  assert.equal(evaluateSample(prediction({ score: Number.NaN }), observation()), null);
  assert.equal(evaluateSample(prediction({ venueId: "other" }), observation()), null);
  assert.equal(evaluateSample(prediction(), observation({ observedAt: "not-a-date" })), null);
});

test("held-out nights never appear in training", () => {
  const samples = ["2026-07-04", "2026-07-11", "2026-07-18", "2026-07-25"].flatMap(day =>
    [0, 1].map(index => evaluateSample(
      prediction({ venueId: `v${index}` }),
      observation({ venueId: `v${index}`, observedAt: `${day}T02:00:00Z` }),
    )!),
  );

  const { training, holdout } = timeBasedSplit(samples, 0.5);
  const trainingNights = new Set(training.map(sample => sample.nightKey));

  assert.ok(holdout.length > 0 && training.length > 0);
  for (const sample of holdout) {
    assert.ok(!trainingNights.has(sample.nightKey), `night ${sample.nightKey} leaked into training`);
  }
  assert.equal(training.length + holdout.length, samples.length, "no sample is lost or duplicated");
});

test("leave-one-night-out never grades a night it trained on", () => {
  const samples = ["2026-07-04", "2026-07-11", "2026-07-18"].map(day =>
    evaluateSample(prediction(), observation({ observedAt: `${day}T02:00:00Z` }))!,
  );

  const folds = leaveOneNightOut(samples);
  assert.equal(folds.length, 3);
  for (const fold of folds) {
    const heldNights = new Set(fold.holdout.map(sample => sample.nightKey));
    for (const sample of fold.training) {
      assert.ok(!heldNights.has(sample.nightKey), "a held-out night appeared in its own training fold");
    }
  }
});

// ---------------------------------------------------------------------------
// Night attribution
// ---------------------------------------------------------------------------

test("a 2am observation belongs to the night before", () => {
  // 02:00 UTC Saturday is 22:00 EDT Friday; 05:00 UTC Saturday is 01:00 EDT
  // Saturday, still Friday night to anyone who was there.
  const fridayEvening = evaluateSample(prediction(), observation({ observedAt: "2026-07-18T02:00:00Z" }))!;
  const afterMidnight = evaluateSample(prediction(), observation({ observedAt: "2026-07-18T05:00:00Z" }))!;

  assert.equal(fridayEvening.nightKey, afterMidnight.nightKey, "one night, one key");
  assert.equal(fridayEvening.nightKey, "2026-07-17");
});

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

test("scoreToBand covers the full range", () => {
  assert.equal(scoreToBand(95), "packed");
  assert.equal(scoreToBand(85), "packed");
  assert.equal(scoreToBand(70), "busy");
  assert.equal(scoreToBand(45), "steady");
  assert.equal(scoreToBand(0), "quiet");
});

test("observed value prefers a recorded percentage over the band midpoint", () => {
  assert.equal(observedValue({ venueId: "v1", observedAt: "", band: "busy", occupancyPct: 63 }), 63);
  assert.equal(observedValue({ venueId: "v1", observedAt: "", band: "busy" }), 75);
  assert.equal(observedValue({ venueId: "v1", observedAt: "", band: "busy", occupancyPct: null }), 75);
});

test("a hot prediction on a dead night is a false Hot", () => {
  const sample = evaluateSample(prediction({ score: 90 }), observation({ band: "quiet", occupancyPct: 8 }))!;
  assert.equal(sample.falseHot, true);
  assert.equal(sample.falseQuiet, false);
  assert.equal(sample.absoluteError, 82);
});

test("a quiet prediction on a packed night is a false Quiet", () => {
  const sample = evaluateSample(prediction({ score: 20 }), observation({ band: "packed", occupancyPct: 95 }))!;
  assert.equal(sample.falseQuiet, true);
  assert.equal(sample.falseHot, false);
});

test("false-Hot rate is measured against predictions that presented as hot", () => {
  // One bad hot call among two hot calls is a 50% false-Hot rate, regardless of
  // how many quiet predictions happen to sit alongside them.
  const samples = [
    evaluateSample(prediction({ score: 90 }), observation({ band: "quiet", occupancyPct: 10 }))!,
    evaluateSample(prediction({ score: 90 }), observation({ band: "packed", occupancyPct: 95 }))!,
    ...Array.from({ length: 20 }, () =>
      evaluateSample(prediction({ score: 10 }), observation({ band: "quiet", occupancyPct: 10 }))!,
    ),
  ];

  assert.equal(summarize(samples).falseHotRate, 0.5);
});

test("summary reports central tendency, spread and direction", () => {
  // Errors of +10, +20 and -10 against an observed 40.
  const samples = [
    evaluateSample(prediction({ score: 50 }), observation({ band: "steady", occupancyPct: 40 }))!,
    evaluateSample(prediction({ score: 60 }), observation({ band: "steady", occupancyPct: 40 }))!,
    evaluateSample(prediction({ score: 30 }), observation({ band: "steady", occupancyPct: 40 }))!,
  ];
  const summary = summarize(samples);

  assert.equal(summary.samples, 3);
  assert.equal(summary.meanAbsoluteError, 13.33, "(10 + 20 + 10) / 3");
  assert.equal(summary.medianAbsoluteError, 10, "median of 10, 10, 20");
  assert.equal(summary.rootMeanSquaredError, 14.14, "sqrt(600 / 3), punishing the large miss");
  assert.equal(summary.bias, 6.67, "(10 + 20 - 10) / 3, so the model runs hot");
});

test("median absolute error resists a single catastrophic miss", () => {
  // Why both are reported: the mean chases the outlier, the median does not.
  const samples = [
    ...Array.from({ length: 9 }, () =>
      evaluateSample(prediction({ score: 45 }), observation({ band: "steady", occupancyPct: 40 }))!,
    ),
    evaluateSample(prediction({ score: 100 }), observation({ band: "quiet", occupancyPct: 0 }))!,
  ];
  const summary = summarize(samples);

  assert.equal(summary.medianAbsoluteError, 5);
  assert.ok(summary.meanAbsoluteError !== null && summary.meanAbsoluteError > 12);
});

test("an empty set yields nulls rather than zeros", () => {
  const summary = summarize([]);
  assert.equal(summary.samples, 0);
  assert.equal(summary.meanAbsoluteError, null, "zero error would imply perfect accuracy");
  assert.equal(summary.bandAccuracy, null);
  assert.equal(summary.falseHotRate, null);
});

test("per-band precision and recall are reported for every band", () => {
  const samples = [
    evaluateSample(prediction({ score: 90 }), observation({ band: "packed", occupancyPct: 95 }))!,
    evaluateSample(prediction({ score: 90 }), observation({ band: "quiet", occupancyPct: 10 }))!,
  ];
  const summary = summarize(samples);

  assert.equal(summary.perBand.length, ACTIVITY_BANDS.length);
  const packed = summary.perBand.find(entry => entry.band === "packed")!;
  assert.equal(packed.predicted, 2);
  assert.equal(packed.truePositive, 1);
  assert.equal(packed.precision, 0.5);
  assert.equal(packed.recall, 1);
});

test("trend accuracy only counts samples where both trends are known", () => {
  const samples = [
    evaluateSample(
      prediction({ trend: "rising" }),
      observation({ trend: "rising" }),
    )!,
    evaluateSample(
      prediction({ trend: "rising" }),
      observation({ trend: "cooling" }),
    )!,
    evaluateSample(prediction(), observation())!,
  ];
  const summary = summarize(samples);

  assert.equal(summary.trendSamples, 2, "the untracked pair is excluded");
  assert.equal(summary.trendAccuracy, 0.5);
});

test("confidence calibration exposes whether high confidence earns its name", () => {
  const samples = [
    evaluateSample(prediction({ confidence: "high", score: 90 }), observation({ band: "packed", occupancyPct: 92 }))!,
    evaluateSample(prediction({ confidence: "low", score: 90 }), observation({ band: "quiet", occupancyPct: 10 }))!,
  ];
  const rows = confidenceCalibration(samples);
  const high = rows.find(row => row.confidence === "high")!;
  const low = rows.find(row => row.confidence === "low")!;

  assert.equal(high.samples, 1);
  assert.equal(high.meanAbsoluteError, 2);
  assert.equal(low.meanAbsoluteError, 80);
});

test("grouping splits samples without losing any", () => {
  const samples = [
    evaluateSample(prediction({ venueId: "a" }), observation({ venueId: "a" }))!,
    evaluateSample(prediction({ venueId: "b" }), observation({ venueId: "b" }))!,
    evaluateSample(prediction({ venueId: "b" }), observation({ venueId: "b" }))!,
  ];
  const byVenue = groupBy(samples, sample => sample.venueId);

  assert.equal(byVenue.a.samples, 1);
  assert.equal(byVenue.b.samples, 2);
});

test("coverage counts venues and nights, not just rows", () => {
  const samples = [
    evaluateSample(prediction({ venueId: "a" }), observation({ venueId: "a", observedAt: "2026-07-18T02:00:00Z" }))!,
    evaluateSample(prediction({ venueId: "a" }), observation({ venueId: "a", observedAt: "2026-07-18T05:00:00Z" }))!,
    evaluateSample(prediction({ venueId: "b" }), observation({ venueId: "b", observedAt: "2026-07-25T02:00:00Z" }))!,
  ];

  assert.deepEqual(coverage(samples), { samples: 3, venues: 2, nights: 2 });
});

test("a single night cannot be split", () => {
  const samples = [evaluateSample(prediction(), observation())!];
  assert.deepEqual(timeBasedSplit(samples).holdout, [], "nothing to hold out from one night");
  assert.deepEqual(leaveOneNightOut(samples), [], "no folds are possible");
});
