import assert from "node:assert/strict";
import test from "node:test";
import { nearestActivityDistrict, venueBelongsToActivityDistrict } from "./buzz/districts";
import { dedupeVenueRows, venueCityFromAddress } from "./venue-dedupe";

test("venue geography prefers the city in the street address and merges useful fields", () => {
  const result = dedupeVenueRows([
    {
      id: "wrong-city",
      name: "Gershwin's",
      city: "Portsmouth",
      address: "332 Granby St, Norfolk, VA 23510, USA",
      lat: 36.8505547,
      lng: -76.2900178,
      phone: "(757) 226-0814",
    },
    {
      id: "correct-city",
      name: "Gershwin’s",
      city: "Norfolk",
      address: "332 Granby St, Norfolk, VA 23510",
      lat: 36.8505547,
      lng: -76.2900178,
      website: "https://example.com",
    },
  ]);

  assert.equal(result.venues.length, 1);
  assert.equal(result.duplicateRowsRemoved, 1);
  assert.equal(result.venues[0].id, "correct-city");
  assert.equal(result.venues[0].city, "Norfolk");
  assert.equal(result.venues[0].phone, "(757) 226-0814");
  assert.equal(result.primaryVenueIdBySourceId.get("wrong-city"), "correct-city");
});

test("same-name venues at different coordinates remain separate", () => {
  const result = dedupeVenueRows([
    { id: "one", name: "Local Bar", city: "Norfolk", lat: 36.85, lng: -76.29 },
    { id: "two", name: "Local Bar", city: "Virginia Beach", lat: 36.85, lng: -75.98 },
  ]);

  assert.equal(result.venues.length, 2);
  assert.equal(result.duplicateRowsRemoved, 0);
});

test("address city parsing recognizes multi-word Hampton Roads cities", () => {
  assert.equal(venueCityFromAddress("123 Main St, Virginia Beach, VA 23451"), "Virginia Beach");
  assert.equal(venueCityFromAddress("1 Town Center Dr, Newport News, Virginia"), "Newport News");
  assert.equal(venueCityFromAddress("Somewhere, Richmond, VA"), null);
});

test("venue district matching requires both local geography and city", () => {
  const downtownNorfolk = nearestActivityDistrict(36.8505547, -76.2900178, "Norfolk");
  assert.equal(downtownNorfolk?.id, "downtown-norfolk-waterside");
  assert.equal(venueBelongsToActivityDistrict(downtownNorfolk!, 36.8505547, -76.2900178, "Norfolk"), true);
  assert.equal(venueBelongsToActivityDistrict(downtownNorfolk!, 36.8505547, -76.2900178, "Portsmouth"), false);
});

test("overlapping Norfolk districts resolve to one nearest district", () => {
  const district = nearestActivityDistrict(36.8566333, -76.2788986, "Norfolk");
  assert.equal(district?.id, "downtown-norfolk-waterside");
});
