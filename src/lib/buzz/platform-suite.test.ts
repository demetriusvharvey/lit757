import assert from "node:assert/strict";
import test from "node:test";
import { buildCityPulse, buildCollections, chooseForGroup, detectManipulation, enrichVenue, officialAndIndependentTruth, privacySafeAreaActivity, productMetrics, rankVenues, scoreForIntent, sourceWeight, type RawVenue, type SignalProvenance } from "./platform-suite";

const now = new Date("2026-07-24T02:00:00.000Z");

function venue(overrides: Partial<RawVenue> = {}): RawVenue {
  return {
    id: "venue-1",
    name: "Test Venue",
    city: "Norfolk",
    lat: 36.85,
    lng: -76.29,
    kind: "nightlife",
    type: "Bar",
    score: 82,
    confidence: "high",
    reason: "Activity is rising with verified nearby movement.",
    timing: "Open until 2 AM",
    openNow: true,
    parking: "Easy garage parking",
    cover: "None",
    heat: { level: "hot", label: "Hot", detail: "Verified visitors report a growing crowd.", source: "verified_nearby" },
    ...overrides,
  };
}

test("source weighting expires stale evidence", () => {
  const signal: SignalProvenance = { source: "test", family: "verified_presence", observedAt: "2026-07-24T01:30:00.000Z", expiresAt: "2026-07-24T01:50:00.000Z", confidence: 1, direct: true };
  assert.equal(sourceWeight(signal, now), 0);
});

test("verified evidence produces live truth and useful arrival guidance", () => {
  const enriched = enrichVenue(venue(), { generatedAt: now, distanceMiles: 4 });
  assert.equal(enriched.activity.truthMode, "live");
  assert.equal(enriched.activity.state, "hot");
  assert.ok(enriched.arrival.travelMinutes && enriched.arrival.travelMinutes > 0);
  assert.ok(enriched.fit.length > 0);
  assert.equal(enriched.trust.manipulationRisk, "low");
});

test("intent ranking changes the order without hiding objective activity", () => {
  const hot = enrichVenue(venue({ id: "hot", score: 94, parking: "Parking is tough" }), { generatedAt: now });
  const easy = enrichVenue(venue({ id: "easy", score: 65, heat: null, parking: "Easy parking" }), { generatedAt: now });
  assert.ok(scoreForIntent(hot, "high_energy") > scoreForIntent(easy, "high_energy"));
  assert.equal(rankVenues([hot, easy], "easy_parking")[0].id, "easy");
});

test("city pulse, collections, and metrics summarize the city", () => {
  const venues = [
    enrichVenue(venue({ id: "n1", city: "Norfolk" }), { generatedAt: now }),
    enrichVenue(venue({ id: "n2", city: "Norfolk", score: 75 }), { generatedAt: now }),
    enrichVenue(venue({ id: "v1", city: "Virginia Beach", score: 45, heat: null }), { generatedAt: now }),
  ];
  assert.equal(buildCityPulse(venues).strongestArea, "Norfolk");
  assert.ok(buildCollections(venues).length > 0);
  assert.equal(productMetrics(venues).coveragePct, 100);
});

test("privacy aggregation requires a minimum cell count", () => {
  const two = [enrichVenue(venue({ id: "1" }), { generatedAt: now }), enrichVenue(venue({ id: "2", lat: 36.851 }), { generatedAt: now })];
  assert.equal(privacySafeAreaActivity(two).length, 0);
  const three = [...two, enrichVenue(venue({ id: "3", lat: 36.852 }), { generatedAt: now })];
  assert.equal(privacySafeAreaActivity(three).length, 1);
});

test("group planning returns primary and backup choices", () => {
  const venues = [
    enrichVenue(venue({ id: "hot", score: 95 }), { generatedAt: now }),
    enrichVenue(venue({ id: "easy", score: 72, heat: null, parking: "Easy parking" }), { generatedAt: now }),
    enrichVenue(venue({ id: "chill", score: 55, heat: null }), { generatedAt: now }),
  ];
  const result = chooseForGroup(venues, { energy: "balanced", parkingImportant: true, budget: "any" });
  assert.ok(result.bestOverall);
  assert.ok(result.mostActive);
  assert.ok(result.easiest);
  assert.ok(result.backups.length > 0);
});

test("official facts remain separated from independent truth", () => {
  const result = officialAndIndependentTruth(enrichVenue(venue(), { generatedAt: now }));
  assert.equal(result.official.cover, "None");
  assert.equal(result.independent.state, "hot");
  assert.ok(result.prediction.stateOnArrival);
});

test("single-source report bursts are flagged", () => {
  const burst: SignalProvenance[] = Array.from({ length: 5 }, (_, index) => ({ source: "same-device", family: "community_report", observedAt: new Date(now.getTime() - index * 1000).toISOString(), expiresAt: new Date(now.getTime() + 20 * 60_000).toISOString(), confidence: 0.8, direct: true }));
  assert.equal(detectManipulation(burst), "high");
});
