import assert from "node:assert/strict";
import test from "node:test";
import type { BuzzVenue } from "../../../app/buzz-map-model";
import {
  pulseScopePhrase,
  summarizeBuzzPulse,
} from "../../../app/buzz-pulse-summary";

const venues: BuzzVenue[] = [
  {
    id: "open-event",
    name: "Open Event",
    lat: 36.85,
    lng: -76.29,
    openNow: true,
    event: { name: "DJ Set" },
    activity: {
      score: 81,
      label: "High",
      trendLabel: "Steady",
      scoreMode: "forecast",
    },
  },
  {
    id: "live",
    name: "Live Signal",
    lat: 36.86,
    lng: -76.28,
    openNow: false,
    activity: {
      score: 64,
      label: "Active",
      trendLabel: "Getting busier",
      scoreMode: "live",
    },
  },
];

test("757 pulse keeps opening, event, forecast, and live claims separate", () => {
  assert.deepEqual(summarizeBuzzPulse(venues), {
    eventListingCount: 1,
    highForecastCount: 1,
    liveCount: 1,
    mode: "live",
    modeLabel: "1 live signal",
    openCount: 1,
    rankedCount: 2,
  });
});

test("757 pulse stays in forecast mode without direct evidence", () => {
  const summary = summarizeBuzzPulse([venues[0]!]);
  assert.equal(summary.mode, "forecast");
  assert.equal(summary.modeLabel, "Forecast mode");
});

test("pulse scope copy remains natural for regional and local searches", () => {
  assert.equal(pulseScopePhrase("Hampton Roads"), "across Hampton Roads");
  assert.equal(pulseScopePhrase("in Hampton Roads"), "across Hampton Roads");
  assert.equal(pulseScopePhrase("in Norfolk"), "in Norfolk");
  assert.equal(pulseScopePhrase("near you"), "near you");
  assert.equal(pulseScopePhrase("Virginia Beach"), "across Virginia Beach");
});
