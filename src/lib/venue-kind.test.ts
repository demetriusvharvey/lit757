import assert from "node:assert/strict";
import test from "node:test";
import { venueKind, venueKinds } from "./venue-kind";

test("explicit nightlife metadata wins over restaurant words", () => {
  assert.equal(venueKind({
    name: "NuVibez Restaurant Bar & Lounge",
    type: "Bar",
    category: "Bar",
  }), "nightlife");
  assert.deepEqual(venueKinds({
    name: "NuVibez Restaurant Bar & Lounge",
    type: "Bar",
    category: "Bar",
  }), ["nightlife", "food"]);
  assert.equal(venueKind({
    name: "Sharks Sports Bar & Grill",
    type: "Bar",
    category: "Restaurant",
  }), "nightlife");
  assert.equal(venueKind({
    name: "Repeal Bourbon & Burgers",
    type: "Bourbon Bar",
    category: "Bars",
  }), "nightlife");
});

test("cross-source verified nightlife names repair generic restaurant metadata", () => {
  assert.equal(venueKind({ name: "Pour Girls", type: "Restaurant", category: "Restaurant" }), "nightlife");
  assert.equal(venueKind({ name: "Bad Habits", type: "Restaurant", category: "Restaurant" }), "nightlife");
  assert.equal(venueKind({ name: "The Katt", type: "Restaurant", category: "Restaurant" }), "nightlife");
  assert.deepEqual(venueKinds({ name: "37th & Zen", type: "Live Music" }), ["nightlife", "events"]);
});

test("ordinary restaurants and activities keep their primary kind", () => {
  assert.equal(venueKind({ name: "Local Seafood Kitchen", type: "Restaurant" }), "food");
  assert.equal(venueKind({ name: "Painting with a Twist", type: "Arts & Entertainment" }), "activity");
  assert.equal(venueKind({ name: "Virginia Zoo", category: "Attraction" }), "activity");
  assert.equal(venueKind({ name: "Local Links", category: "Golf Club" }), "activity");
});

test("generic club metadata is nightlife unless the venue type says otherwise", () => {
  assert.equal(venueKind({ name: "Local Dance Spot", category: "Club" }), "nightlife");
  assert.equal(venueKind({ name: "Local Laughs", category: "Comedy Club" }), "activity");
});

test("an attached event is represented as an event without changing stored metadata", () => {
  assert.equal(venueKind({ name: "Local Pub", type: "Bar", hasEvent: true }), "events");
  assert.deepEqual(venueKinds({ name: "Local Pub", type: "Bar", hasEvent: true }), ["events", "nightlife"]);
});
