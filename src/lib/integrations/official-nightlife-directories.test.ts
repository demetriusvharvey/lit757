import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildOfficialNightlifeCoverage,
  findBestOfficialNightlifeMatch,
  isOfficialCandidateOpen,
  parseDowntownNorfolkNightlifeHtml,
  parsePortsmouthVisitorDirectory,
  type OfficialNightlifeCandidate,
} from "./official-nightlife-directories";

test("Downtown Norfolk parser extracts official names, addresses, and detail links", () => {
  const candidates = parseDowntownNorfolkNightlifeHtml(`
    <div class="pst"><a href="/go/baxters-sports-lounge">
      <div class="pst-name">Baxter&#039;s Sports Lounge&nbsp;&nbsp;<img alt="Member" /></div>
      <div class="pst-address">500 Granby St</div>
    </a></div>
    <div class="pst"><a href="/go/grace-omalleys-irish-pub-and-restaurant">
      <div class="pst-name">Grace O&#x27;Malley&#x27;s Irish Pub &amp; Restaurant</div>
      <div class="pst-address">211 Granby St</div>
    </a></div>
  `);

  assert.equal(candidates.length, 2);
  assert.deepEqual(candidates.map(candidate => candidate.name), [
    "Baxter's Sports Lounge",
    "Grace O'Malley's Irish Pub & Restaurant",
  ]);
  assert.equal(candidates[0].address, "500 Granby St");
  assert.equal(
    candidates[0].sourceUrl,
    "https://www.downtownnorfolk.org/go/baxters-sports-lounge",
  );
  assert.equal(candidates[0].evidence, "official-nightlife-directory");
});

test("Portsmouth parser keeps nightlife and brewery tiers separate", () => {
  const candidates = parsePortsmouthVisitorDirectory([
    {
      _id: "nightlife-1",
      name: "Kashmir Martini Lounge",
      address: "305 High St, Portsmouth, VA 23704, USA",
      categoryList: ["Dining", "Nightlife & Live Music"],
      business_status: "OPERATIONAL",
      lat: 36.8351,
      lng: -76.2995,
      website: "https://example.com/kashmir",
    },
    {
      id: "brewery-1",
      title: "The Bier Garden",
      address: "438 High St, Portsmouth, VA 23704, USA",
      categoryList: ["Dining", "Brewery & Taphouses"],
      business_status: null,
      lat: 36.8354,
      lng: -76.302,
    },
    {
      id: "food-only",
      name: "Lunch Counter",
      categoryList: ["Dining"],
    },
    {
      id: "unsafe-link",
      name: "Nightlife Listing",
      categoryList: ["Bar"],
      website: "javascript:alert(1)",
    },
  ]);

  assert.equal(candidates.length, 3);
  assert.equal(candidates[0].evidence, "official-nightlife-category");
  assert.equal(candidates[1].evidence, "official-brewery-taphouse-category");
  assert.equal(candidates[1].sourceUrl, "https://portsvacation.com/visitor-directory/");
  assert.equal(candidates[2].sourceUrl, "https://portsvacation.com/visitor-directory/");
});

const candidate: OfficialNightlifeCandidate = {
  sourceId: "portsmouth-visitor-directory",
  sourceUrl: "https://portsvacation.com/visitor-directory/",
  sourceItemId: "barons",
  scopeId: "portsmouth-city",
  name: "Baron's Pub & Restaurant",
  city: "Portsmouth",
  address: "500 High St, Portsmouth, VA 23704, USA",
  latitude: 36.835508,
  longitude: -76.3025,
  categories: ["Nightlife & Live Music"],
  operatingStatus: "OPERATIONAL",
  evidence: "official-nightlife-category",
};

test("official matching requires a strong same-city name and realistic distance", () => {
  const match = findBestOfficialNightlifeMatch(candidate, [
    {
      id: "unrelated-same-address",
      name: "Playful Biplane",
      city: "Portsmouth",
      address: "500 High St, Portsmouth, VA 23704",
      lat: 36.83551,
      lng: -76.3025,
    },
    {
      id: "barons",
      name: "Barons Pub",
      city: "Portsmouth",
      address: "500 High St, Portsmouth, VA 23704",
      lat: 36.83551,
      lng: -76.3025,
    },
    {
      id: "wrong-city",
      name: "Baron's Pub & Restaurant",
      city: "Norfolk",
      lat: 36.85,
      lng: -76.29,
    },
  ]);

  assert.equal(match?.venue.id, "barons");
  assert.ok((match?.distanceMiles || 1) < 0.01);
});

test("official matching handles directory suffixes and address-backed aliases", () => {
  const directoryCandidate = {
    ...candidate,
    sourceId: "downtown-norfolk-nightlife" as const,
    scopeId: "downtown-norfolk" as const,
    name: "Luce Restaurant",
    city: "Norfolk",
    address: "245 Granby St",
    latitude: null,
    longitude: null,
  };
  const luce = findBestOfficialNightlifeMatch(directoryCandidate, [{
    id: "luce",
    name: "Luce",
    city: "Norfolk",
    address: "245 Granby Street, Norfolk, VA 23510",
  }]);
  assert.equal(luce?.venue.id, "luce");
  assert.equal(luce?.nameScore, 1);
  assert.equal(luce?.addressMatched, true);

  const republic = findBestOfficialNightlifeMatch({
    ...directoryCandidate,
    name: "Republic On Granby",
    address: "437 Granby Street",
  }, [{
    id: "republic",
    name: "Republic",
    city: "Norfolk",
    address: "437 Granby St, Norfolk, VA 23510",
  }]);
  assert.equal(republic?.venue.id, "republic");
  assert.equal(republic?.addressMatched, true);
});

test("closed directory entries are reported but excluded from active matching", () => {
  const closed = { ...candidate, name: "Closed Club", operatingStatus: "CLOSED_TEMPORARILY" };
  assert.equal(isOfficialCandidateOpen(candidate), true);
  assert.equal(isOfficialCandidateOpen(closed), false);

  const coverage = buildOfficialNightlifeCoverage([], [candidate, closed]);
  assert.equal(coverage.sourceCandidates, 2);
  assert.equal(coverage.activeCandidates, 1);
  assert.equal(coverage.inactiveCandidates, 1);
  assert.equal(coverage.unmatchedCandidates, 1);
  assert.equal(coverage.coverageRate, 0);
});

test("official nightlife coverage endpoint is protected, read-only, and honest about Oceanfront", () => {
  const source = readFileSync(
    new URL("../../../app/api/venues/official-nightlife-coverage/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /isCronAuthorized\(request\)/);
  assert.match(source, /mode: "read-only-review"/);
  assert.match(source, /sourceStatus: scopeSourceStatus/);
  assert.match(source, /No current official source found exposes a complete machine-readable Oceanfront/);
  assert.doesNotMatch(source, /\.insert\(|\.upsert\(|\.update\(|\.delete\(/);
});
