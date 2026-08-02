import assert from "node:assert/strict";
import test from "node:test";
import {
  VERIFIED_NIGHTLIFE_IMPORT,
  findVerifiedImportDuplicate,
  importableVerifiedNightlifeVenues,
  verifiedNightlifeInsertRow,
} from "./verified-nightlife-import";

test("verified nightlife import has fixed rollback IDs and two-source evidence", () => {
  assert.equal(VERIFIED_NIGHTLIFE_IMPORT.venues.length, 23);
  assert.equal(new Set(VERIFIED_NIGHTLIFE_IMPORT.venues.map(venue => venue.id)).size, 23);
  assert.match(VERIFIED_NIGHTLIFE_IMPORT.backup.sha256, /^[a-f0-9]{64}$/);
  for (const venue of VERIFIED_NIGHTLIFE_IMPORT.venues) {
    assert.match(venue.id, /^[a-f0-9-]{36}$/);
    assert.match(venue.officialSourceUrl, /^https:\/\//);
    assert.match(venue.supportingSourceUrl, /^https:\/\//);
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
  assert.equal("supportingSourceUrl" in row, false);
});

test("Crocs is verified by its first-party location and a current promoter ticket listing", () => {
  const crocs = VERIFIED_NIGHTLIFE_IMPORT.venues.find(venue => venue.name === "Crocs 19th Street Bistro");
  assert.ok(crocs);
  assert.equal(crocs.address, "620 19th Street, Virginia Beach, VA 23451");
  assert.equal(crocs.officialSourceUrl, "https://crocs19thstreetbistro.com/");
  assert.equal(crocs.supportingSourceUrl, "https://posh.vip/e/tde-picture-day-81");
  assert.match(crocs.type, /Event Venue/);
});

test("Oceanfront wave five is anchored to first-party identity and current official evidence", () => {
  const expected = new Map([
    ["Seaside Raw Bar", "https://seasiderawbar.com/"],
    ["Chesapeake Bay Distillery", "https://www.chesapeakebaydistillery.com/"],
    ["Tempt Restaurant & Lounge", "https://temptvb.com/"],
    ["Aqua Social Club", "https://slimb6469.wixsite.com/website"],
    ["Big Sam's Inlet Cafe & Raw Bar", "https://bigsamsrawbar.com/"],
  ]);
  assert.equal(VERIFIED_NIGHTLIFE_IMPORT.batchId, "priority-nightlife-wave-5-2026-08-02");
  for (const [name, officialSourceUrl] of expected) {
    const venue = VERIFIED_NIGHTLIFE_IMPORT.venues.find(candidate => candidate.name === name);
    assert.ok(venue, `${name} must remain in the reviewed import`);
    assert.equal(venue.officialSourceUrl, officialSourceUrl);
    assert.equal(venue.scopeId, "virginia-beach-oceanfront");
  }
});

test("import planning separates additions and existing rows", () => {
  const existing = VERIFIED_NIGHTLIFE_IMPORT.venues[0];
  const plan = importableVerifiedNightlifeVenues([existing]);
  assert.equal(plan.duplicates.length, 1);
  assert.equal(plan.additions.length, VERIFIED_NIGHTLIFE_IMPORT.venues.length - 1);
});
