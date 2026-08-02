import assert from "node:assert/strict";
import test from "node:test";
import {
  latestReportPerPerson,
  summarizeVerifiedCrowdReports,
  verifiedVenueDistanceLimit,
  verifiesVenueProximity,
} from "./verified-reports";

const baseReport = {
  expires_at: "2026-08-02T02:30:00.000Z",
};

test("crowd consensus uses only the latest report from each person", () => {
  const reports = [
    { ...baseReport, user_id: "user-1", crowd_level: "quiet", observed_at: "2026-08-02T02:00:00.000Z" },
    { ...baseReport, user_id: "user-1", crowd_level: "packed", observed_at: "2026-08-02T02:10:00.000Z" },
    { ...baseReport, user_id: "user-2", crowd_level: "busy", observed_at: "2026-08-02T02:05:00.000Z" },
  ];

  const unique = latestReportPerPerson(reports);
  const summary = summarizeVerifiedCrowdReports(reports);

  assert.deepEqual(unique.map(report => report.crowd_level), ["packed", "busy"]);
  assert.equal(summary?.uniqueReporterCount, 2);
  assert.equal(summary?.average, 85);
});

test("reports without a durable identity cannot create crowd consensus", () => {
  const summary = summarizeVerifiedCrowdReports([
    { ...baseReport, crowd_level: "packed", observed_at: "2026-08-02T02:10:00.000Z" },
  ]);

  assert.equal(summary, null);
});

test("aggregate evidence expires when its earliest contributing report expires", () => {
  const summary = summarizeVerifiedCrowdReports([
    { user_id: "user-1", crowd_level: "packed", observed_at: "2026-08-02T02:10:00.000Z", expires_at: "2026-08-02T02:40:00.000Z" },
    { user_id: "user-2", crowd_level: "busy", observed_at: "2026-08-02T02:15:00.000Z", expires_at: "2026-08-02T03:00:00.000Z" },
  ]);

  assert.equal(summary?.latestObservedAt, "2026-08-02T02:15:00.000Z");
  assert.equal(summary?.expiresAt, "2026-08-02T02:40:00.000Z");
});

test("venue verification rejects missing, weak, and overly distant GPS fixes", () => {
  assert.equal(verifiedVenueDistanceLimit(0), null);
  assert.equal(verifiedVenueDistanceLimit(151), null);
  assert.equal(verifiedVenueDistanceLimit(10), 75);
  assert.equal(verifiedVenueDistanceLimit(150), 180);
  assert.equal(verifiesVenueProximity(74, 10), true);
  assert.equal(verifiesVenueProximity(76, 10), false);
  assert.equal(verifiesVenueProximity(181, 150), false);
});
