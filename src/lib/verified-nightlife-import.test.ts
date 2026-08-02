import assert from "node:assert/strict";
import test from "node:test";
import {
  VERIFIED_NIGHTLIFE_IMPORT,
  findVerifiedImportDuplicate,
  importableVerifiedNightlifeVenues,
  verifiedNightlifeInsertRow,
} from "./verified-nightlife-import";

test("verified nightlife import has fixed rollback IDs and two-source evidence", () => {
  assert.equal(VERIFIED_NIGHTLIFE_IMPORT.venues.length, 6);
  assert.equal(new Set(VERIFIED_NIGHTLIFE_IMPORT.venues.map(venue => venue.id)).size, 6);
  assert.match(VERIFIED_NIGHTLIFE_IMPORT.backup.sha256, /^[a-f0-9]{64}$/);
  for (const venue of VERIFIED_NIGHTLIFE_IMPORT.venues) {
    assert.match(venue.id, /^[a-f0-9-]{36}$/);
    assert.match(venue.officialSourceUrl, /^https:\/\//);
    assert.match(venue.osmSourceUrl, /^https:\/\/www\.openstreetmap\.org\//);
    assert.ok(Number.isFinite(venue.lat));
    assert.ok(Number.isFinite(venue.lng));
  }
});

test("import dedupe catches punctuation variants at the same location", () => {
  const candidate = VERIFIED_NIGHTLIFE_IMPORT.venues[1];
  const duplicate = findVerifiedImportDuplicate(candidate, [{
    id: "existing",
    name: "Abbey Road Pub and Restaurant",
    city: "Virginia Beach",
    lat: candidate.lat,
    lng: candidate.lng,
  }]);
  assert.equal(duplicate?.id, "existing");
});

test("same-name venues in another city or far away are not collapsed", () => {
  const candidate = VERIFIED_NIGHTLIFE_IMPORT.venues[0];
  assert.equal(findVerifiedImportDuplicate(candidate, [{
    id: "other-city",
    name: candidate.name,
    city: "Norfolk",
    lat: candidate.lat,
    lng: candidate.lng,
  }]), null);
  assert.equal(findVerifiedImportDuplicate(candidate, [{
    id: "other-location",
    name: candidate.name,
    city: candidate.city,
    lat: 36.7,
    lng: -76.1,
  }]), null);
});

test("insert rows exclude review-only evidence fields", () => {
  const candidate = VERIFIED_NIGHTLIFE_IMPORT.venues[0];
  const row = verifiedNightlifeInsertRow(candidate, "2026-08-02T07:00:00.000Z");
  assert.deepEqual(Object.keys(row).sort(), [
    "address", "category", "city", "enriched_at", "id", "lat", "lng", "name", "phone", "type", "website",
  ]);
  assert.equal("officialSourceUrl" in row, false);
});

test("import planning separates additions and existing rows", () => {
  const existing = VERIFIED_NIGHTLIFE_IMPORT.venues[0];
  const plan = importableVerifiedNightlifeVenues([existing]);
  assert.equal(plan.duplicates.length, 1);
  assert.equal(plan.additions.length, 5);
});
