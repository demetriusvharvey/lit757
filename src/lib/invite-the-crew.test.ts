import assert from "node:assert/strict";
import test from "node:test";
import {
  buildInviteCrewText,
  buildInviteCrewUrl,
  buildStoryCardUrl,
  safeCardText,
  shareMode,
} from "./invite-the-crew";

test("builds a referral deep link without user location", () => {
  const url = new URL(buildInviteCrewUrl("https://lit757.vercel.app", {
    id: "venue-123",
    name: "The Barrel Room",
    city: "Norfolk",
    mode: "live",
  }));
  assert.equal(url.origin, "https://lit757.vercel.app");
  assert.equal(url.searchParams.get("venue"), "venue-123");
  assert.equal(url.searchParams.get("source"), "invite-the-crew");
  assert.equal(url.searchParams.get("mode"), "live");
  assert.equal(url.searchParams.has("userLat"), false);
});

test("builds a bounded Story card URL from venue metadata", () => {
  const url = new URL(buildStoryCardUrl("https://lit757.vercel.app", {
    id: "venue-123",
    name: "The Barrel Room",
    city: "Norfolk",
    latitude: 36.85,
    longitude: -76.28,
    status: "Heating up",
    trend: "Rising fast",
    mode: "forecast",
  }));
  assert.equal(url.pathname, "/api/share/venue-card");
  assert.equal(url.searchParams.get("name"), "The Barrel Room");
  assert.equal(url.searchParams.get("lat"), "36.85000");
  assert.equal(url.searchParams.get("lng"), "-76.28000");
  assert.equal(url.searchParams.get("mode"), "forecast");
});

test("share text distinguishes forecast from live activity", () => {
  assert.match(buildInviteCrewText({
    id: "1",
    name: "The Barrel Room",
    city: "Norfolk",
    status: "Heating up",
    mode: "forecast",
  }), /Buzz forecast/);
  assert.match(buildInviteCrewText({ id: "1", name: "The Barrel Room", mode: "live" }), /Live activity/);
});

test("unknown truth mode defaults to forecast", () => {
  assert.equal(shareMode("unsupported"), "forecast");
});

test("card text is bounded", () => {
  assert.equal(safeCardText("x".repeat(100), "fallback", 20).length, 20);
});
