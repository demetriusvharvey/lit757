import assert from "node:assert/strict";
import test from "node:test";
import { trainCalibrationModel } from "./training";

test("learns conservative global, calendar and venue corrections", () => {
  const rows = [
    { venueId: "v1", predictedScore: 50, actualScore: 70, observedAt: "2026-07-17T22:00:00" },
    { venueId: "v1", predictedScore: 55, actualScore: 75, observedAt: "2026-07-24T22:00:00" },
    { venueId: "v2", predictedScore: 65, actualScore: 55, observedAt: "2026-07-18T20:00:00" },
    { venueId: "v2", predictedScore: 60, actualScore: 50, observedAt: "2026-07-25T20:00:00" },
  ];
  const model = trainCalibrationModel(rows, new Date("2026-07-26T00:00:00Z"));
  assert.equal(model.trainingRows, 4);
  assert.equal(model.trainedAt, "2026-07-26T00:00:00.000Z");
  assert.ok(model.meanAbsoluteError != null && model.meanAbsoluteError > 0);
  assert.ok(model.venueOffsets.v1 > 0);
  assert.ok(model.venueOffsets.v2 < 0);
});

test("ignores malformed rows", () => {
  const model = trainCalibrationModel([
    { venueId: "v1", predictedScore: Number.NaN, actualScore: 80, observedAt: "2026-07-17T22:00:00" },
    { venueId: "v1", predictedScore: 50, actualScore: 80, observedAt: "bad-date" },
  ]);
  assert.equal(model.trainingRows, 0);
  assert.equal(model.meanAbsoluteError, null);
});
