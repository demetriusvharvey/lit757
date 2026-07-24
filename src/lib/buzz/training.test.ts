import assert from "node:assert/strict";
import test from "node:test";
import { trainCalibrationModel } from "./training";

// 02:00 UTC lands on Friday 22:00 in Hampton Roads; the UTC date is Saturday.
const FRIDAY_NIGHT_UTC = ["2026-07-04", "2026-07-11", "2026-07-18", "2026-07-25"];
// 16:00 UTC lands on Wednesday 12:00 local, same UTC calendar day.
const WEDNESDAY_NOON_UTC = ["2026-07-08", "2026-07-15", "2026-07-22", "2026-07-29"];

const FRIDAY = 5;
const SATURDAY = 6;
const TEN_PM = 22;
const TWO_AM = 2;

test("learns conservative global, calendar and venue corrections", () => {
  const rows = [
    { venueId: "v1", predictedScore: 50, actualScore: 70, observedAt: "2026-07-18T02:00:00Z" },
    { venueId: "v1", predictedScore: 55, actualScore: 75, observedAt: "2026-07-25T02:00:00Z" },
    { venueId: "v2", predictedScore: 65, actualScore: 55, observedAt: "2026-07-19T00:00:00Z" },
    { venueId: "v2", predictedScore: 60, actualScore: 50, observedAt: "2026-07-26T00:00:00Z" },
  ];
  const model = trainCalibrationModel(rows, new Date("2026-07-26T00:00:00Z"));
  assert.equal(model.trainingRows, 4);
  assert.equal(model.trainedAt, "2026-07-26T00:00:00.000Z");
  assert.ok(model.meanAbsoluteError != null && model.meanAbsoluteError > 0);
  assert.ok(model.venueOffsets.v1 > 0, "venue that outperforms its forecast gets a positive offset");
  assert.ok(model.venueOffsets.v2 < 0, "venue that underperforms its forecast gets a negative offset");
});

test("ignores malformed rows", () => {
  const model = trainCalibrationModel([
    { venueId: "v1", predictedScore: Number.NaN, actualScore: 80, observedAt: "2026-07-17T22:00:00Z" },
    { venueId: "v1", predictedScore: 50, actualScore: 80, observedAt: "bad-date" },
  ]);
  assert.equal(model.trainingRows, 0);
  assert.equal(model.meanAbsoluteError, null);
});

test("buckets observations by Hampton Roads local time, not UTC", () => {
  // Bucketing on the raw UTC clock would file these Friday-night observations
  // under Saturday hour 2 and shift every learned offset by the UTC offset.
  const rows = [
    ...FRIDAY_NIGHT_UTC.map(day => ({
      venueId: "v1",
      predictedScore: 50,
      actualScore: 70,
      observedAt: `${day}T02:00:00Z`,
    })),
    ...WEDNESDAY_NOON_UTC.map(day => ({
      venueId: "v2",
      predictedScore: 70,
      actualScore: 50,
      observedAt: `${day}T16:00:00Z`,
    })),
  ];
  const model = trainCalibrationModel(rows);

  assert.equal(model.trainingRows, 8);
  assert.ok(model.hourOffsets[TEN_PM] > 0, "Friday-night residuals land in the 10pm local bucket");
  assert.equal(model.hourOffsets[TWO_AM], 0, "nothing lands in the 2am UTC bucket");
  assert.ok(model.dayOfWeekOffsets[FRIDAY] > 0, "residuals land on local Friday");
  assert.equal(model.dayOfWeekOffsets[SATURDAY], 0, "nothing lands on UTC Saturday");
});

test("keeps every learned offset bounded when the forecast is wildly wrong", () => {
  const rows = [
    ...Array.from({ length: 60 }, (_, index) => ({
      venueId: "v1",
      predictedScore: 0,
      actualScore: 100,
      observedAt: `${FRIDAY_NIGHT_UTC[index % FRIDAY_NIGHT_UTC.length]}T02:00:00Z`,
    })),
    ...Array.from({ length: 60 }, (_, index) => ({
      venueId: "v2",
      predictedScore: 100,
      actualScore: 0,
      observedAt: `${WEDNESDAY_NOON_UTC[index % WEDNESDAY_NOON_UTC.length]}T16:00:00Z`,
    })),
  ];
  const model = trainCalibrationModel(rows);

  assert.ok(Math.abs(model.intercept) <= 12, "intercept stays clamped");
  for (const offset of model.hourOffsets) assert.ok(Math.abs(offset) <= 6, `hour offset ${offset} exceeded its cap`);
  for (const offset of model.dayOfWeekOffsets) assert.ok(Math.abs(offset) <= 6, `day offset ${offset} exceeded its cap`);
  for (const offset of model.monthOffsets) assert.ok(Math.abs(offset) <= 5, `month offset ${offset} exceeded its cap`);
  for (const offset of Object.values(model.venueOffsets)) assert.ok(Math.abs(offset) <= 10, `venue offset ${offset} exceeded its cap`);
});

test("does not learn a venue offset from a single observation", () => {
  const model = trainCalibrationModel([
    { venueId: "v1", predictedScore: 20, actualScore: 90, observedAt: "2026-07-18T02:00:00Z" },
    { venueId: "v2", predictedScore: 50, actualScore: 50, observedAt: "2026-07-15T16:00:00Z" },
    { venueId: "v2", predictedScore: 50, actualScore: 50, observedAt: "2026-07-22T16:00:00Z" },
  ]);
  assert.equal(model.venueOffsets.v1, undefined, "one observation is not enough to correct a venue");
  assert.ok("v2" in model.venueOffsets, "two observations produce an offset");
});
