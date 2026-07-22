import assert from "node:assert/strict";
import test from "node:test";
import {
  buildHamptonRoadsOverpassQuery,
  findBestOsmMatch,
  normalizeOsmElement,
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
  assert.match(query, /out tags center qt/);
  assert.doesNotMatch(query, /\["shop"\]\(/);
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
