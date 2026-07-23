import assert from "node:assert/strict";
import test from "node:test";
import { calculateBuzzScore } from "./score-v1";
import type { BuzzSignal, VenueForBuzz } from "./types";

const venue: VenueForBuzz = { id: "venue-1", name: "Test Venue", ai_score: 100 };
const now = new Date("2026-07-22T20:00:00.000Z");

function signal(overrides: Partial<BuzzSignal>): BuzzSignal {
  return {
    source: "test",
    family: "event_forecast",
    type: "predicted_attendance",
    value: 100,
    isLive: false,
    confidence: 1,
    observedAt: "2026-07-22T19:50:00.000Z",
    expiresAt: "2026-07-22T21:00:00.000Z",
    ...overrides,
  };
}

function matureCalibration(value = 0): BuzzSignal {
  return signal({
    source: "buzz_ml",
    family: "historical_learning",
    type: "calibration_adjustment",
    value,
    confidence: 0.9,
    metadata: { effectiveSampleSize: 12, sampleCount: 15, meanAbsoluteError: 8 },
  });
}

test("forecast-only evidence cannot claim live or exceed the conservative cap", () => {
  const result = calculateBuzzScore(venue, [
    signal({ source: "predicthq", family: "event_forecast", type: "predicted_attendance" }),
    signal({ source: "ticketmaster", family: "commercial_demand", type: "ticket_inventory", value: 100 }),
    signal({ source: "tomtom", family: "mobility", type: "traffic_congestion", value: 100 }),
  ], now);
  assert.equal(result.version, "buzz-v3");
  assert.equal(result.mode, "forecast");
  assert.ok(result.score <= 64, `forecast score was ${result.score}`);
  assert.notEqual(result.label, "On Fire");
});

test("one unverified live source cannot claim Heating Up or On Fire", () => {
  const result = calculateBuzzScore(venue, [signal({
    source: "besttime",
    family: "foot_traffic",
    type: "besttime_live",
    value: 100,
    isLive: true,
    confidence: 0.8,
  })], now);
  assert.equal(result.mode, "live");
  assert.ok(result.score <= 74, `single-source score was ${result.score}`);
});

test("independent direct evidence with mature calibration can produce a high-confidence strong score", () => {
  const result = calculateBuzzScore(venue, [
    signal({ source: "venue_partner", family: "first_party_occupancy", type: "partner_pulse", value: 92, isLive: true, confidence: 0.95 }),
    signal({ source: "besttime", family: "foot_traffic", type: "besttime_live", value: 90, isLive: true, confidence: 0.95 }),
    signal({ source: "lit757_users", family: "verified_users", type: "verified_presence", value: 5, isLive: true, confidence: 0.9, metadata: { uniqueDevices: 5 } }),
    matureCalibration(),
  ], now);
  assert.equal(result.mode, "live");
  assert.equal(result.confidence, "high");
  assert.ok(result.score >= 76, `corroborated score was ${result.score}`);
  assert.ok(result.factors.some(factor => factor.family === "corroboration"));
});

test("expired and future-dated evidence is ignored", () => {
  const result = calculateBuzzScore(venue, [
    signal({ expiresAt: "2026-07-22T19:59:00.000Z" }),
    signal({ observedAt: "2026-07-22T20:10:00.000Z", expiresAt: "2026-07-22T21:00:00.000Z" }),
  ], now);
  assert.equal(result.mode, "forecast");
  assert.equal(result.sourceFamilies.length, 0);
  assert.ok(result.score < 20);
});

test("correlated commercial signals are capped instead of fully stacked", () => {
  const result = calculateBuzzScore(venue, [
    signal({ source: "ticketmaster", family: "commercial_demand", type: "ticket_inventory", value: 100 }),
    signal({ source: "reservation", family: "commercial_demand", type: "reservation_inventory", value: 100 }),
  ], now);
  const commercial = result.factors.filter(factor => factor.family === "commercial_demand").reduce((sum, factor) => sum + factor.points, 0);
  assert.ok(commercial <= 22, `commercial family credited ${commercial}`);
});

test("learned corrections remain forecast-only and cannot bypass live truth caps", () => {
  const positive = calculateBuzzScore(venue, [matureCalibration(18)], now);
  const negative = calculateBuzzScore(venue, [matureCalibration(-18)], now);
  assert.equal(positive.mode, "forecast");
  assert.equal(negative.mode, "forecast");
  assert.ok(positive.score <= 64);
  assert.ok(negative.score < positive.score);
  assert.ok(positive.factors.some(factor => factor.family === "historical_learning"));
});
