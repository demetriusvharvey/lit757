import assert from "node:assert/strict";
import test from "node:test";
import {
  ACTIVE_MIN_SCORE,
  BUZZING_PIN_MIN_SCORE,
  ON_FIRE_PIN_MIN_SCORE,
  milesLabel,
  venueScore,
  venueStatus,
  venueTruthLabel,
  type BuzzVenue,
} from "../../../app/buzz-map-model";

function venue(score: number, scoreMode?: "live" | "forecast"): BuzzVenue {
  return {
    id: "venue-1",
    name: "Test Venue",
    lat: 36.85,
    lng: -76.29,
    activity: {
      score,
      scoreMode,
      label: "Test",
      trendLabel: "Steady",
    },
  };
}

test("map presentation uses the shared Buzz activity thresholds", () => {
  assert.equal(venueStatus(venue(ACTIVE_MIN_SCORE - 1)), "Chill");
  assert.equal(venueStatus(venue(ACTIVE_MIN_SCORE)), "Active");
  assert.equal(venueStatus(venue(BUZZING_PIN_MIN_SCORE)), "Heating Up");
  assert.equal(venueStatus(venue(ON_FIRE_PIN_MIN_SCORE)), "On Fire");
});

test("map presentation clamps provider scores to the public 0-100 range", () => {
  assert.equal(venueScore(venue(-12)), 0);
  assert.equal(venueScore(venue(145)), 100);
});

test("missing truth metadata is described conservatively as a forecast", () => {
  assert.equal(venueTruthLabel(venue(82, "live")), "Live");
  assert.equal(venueTruthLabel(venue(82, "forecast")), "Forecast");
  assert.equal(venueTruthLabel(venue(82)), "Forecast");
});

test("distance labels stay compact across responsive layouts", () => {
  assert.equal(milesLabel(null), null);
  assert.equal(milesLabel(0.04), "Here");
  assert.equal(milesLabel(3.24), "3.2 mi");
  assert.equal(milesLabel(14.6), "15 mi");
});
