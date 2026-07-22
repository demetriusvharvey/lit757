import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCoopsUrl,
  coastalActivityImpact,
  normalizeTidePredictions,
  normalizeWaterObservation,
  normalizeWaterTemperature,
  normalizeWind,
} from "./noaa-coops";

test("builds a bounded high-low tide prediction request", () => {
  const url = new URL(buildCoopsUrl("8638863", "predictions", new Date("2026-07-22T12:00:00Z")));
  assert.equal(url.hostname, "api.tidesandcurrents.noaa.gov");
  assert.equal(url.searchParams.get("station"), "8638863");
  assert.equal(url.searchParams.get("product"), "predictions");
  assert.equal(url.searchParams.get("begin_date"), "20260722");
  assert.equal(url.searchParams.get("end_date"), "20260724");
  assert.equal(url.searchParams.get("interval"), "hilo");
  assert.equal(url.searchParams.get("datum"), "MLLW");
});

test("normalizes tide predictions", () => {
  assert.deepEqual(normalizeTidePredictions({
    predictions: [
      { t: "2026-07-22 13:10", v: "2.184", type: "H" },
      { t: "2026-07-22 19:32", v: "0.211", type: "L" },
    ],
  }), [
    { time: "2026-07-22 13:10", heightFeet: 2.184, type: "high" },
    { time: "2026-07-22 19:32", heightFeet: 0.211, type: "low" },
  ]);
});

test("uses the newest coastal observation", () => {
  const payload = {
    data: [
      { t: "2026-07-22 10:00", v: "1.1" },
      { t: "2026-07-22 11:00", v: "1.4" },
    ],
  };
  assert.deepEqual(normalizeWaterObservation(payload), {
    time: "2026-07-22 11:00",
    value: 1.4,
    unit: "feet MLLW",
  });
  assert.deepEqual(normalizeWaterTemperature(payload), {
    time: "2026-07-22 11:00",
    value: 1.4,
    unit: "°F",
  });
});

test("normalizes NOAA wind fields and applies conservative outdoor impact", () => {
  const wind = normalizeWind({
    data: [{ t: "2026-07-22 11:00", s: "24.0", d: "80", dr: "E", g: "33.0" }],
  });
  assert.deepEqual(wind, {
    time: "2026-07-22 11:00",
    speedMph: 24,
    gustMph: 33,
    directionDegrees: 80,
    direction: "E",
  });
  assert.deepEqual(coastalActivityImpact(wind), {
    level: "windy",
    points: -10,
    reason: "Coastal winds 24 mph",
  });
});

test("calm coastal data never boosts venue activity", () => {
  assert.deepEqual(coastalActivityImpact({
    time: "2026-07-22 11:00",
    speedMph: 8,
    gustMph: 12,
    directionDegrees: 120,
    direction: "ESE",
  }), {
    level: "neutral",
    points: 0,
    reason: "No major coastal wind disruption",
  });
});
