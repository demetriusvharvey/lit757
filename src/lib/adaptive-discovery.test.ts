import assert from "node:assert/strict";
import test from "node:test";
import {
  contextualVibe,
  discoveryDaypart,
  orderedDiscoveryCategories,
} from "./adaptive-discovery";

test("uses daytime from 6 AM through 3:59 PM", () => {
  assert.equal(discoveryDaypart(new Date(2026, 6, 22, 6, 0)), "day");
  assert.equal(discoveryDaypart(new Date(2026, 6, 22, 15, 59)), "day");
  assert.equal(discoveryDaypart(new Date(2026, 6, 22, 16, 0)), "night");
  assert.equal(discoveryDaypart(new Date(2026, 6, 22, 4, 0)), "night");
});

test("prioritizes daytime and nighttime categories without removing any", () => {
  assert.deepEqual(orderedDiscoveryCategories("day"), ["All", "Food", "Shopping", "Outdoors", "Events", "Drinks", "Nightlife"]);
  assert.deepEqual(orderedDiscoveryCategories("night"), ["All", "Nightlife", "Drinks", "Events", "Food", "Shopping", "Outdoors"]);
});

test("creates contextual daytime vibe tags", () => {
  assert.deepEqual(contextualVibe({ category: "Food", type: "Cafe", score: 73, scoreMode: "forecast" }, "day"), {
    label: "🥞 Brunch demand forecast",
    truth: "forecast",
  });
  assert.equal(contextualVibe({ category: "Outdoors", type: "Park" }, "day").label, "🌳 Good outdoor window");
});

test("creates contextual nighttime tags while preserving truth mode", () => {
  assert.deepEqual(contextualVibe({ category: "Nightlife", type: "Bar", score: 84, scoreMode: "live" }, "night"), {
    label: "🌙 Peak crowd",
    truth: "live",
  });
  assert.deepEqual(contextualVibe({ category: "Events", type: "Music venue", hasEvent: true, scoreMode: "forecast" }, "night"), {
    label: "🎵 Music event forecast",
    truth: "forecast",
  });
});
