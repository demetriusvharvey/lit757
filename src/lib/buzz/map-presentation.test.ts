import assert from "node:assert/strict";
import test from "node:test";
import { activityColor } from "../../../app/buzz-map-logo-sprite";
import { buzzPulseFrame } from "../../../app/buzz-map-pulse";
import {
  isBuzzingPinScore,
  isOnFirePinScore,
  selectFeaturedVenueIds,
} from "../../../app/buzz-map-presentation";

test("medium zoom reserves logo slots for the hottest venues", () => {
  const featured = selectFeaturedVenueIds(
    [
      { id: "quiet", score: 28 },
      { id: "hot", score: 94 },
      { id: "busy", score: 78 },
    ],
    null,
    2,
  );

  assert.deepEqual(featured, ["hot", "busy"]);
});

test("medium zoom keeps the selected venue visible", () => {
  const featured = selectFeaturedVenueIds(
    [
      { id: "hot", score: 94 },
      { id: "busy", score: 78 },
      { id: "selected", score: 28 },
    ],
    "selected",
    2,
  );

  assert.deepEqual(featured, ["hot", "selected"]);
});

test("logo activity rings retain the Buzz heat scale", () => {
  assert.equal(activityColor(35), "#64748b");
  assert.equal(activityColor(65), "#a3e635");
  assert.equal(activityColor(75), "#facc15");
  assert.equal(activityColor(85), "#fb923c");
  assert.equal(activityColor(95), "#ef4444");
});

test("animated pin thresholds match Heating Up and On Fire scores", () => {
  assert.equal(isBuzzingPinScore(75), false);
  assert.equal(isBuzzingPinScore(76), true);
  assert.equal(isOnFirePinScore(87), false);
  assert.equal(isOnFirePinScore(88), true);
});

test("buzz pulse expands while fading before restarting", () => {
  const start = buzzPulseFrame(0);
  const middle = buzzPulseFrame(900);
  const restart = buzzPulseFrame(1_800);

  assert.ok(middle.radius > start.radius);
  assert.ok(middle.opacity < start.opacity);
  assert.ok(middle.strokeOpacity < start.strokeOpacity);
  assert.deepEqual(restart, start);
});
