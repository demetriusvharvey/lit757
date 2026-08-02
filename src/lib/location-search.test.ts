import assert from "node:assert/strict";
import test from "node:test";
import { mergeLocationResults, searchLocalLocations, type LocationSearchResult } from "./location-search";

test("local location search covers Hampton Roads cities without a provider call", () => {
  const results = searchLocalLocations("Norfolk");
  assert.equal(results[0]?.name, "Norfolk");
  assert.equal(results[0]?.featureType, "place");
  assert.ok(results.every(result => result.id.startsWith("local-")));
});

test("local location search recognizes district aliases", () => {
  assert.equal(searchLocalLocations("oceanfront")[0]?.name, "Virginia Beach Oceanfront");
  assert.equal(searchLocalLocations("neon")[0]?.name, "Ghent & NEON District");
  assert.equal(searchLocalLocations("oyster point")[0]?.name, "City Center at Oyster Point");
});

test("local location search returns no false nationwide result", () => {
  assert.deepEqual(searchLocalLocations("Atlanta"), []);
  assert.deepEqual(searchLocalLocations("a"), []);
});

test("location result merging keeps local matches first and removes duplicates", () => {
  const local = searchLocalLocations("Norfolk", 1);
  const externalDuplicate: LocationSearchResult = {
    ...local[0],
    id: "mapbox:norfolk",
  };
  const externalOther: LocationSearchResult = {
    id: "mapbox:richmond",
    name: "Richmond",
    detail: "Virginia",
    featureType: "place",
    longitude: -77.436,
    latitude: 37.54,
    bbox: null,
  };

  assert.deepEqual(
    mergeLocationResults(local, [externalDuplicate, externalOther]).map(result => result.id),
    [local[0].id, externalOther.id],
  );
});
