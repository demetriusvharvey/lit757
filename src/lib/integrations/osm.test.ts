import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildOsmNightlifeCoverage,
  buildHamptonRoadsOverpassQuery,
  dedupeOsmVenueCandidates,
  findBestOsmMatch,
  normalizeOsmElement,
  osmNightlifeEvidence,
  osmEnrichmentPatch,
  parseOverpassResponse,
  venueNameSimilarity,
  type OsmVenueCandidate,
} from "./osm";

const candidate: OsmVenueCandidate = {
  osmType: "node",
  osmId: 123,
  osmUrl: "https://www.openstreetmap.org/node/123",
  name: "The Granby Theater",
  latitude: 36.8508,
  longitude: -76.2859,
  city: "Norfolk",
  address: "421 Granby St, Norfolk, VA, 23510",
  phone: "+1 757-555-0100",
  website: "https://granbytheater.example",
  category: "Arts & Culture",
  type: "Theatre",
  rawTag: { key: "amenity", value: "theatre" },
  tags: { amenity: "theatre", name: "The Granby Theater" },
};

test("Overpass query is bounded and limited to discovery-relevant tags", () => {
  const query = buildHamptonRoadsOverpassQuery();
  assert.match(query, /36\.42,-76\.95,37\.38,-75\.7/);
  assert.match(query, /amenity/);
  assert.match(query, /tourism/);
  assert.match(query, /leisure/);
  assert.match(query, /hookah_lounge/);
  assert.match(query, /stripclub/);
  assert.match(query, /\["bar"="yes"\]/);
  assert.match(query, /\["microbrewery"="yes"\]/);
  assert.match(query, /\["club"="music"\]/);
  assert.match(query, /out tags center qt/);
  assert.doesNotMatch(query, /\["shop"\]\(/);
});

test("OSM normalization recognizes dedicated hookah lounges as nightlife", () => {
  const normalized = normalizeOsmElement({
    type: "node",
    id: 45,
    lat: 36.87,
    lon: -76.3,
    tags: { name: "Example Hookah", amenity: "hookah_lounge" },
  });

  assert.equal(normalized?.category, "Nightlife");
  assert.equal(normalized?.type, "Hookah Lounge");
  assert.equal(normalized && osmNightlifeEvidence(normalized), "primary-tag");
});

test("nightlife evidence keeps OSM tags separate from conservative name review", () => {
  const restaurant = (name: string, tags: Record<string, string> = {}): OsmVenueCandidate => ({
    ...candidate,
    name,
    category: "Food",
    type: "Restaurant",
    rawTag: { key: "amenity", value: "restaurant" },
    tags: { amenity: "restaurant", name, ...tags },
  });

  assert.equal(osmNightlifeEvidence(restaurant("The Social Terrace", { bar: "yes" })), "secondary-tag");
  assert.equal(osmNightlifeEvidence(restaurant("Local Brewpub", { microbrewery: "yes" })), "secondary-tag");
  assert.equal(osmNightlifeEvidence(restaurant("Skeleton Key Bar & Grille")), "name-review");
  assert.equal(osmNightlifeEvidence(restaurant("Downtown Juice Bar")), null);
  assert.equal(osmNightlifeEvidence({
    ...restaurant("Club Pilates"),
    category: "Sports & Fitness",
    type: "Fitness Centre",
  }), null);
});

test("OSM element normalization preserves useful contact and classification data", () => {
  const normalized = normalizeOsmElement({
    type: "way",
    id: 44,
    center: { lat: 36.85, lon: -76.28 },
    tags: {
      name: "Example Arts Center",
      amenity: "arts_centre",
      "addr:housenumber": "100",
      "addr:street": "Main St",
      "addr:city": "Norfolk",
      "addr:state": "VA",
      "addr:postcode": "23510",
      "contact:phone": "+1 757-555-0000",
      "contact:website": "https://example.org",
    },
  });
  assert.ok(normalized);
  assert.equal(normalized?.category, "Arts & Culture");
  assert.equal(normalized?.type, "Arts Centre");
  assert.equal(normalized?.address, "100 Main St, Norfolk, VA, 23510");
  assert.equal(normalized?.website, "https://example.org");
  assert.equal(normalized?.osmUrl, "https://www.openstreetmap.org/way/44");
});

test("Overpass response parser uses way centers and deduplicates elements", () => {
  const parsed = parseOverpassResponse({
    osm3s: { timestamp_osm_base: "2026-07-22T15:00:00Z" },
    elements: [
      { type: "node", id: 1, lat: 36.8, lon: -76.2, tags: { name: "Cafe One", amenity: "cafe" } },
      { type: "node", id: 1, lat: 36.8, lon: -76.2, tags: { name: "Cafe One", amenity: "cafe" } },
      { type: "way", id: 2, center: { lat: 36.9, lon: -76.3 }, tags: { name: "Park Two", leisure: "park" } },
    ],
  });
  assert.equal(parsed.rawElementCount, 3);
  assert.equal(parsed.candidates.length, 2);
  assert.equal(parsed.osmBaseTimestamp, "2026-07-22T15:00:00Z");
});

test("nightlife coverage deduplicates OSM elements and separates review gaps", () => {
  const nightlife = (overrides: Partial<OsmVenueCandidate>): OsmVenueCandidate => ({
    ...candidate,
    name: "Granby Taproom",
    category: "Nightlife",
    type: "Bar",
    rawTag: { key: "amenity", value: "bar" },
    tags: { amenity: "bar", name: "Granby Taproom" },
    ...overrides,
  });
  const candidates = [
    nightlife({ osmType: "node", osmId: 201, latitude: 36.8508, longitude: -76.2859, city: null }),
    nightlife({ osmType: "way", osmId: 202, latitude: 36.85082, longitude: -76.28592, city: "Norfolk" }),
    nightlife({ osmType: "node", osmId: 203, name: "Missing Lounge", latitude: 36.86, longitude: -76.29 }),
    { ...candidate, osmId: 204, name: "Gallery Only", category: "Arts & Culture" },
  ];

  const deduplicated = dedupeOsmVenueCandidates(candidates.slice(0, 2));
  assert.equal(deduplicated.candidates.length, 1);
  assert.equal(deduplicated.duplicateElementsRemoved, 1);
  assert.deepEqual(deduplicated.candidates[0].sourceKeys, ["node:201", "way:202"]);
  assert.equal(deduplicated.candidates[0].candidate.city, "Norfolk");

  const coverage = buildOsmNightlifeCoverage([{
    id: "venue-taproom",
    name: "Granby Taproom",
    city: "Norfolk",
    lat: 36.85081,
    lng: -76.28591,
    category: "Nightlife",
    type: "Bar",
  }], candidates);

  assert.equal(coverage.rawNightlifeCandidates, 3);
  assert.equal(coverage.uniqueNightlifeCandidates, 2);
  assert.equal(coverage.duplicateElementsRemoved, 1);
  assert.deepEqual(coverage.evidenceCounts, {
    primaryTag: 2,
    secondaryTag: 0,
    nameReview: 0,
  });
  assert.equal(coverage.matchedCandidates, 1);
  assert.equal(coverage.unmatchedCandidates, 1);
  assert.equal(coverage.candidates.find(item => item.candidate.name === "Granby Taproom")?.match?.venue.id, "venue-taproom");
  assert.equal(coverage.candidates.find(item => item.candidate.name === "Missing Lounge")?.match, null);
});

test("nightlife coverage endpoint is protected and read-only", () => {
  const source = readFileSync(new URL("../../../app/api/venues/osm-coverage/route.ts", import.meta.url), "utf8");
  assert.match(source, /isCronAuthorized\(request\)/);
  assert.match(source, /mode: "read-only-review"/);
  assert.match(source, /byEvidence: evidenceBreakdown/);
  assert.match(source, /priorityScopes: PRIORITY_NIGHTLIFE_SCOPES/);
  assert.doesNotMatch(source, /\.insert\(|\.upsert\(|\.update\(|\.delete\(/);
});

test("name similarity handles articles, punctuation, and business suffixes", () => {
  assert.equal(venueNameSimilarity("The Granby Theater, LLC", "Granby Theater"), 1);
  assert.ok(venueNameSimilarity("Sandler Center for Performing Arts", "Sandler Center") >= 0.9);
  assert.ok(venueNameSimilarity("Completely Different", "Granby Theater") < 0.3);
});

test("matching requires both strong names and realistic distance", () => {
  const matched = findBestOsmMatch({
    id: "venue-1",
    name: "Granby Theater",
    city: "Norfolk",
    lat: 36.8509,
    lng: -76.286,
  }, [candidate]);
  assert.ok(matched);
  assert.equal(matched?.candidate.osmId, 123);
  assert.ok((matched?.distanceMiles || 1) < 0.1);

  const distant = findBestOsmMatch({
    id: "venue-2",
    name: "Granby Theater",
    city: "Norfolk",
    lat: 37.2,
    lng: -76.7,
  }, [candidate]);
  assert.equal(distant, null);
});

test("missing-coordinate matches require exact name and city", () => {
  const matched = findBestOsmMatch({
    id: "venue-3",
    name: "The Granby Theater",
    city: "Norfolk",
    lat: null,
    lng: null,
  }, [candidate]);
  assert.ok(matched);

  const wrongCity = findBestOsmMatch({
    id: "venue-4",
    name: "Granby Theater",
    city: "Hampton",
    lat: null,
    lng: null,
  }, [candidate]);
  assert.equal(wrongCity, null);
});

test("enrichment fills blanks but never overwrites stronger existing fields", () => {
  const blankMatch = findBestOsmMatch({
    id: "venue-5",
    name: "Granby Theater",
    city: "Norfolk",
    address: null,
    phone: null,
    website: null,
    category: "Local Spot",
    type: "Unknown",
    lat: 36.8509,
    lng: -76.286,
  }, [candidate]);
  assert.ok(blankMatch);
  const patch = osmEnrichmentPatch(blankMatch!, "2026-07-22T15:30:00.000Z");
  assert.deepEqual(patch, {
    address: candidate.address,
    phone: candidate.phone,
    website: candidate.website,
    category: candidate.category,
    type: candidate.type,
    enriched_at: "2026-07-22T15:30:00.000Z",
  });

  const completeMatch = findBestOsmMatch({
    id: "venue-6",
    name: "Granby Theater",
    city: "Norfolk",
    address: "Existing address",
    phone: "Existing phone",
    website: "https://existing.example",
    category: "Nightlife",
    type: "Venue",
    lat: 36.8509,
    lng: -76.286,
  }, [candidate]);
  assert.ok(completeMatch);
  assert.equal(osmEnrichmentPatch(completeMatch!), null);
});
