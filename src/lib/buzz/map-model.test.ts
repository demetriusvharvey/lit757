import assert from "node:assert/strict";
import test from "node:test";
import {
  ACTIVE_MIN_SCORE,
  BUZZING_PIN_MIN_SCORE,
  ON_FIRE_PIN_MIN_SCORE,
  milesLabel,
  venueCategories,
  venueMatchesCategory,
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

test("map presentation uses truth-aware activity thresholds", () => {
  assert.equal(venueStatus(venue(ACTIVE_MIN_SCORE - 1)), "Moderate Forecast");
  assert.equal(venueStatus(venue(ACTIVE_MIN_SCORE, "forecast")), "Active Forecast");
  assert.equal(venueStatus(venue(BUZZING_PIN_MIN_SCORE, "forecast")), "High Activity Forecast");
  assert.equal(venueStatus(venue(ON_FIRE_PIN_MIN_SCORE, "live")), "Strong Live Activity");
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

test("mixed restaurant bars remain discoverable under food, drinks, and nightlife", () => {
  const mixed: BuzzVenue = {
    id: "mixed-venue",
    name: "NuVibez Restaurant Bar & Lounge",
    type: "Bar",
    category: "Bar",
    kinds: ["nightlife", "food"],
    lat: 37.1,
    lng: -76.5,
  };

  assert.deepEqual(venueCategories(mixed), ["Food", "Drinks", "Nightlife"]);
  assert.equal(venueMatchesCategory(mixed, "Food"), true);
  assert.equal(venueMatchesCategory(mixed, "Drinks"), true);
  assert.equal(venueMatchesCategory(mixed, "Nightlife"), true);
  assert.equal(venueMatchesCategory(mixed, "Outdoors"), false);
});

test("clubs and pure bars resolve to their distinct discovery filters", () => {
  const club: BuzzVenue = { id: "club", name: "Local Nightclub", type: "Nightclub", lat: 36.8, lng: -76.2 };
  const bar: BuzzVenue = { id: "bar", name: "Local Pub", type: "Bar", lat: 36.8, lng: -76.2 };
  assert.deepEqual(venueCategories(club), ["Nightlife"]);
  assert.deepEqual(venueCategories(bar), ["Drinks"]);
});
