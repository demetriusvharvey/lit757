import assert from "node:assert/strict";
import test from "node:test";
import {
  directPresenceBand,
  groupDirectPresence,
  presenceMeetsLiveThreshold,
  privacySafeDirectPresenceCount,
} from "./direct-presence";

const now = new Date("2026-08-02T03:00:00.000Z");

test("direct presence counts only each device's latest venue", () => {
  const result = groupDirectPresence([
    { venue_id: "venue-a", device_id: "phone-1", report_type: "passive_presence", created_at: "2026-08-02T02:50:00.000Z" },
    { venue_id: "venue-b", device_id: "phone-1", report_type: "passive_presence", created_at: "2026-08-02T02:58:00.000Z" },
    { venue_id: "venue-b", device_id: "phone-2", report_type: "nearby_presence", created_at: "2026-08-02T02:57:00.000Z" },
  ], now);

  assert.equal(result.activeDevices, 2);
  assert.equal(result.byVenue.has("venue-a"), false);
  assert.equal(result.byVenue.get("venue-b")?.passive.size, 1);
  assert.equal(result.byVenue.get("venue-b")?.verified.size, 1);
});

test("direct presence rejects stale, future, malformed, and ambiguous evidence", () => {
  const result = groupDirectPresence([
    { venue_id: "venue-a", device_id: "stale", report_type: "passive_presence", created_at: "2026-08-02T02:44:59.000Z" },
    { venue_id: "venue-a", device_id: "future", report_type: "passive_presence", created_at: "2026-08-02T03:01:01.000Z" },
    { venue_id: "venue-a", device_id: "wrong-type", report_type: "member_like", created_at: "2026-08-02T02:59:00.000Z" },
    { venue_id: "venue-a", device_id: "ambiguous", report_type: "passive_presence", created_at: "2026-08-02T02:59:00.000Z" },
    { venue_id: "venue-b", device_id: "ambiguous", report_type: "passive_presence", created_at: "2026-08-02T02:59:00.000Z" },
  ], now);

  assert.equal(result.activeDevices, 0);
  assert.equal(result.ambiguousDevicesSkipped, 1);
  assert.equal(result.venuesWithEvidence, 0);
});

test("direct presence uses the same independent-phone thresholds as live scoring", () => {
  assert.equal(presenceMeetsLiveThreshold({ passiveDevices: 2, verifiedDevices: 0 }), false);
  assert.equal(presenceMeetsLiveThreshold({ passiveDevices: 3, verifiedDevices: 0 }), true);
  assert.equal(presenceMeetsLiveThreshold({ passiveDevices: 0, verifiedDevices: 2 }), true);
  assert.equal(presenceMeetsLiveThreshold({ passiveDevices: 2, verifiedDevices: 1 }), true);
});

test("public coverage bands hide exact one- and two-device counts", () => {
  assert.equal(directPresenceBand(0), "none");
  assert.equal(directPresenceBand(2), "1–2");
  assert.equal(directPresenceBand(7), "3–9");
  assert.equal(privacySafeDirectPresenceCount(0), 0);
  assert.equal(privacySafeDirectPresenceCount(2), null);
  assert.equal(privacySafeDirectPresenceCount(3), 3);
});
