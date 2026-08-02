import assert from "node:assert/strict";
import test from "node:test";
import {
  activityStatusLabel,
  activityTruthMode,
  districtActivityLabel,
  districtTruthMode,
} from "./truth-labels";

test("unknown truth metadata always defaults to forecast", () => {
  assert.equal(activityTruthMode("live"), "live");
  assert.equal(activityTruthMode("LIVE"), "live");
  assert.equal(activityTruthMode(undefined), "forecast");
  assert.equal(activityTruthMode("unsupported"), "forecast");
});

test("forecast venue labels never claim an observed crowd", () => {
  assert.equal(activityStatusLabel(92, "forecast"), "High Activity Forecast");
  assert.equal(activityStatusLabel(76, undefined), "High Activity Forecast");
  assert.equal(activityStatusLabel(60, "forecast"), "Active Forecast");
  assert.equal(activityStatusLabel(35, "forecast"), "Moderate Forecast");
  assert.equal(activityStatusLabel(10, "forecast"), "Low Forecast");
});

test("live venue labels describe activity without claiming exact occupancy", () => {
  assert.equal(activityStatusLabel(92, "live"), "Strong Live Activity");
  assert.equal(activityStatusLabel(76, "live"), "High Live Activity");
  assert.equal(activityStatusLabel(60, "live"), "Live Activity");
  assert.equal(activityStatusLabel(20, "live"), "Light Live Activity");
});

test("districts become live only from a truth-gated live score snapshot", () => {
  assert.equal(districtTruthMode([]), "forecast");
  assert.equal(districtTruthMode(["forecast", undefined, "raw-live-flag"]), "forecast");
  assert.equal(districtTruthMode(["forecast", "live"]), "live");
  assert.equal(districtActivityLabel(82, "forecast"), "High Forecast");
  assert.equal(districtActivityLabel(86, "live"), "Strong Live Activity");
});
