import assert from "node:assert/strict";
import test from "node:test";
import {
  buildUnifiedActivity,
  predictArrivalActivity,
  shouldNotify,
  type WatchRule,
} from "./product-intelligence";

test("expired live evidence becomes insufficient instead of pretending to be current", () => {
  const activity = buildUnifiedActivity({
    score: 91,
    isLive: true,
    observedAt: "2026-07-23T20:00:00.000Z",
    expiresAt: "2026-07-23T20:30:00.000Z",
    now: new Date("2026-07-23T21:00:00.000Z"),
  });
  assert.equal(activity.truthMode, "insufficient");
  assert.equal(activity.state, "unknown");
  assert.equal(activity.score, null);
});

test("fresh verified activity resolves to live truth with a trend", () => {
  const activity = buildUnifiedActivity({
    score: 84,
    confidence: "high",
    isLive: true,
    observedAt: "2026-07-23T20:50:00.000Z",
    expiresAt: "2026-07-23T21:20:00.000Z",
    trendDelta: 16,
    now: new Date("2026-07-23T21:00:00.000Z"),
  });
  assert.equal(activity.truthMode, "live");
  assert.equal(activity.state, "hot");
  assert.equal(activity.trend, "surging");
  assert.equal(activity.confidence, "high");
});

test("arrival prediction accounts for rising activity and route time", () => {
  const arrival = predictArrivalActivity({
    currentScore: 66,
    trend: "rising",
    travelMinutes: 30,
    historicalSlopePerHour: 8,
    confidence: "high",
  });
  assert.ok(arrival.score > 66);
  assert.equal(arrival.outlook, "stronger");
  assert.match(arrival.label, /Expected/);
});

test("arrival prediction warns when a venue closes around arrival", () => {
  const arrival = predictArrivalActivity({
    currentScore: 88,
    trend: "stable",
    travelMinutes: 25,
    minutesUntilClose: 30,
  });
  assert.ok(arrival.score < 70);
  assert.equal(arrival.outlook, "cooler");
  assert.match(arrival.detail, /closing soon/);
});

test("alert decisions suppress low confidence and repeat noise", () => {
  const watch: WatchRule = {
    id: "watch-1",
    kind: "venue",
    targetId: "venue-1",
    targetName: "Venue",
    alertMode: "balanced",
    minState: "active",
    enabled: true,
    lastNotifiedAt: "2026-07-23T20:30:00.000Z",
    lastNotifiedState: "hot",
  };
  const activity = buildUnifiedActivity({
    score: 88,
    confidence: "high",
    isLive: true,
    observedAt: "2026-07-23T20:55:00.000Z",
    expiresAt: "2026-07-23T21:20:00.000Z",
    now: new Date("2026-07-23T21:00:00.000Z"),
  });
  assert.equal(shouldNotify({ watch, activity, now: new Date("2026-07-23T21:00:00.000Z") }), false);
});

test("alert decisions allow meaningful hot rising transitions", () => {
  const watch: WatchRule = {
    id: "watch-2",
    kind: "area",
    targetId: "granby",
    targetName: "Granby Street",
    alertMode: "essential",
    minState: "active",
    requireRising: true,
    enabled: true,
  };
  const activity = buildUnifiedActivity({
    score: 90,
    confidence: "high",
    isLive: true,
    observedAt: "2026-07-23T20:55:00.000Z",
    expiresAt: "2026-07-23T21:30:00.000Z",
    trendDelta: 17,
    now: new Date("2026-07-23T21:00:00.000Z"),
  });
  assert.equal(shouldNotify({ watch, activity, now: new Date("2026-07-23T21:00:00.000Z") }), true);
});
