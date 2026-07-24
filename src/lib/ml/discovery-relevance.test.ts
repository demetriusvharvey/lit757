import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMlMatch,
  byRelevanceThenActivity,
  CANONICAL_ACTIVITY_FIELDS,
  combineRelevance,
  liveQualityOf,
  relevancePercent,
  STRONG_MATCH_PERCENT,
} from "./discovery-relevance";

test("a strong text match never raises a quiet venue's activity score", () => {
  // The failure this guards against: a venue at canonical score 20 that matches
  // the query well used to be republished at ~70 because relevance and activity
  // were combined with Math.max.
  const quietVenue = { id: "v1", score: 20, confidence: "Open now", heat: null };
  const mlMatch = buildMlMatch({
    semantic: 0.95,
    liveQuality: liveQualityOf(quietVenue.score),
  }, "date night");

  const published = { ...quietVenue, mlMatch };

  assert.ok(mlMatch.percent > 60, "the match itself is strong");
  assert.equal(published.score, 20, "activity score is untouched");
  assert.equal(published.confidence, "Open now", "evidence descriptor is untouched");
  assert.equal(published.heat, null, "live heat signal is untouched");
});

test("relevance is reported separately from activity", () => {
  const match = buildMlMatch({ semantic: 0.8, rerank: 0.9, liveQuality: 0.1 }, "live music");
  assert.equal(match.vibe, "live music");
  assert.ok(match.percent > 0 && match.percent <= 99);
  assert.equal(match.reranked, 0.9);
});

test("a weak match is allowed to read as weak", () => {
  // Previously floored at 55, which made every result look like a good match.
  const match = buildMlMatch({ semantic: 0.02, liveQuality: 0 }, undefined);
  assert.ok(match.percent < STRONG_MATCH_PERCENT, `expected a weak percent, got ${match.percent}`);
  assert.ok(match.percent < 55, "no floor is applied");
});

test("relevance percent stays within a sane range", () => {
  assert.equal(relevancePercent(-5), 0);
  assert.equal(relevancePercent(0), 0);
  assert.equal(relevancePercent(50), 99, "never claims a perfect match");
  assert.equal(relevancePercent(0.5), 50);
});

test("live quality is normalized and clamped", () => {
  assert.equal(liveQualityOf(50), 0.5);
  assert.equal(liveQualityOf(150), 1);
  assert.equal(liveQualityOf(-10), 0);
  assert.equal(liveQualityOf(null), 0);
  assert.equal(liveQualityOf("not a number"), 0);
});

test("the reranker shifts the blend without letting activity dominate", () => {
  const withoutRerank = combineRelevance({ semantic: 0.9, liveQuality: 0 });
  const withRerank = combineRelevance({ semantic: 0.9, rerank: 0.9, liveQuality: 0 });
  assert.ok(withoutRerank > 0 && withRerank > 0);
  assert.notEqual(withoutRerank, withRerank);
});

test("results order by relevance, with activity only as a tiebreak", () => {
  const quietButRelevant = { id: "a", score: 10, mlMatch: buildMlMatch({ semantic: 0.95, liveQuality: 0.1 }, undefined) };
  const busyButIrrelevant = { id: "b", score: 95, mlMatch: buildMlMatch({ semantic: 0.05, liveQuality: 0.95 }, undefined) };
  const ordered = [busyButIrrelevant, quietButRelevant].sort(byRelevanceThenActivity);
  assert.equal(ordered[0].id, "a", "the better match ranks first");
  assert.equal(ordered[0].score, 10, "and keeps its real activity score");

  const tieLow = { id: "c", score: 40, mlMatch: buildMlMatch({ semantic: 0.5, liveQuality: 0.4 }, undefined) };
  const tieHigh = { id: "d", score: 40, mlMatch: buildMlMatch({ semantic: 0.5, liveQuality: 0.4 }, undefined) };
  tieHigh.score = 80;
  const tied = [tieLow, tieHigh].sort(byRelevanceThenActivity);
  assert.equal(tied[0].id, "d", "equal relevance falls back to activity");
});

test("the canonical field list documents what relevance must not write", () => {
  assert.deepEqual([...CANONICAL_ACTIVITY_FIELDS], ["score", "confidence", "heat"]);
});
