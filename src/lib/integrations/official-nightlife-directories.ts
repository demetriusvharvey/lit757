import type { PriorityNightlifeScope } from "../buzz/priority-nightlife-scopes";
import { venueCityFromAddress } from "../venue-dedupe";
import { distanceMiles, normalizeVenueName, venueNameSimilarity } from "./osm";

export type OfficialNightlifeEvidence =
  | "official-nightlife-directory"
  | "official-nightlife-category"
  | "official-brewery-taphouse-category";

export type OfficialNightlifeCandidate = {
  sourceId: "downtown-norfolk-nightlife" | "portsmouth-visitor-directory";
  sourceUrl: string;
  sourceItemId: string | null;
  scopeId: PriorityNightlifeScope["id"];
  name: string;
  city: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  categories: string[];
  operatingStatus: string | null;
  evidence: OfficialNightlifeEvidence;
};

export type VenueForOfficialDirectoryMatch = {
  id: string;
  name: string;
  city?: string | null;
  address?: string | null;
  lat?: number | string | null;
  lng?: number | string | null;
  phone?: string | null;
  website?: string | null;
  category?: string | null;
  type?: string | null;
};

export type OfficialNightlifeMatch = {
  candidate: OfficialNightlifeCandidate;
  venue: VenueForOfficialDirectoryMatch;
  nameScore: number;
  distanceMiles: number | null;
  addressMatched: boolean;
};

export const DOWNTOWN_NORFOLK_NIGHTLIFE_URL =
  "https://www.downtownnorfolk.org/explore/nightlife";
export const PORTSMOUTH_VISITOR_DIRECTORY_URL =
  "https://portsvacation.com/visitor-directory/";
export const PORTSMOUTH_VISITOR_DIRECTORY_API_URL =
  "https://api.imgoingcalendar.com/api/visitors/PortsmouthVA/places";

const USER_AGENT = "Buzz/1.0 official nightlife coverage (https://lit757.vercel.app)";
const FETCH_TIMEOUT_MS = 30_000;
const MAX_SOURCE_BYTES = 30_000_000;
const CLOSED_STATUSES = new Set(["CLOSED_PERMANENTLY", "CLOSED_TEMPORARILY"]);

function clean(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function coordinate(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed !== 0 ? parsed : null;
}

function decodeHtml(value: string) {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: "\"",
  };
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&#(x?[0-9a-f]+);/gi, (_match, code: string) => (
      String.fromCodePoint(Number.parseInt(code.replace(/^x/i, ""), /^x/i.test(code) ? 16 : 10))
    ))
    .replace(/&([a-z]+);/gi, (match, entity: string) => named[entity.toLowerCase()] ?? match)
    .replace(/\s+/g, " ")
    .trim();
}

function absoluteSourceUrl(href: string) {
  try {
    const url = new URL(href, DOWNTOWN_NORFOLK_NIGHTLIFE_URL);
    return ["http:", "https:"].includes(url.protocol)
      ? url.toString()
      : DOWNTOWN_NORFOLK_NIGHTLIFE_URL;
  } catch {
    return DOWNTOWN_NORFOLK_NIGHTLIFE_URL;
  }
}

function safeHttpUrl(value: unknown, fallback: string) {
  const raw = clean(value);
  if (!raw) return fallback;
  try {
    const url = new URL(raw);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : fallback;
  } catch {
    return fallback;
  }
}

export function parseDowntownNorfolkNightlifeHtml(html: string) {
  const candidates: OfficialNightlifeCandidate[] = [];
  const blocks = html.matchAll(
    /<div\s+class=["']pst["']>\s*<a\s+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>\s*<\/div>/gi,
  );

  for (const match of blocks) {
    const body = match[2];
    const nameMatch = body.match(/<div\s+class=["']pst-name["'][^>]*>([\s\S]*?)<\/div>/i);
    const addressMatch = body.match(/<div\s+class=["']pst-address["'][^>]*>([\s\S]*?)<\/div>/i);
    const name = nameMatch ? decodeHtml(nameMatch[1]) : "";
    if (!name) continue;

    candidates.push({
      sourceId: "downtown-norfolk-nightlife",
      sourceUrl: absoluteSourceUrl(match[1]),
      sourceItemId: match[1].split("/").filter(Boolean).at(-1) || null,
      scopeId: "downtown-norfolk",
      name,
      city: "Norfolk",
      address: addressMatch ? clean(decodeHtml(addressMatch[1])) : null,
      latitude: null,
      longitude: null,
      categories: ["All Nightlife and Entertainment"],
      operatingStatus: null,
      evidence: "official-nightlife-directory",
    });
  }

  return [...new Map(candidates.map(candidate => [
    `${normalizeVenueName(candidate.name)}|${normalizeVenueName(candidate.address)}`,
    candidate,
  ])).values()];
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map(clean).filter((item): item is string => Boolean(item))
    : [];
}

function portsmouthEvidence(categories: string[]): OfficialNightlifeEvidence | null {
  const normalized = new Set(categories.map(category => category.trim().toLowerCase()));
  if (
    normalized.has("nightlife & live music")
    || normalized.has("night club")
    || normalized.has("bar")
  ) {
    return "official-nightlife-category";
  }
  return normalized.has("brewery & taphouses")
    ? "official-brewery-taphouse-category"
    : null;
}

export function parsePortsmouthVisitorDirectory(payload: unknown) {
  if (!Array.isArray(payload)) throw new Error("Portsmouth visitor directory returned a non-array payload");
  const candidates: OfficialNightlifeCandidate[] = [];

  for (const item of payload) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const name = clean(record.name || record.title);
    const categories = stringArray(record.categoryList);
    const evidence = portsmouthEvidence(categories);
    if (!name || !evidence) continue;

    candidates.push({
      sourceId: "portsmouth-visitor-directory",
      sourceUrl: safeHttpUrl(record.website, PORTSMOUTH_VISITOR_DIRECTORY_URL),
      sourceItemId: clean(record._id || record.id),
      scopeId: "portsmouth-city",
      name,
      city: "Portsmouth",
      address: clean(record.address),
      latitude: coordinate(record.lat),
      longitude: coordinate(record.lng),
      categories,
      operatingStatus: clean(record.business_status),
      evidence,
    });
  }

  return [...new Map(candidates.map(candidate => [
    `${normalizeVenueName(candidate.name)}|${normalizeVenueName(candidate.address)}`,
    candidate,
  ])).values()];
}

async function sourceResponse(url: string) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: { Accept: "application/json, text/html;q=0.9", "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`${new URL(url).hostname} returned HTTP ${response.status}`);
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > MAX_SOURCE_BYTES) throw new Error(`${new URL(url).hostname} response is too large`);
  const body = await response.text();
  if (body.length > MAX_SOURCE_BYTES) throw new Error(`${new URL(url).hostname} response is too large`);
  return body;
}

export async function fetchDowntownNorfolkNightlife() {
  const candidates = parseDowntownNorfolkNightlifeHtml(
    await sourceResponse(DOWNTOWN_NORFOLK_NIGHTLIFE_URL),
  );
  if (!candidates.length) throw new Error("Downtown Norfolk nightlife directory returned no listings");
  return candidates;
}

export async function fetchPortsmouthVisitorNightlife() {
  const body = await sourceResponse(PORTSMOUTH_VISITOR_DIRECTORY_API_URL);
  const candidates = parsePortsmouthVisitorDirectory(JSON.parse(body));
  if (!candidates.length) throw new Error("Portsmouth visitor directory returned no nightlife listings");
  return candidates;
}

export function isOfficialCandidateOpen(candidate: OfficialNightlifeCandidate) {
  return !CLOSED_STATUSES.has(String(candidate.operatingStatus || "").toUpperCase());
}

function venueCity(venue: VenueForOfficialDirectoryMatch) {
  return venueCityFromAddress(venue.address) || clean(venue.city);
}

function sameCity(venue: VenueForOfficialDirectoryMatch, candidate: OfficialNightlifeCandidate) {
  return normalizeVenueName(venueCity(venue)) === normalizeVenueName(candidate.city);
}

const GENERIC_DIRECTORY_NAME_TOKENS = new Set([
  "and",
  "bar",
  "club",
  "lounge",
  "nightclub",
  "pub",
  "restaurant",
  "theater",
  "theatre",
]);

function directoryName(value: unknown) {
  return normalizeVenueName(value)
    .split(" ")
    .filter(token => !GENERIC_DIRECTORY_NAME_TOKENS.has(token))
    .join(" ");
}

function directoryNameSimilarity(left: unknown, right: unknown) {
  return Math.max(
    venueNameSimilarity(left, right),
    venueNameSimilarity(directoryName(left), directoryName(right)),
  );
}

function streetAddress(value: unknown) {
  const firstLine = String(value || "").split(",")[0];
  return normalizeVenueName(firstLine)
    .replace(/\b(?:street|st)\b/g, "st")
    .replace(/\b(?:avenue|ave)\b/g, "ave")
    .replace(/\b(?:boulevard|blvd)\b/g, "blvd")
    .replace(/\b(?:drive|dr)\b/g, "dr")
    .replace(/\b(?:highway|hwy)\b/g, "hwy")
    .replace(/\b(?:parkway|pkwy)\b/g, "pkwy")
    .replace(/\b(?:road|rd)\b/g, "rd")
    .replace(/\s+/g, " ")
    .trim();
}

function sameAddress(venue: VenueForOfficialDirectoryMatch, candidate: OfficialNightlifeCandidate) {
  const left = streetAddress(venue.address);
  const right = streetAddress(candidate.address);
  return Boolean(left && right && left === right);
}

export function findBestOfficialNightlifeMatch(
  candidate: OfficialNightlifeCandidate,
  venues: readonly VenueForOfficialDirectoryMatch[],
): OfficialNightlifeMatch | null {
  const candidateLat = coordinate(candidate.latitude);
  const candidateLng = coordinate(candidate.longitude);
  const matches: OfficialNightlifeMatch[] = [];

  for (const venue of venues) {
    if (!sameCity(venue, candidate)) continue;
    const nameScore = directoryNameSimilarity(venue.name, candidate.name);
    if (nameScore < 0.92) continue;
    const addressMatched = sameAddress(venue, candidate);

    const venueLat = coordinate(venue.lat);
    const venueLng = coordinate(venue.lng);
    let distance: number | null = null;
    if (candidateLat !== null && candidateLng !== null && venueLat !== null && venueLng !== null) {
      distance = distanceMiles(candidateLat, candidateLng, venueLat, venueLng);
      if (distance > 0.5) continue;
    } else if (nameScore < 0.95 && !addressMatched) {
      continue;
    }
    matches.push({ candidate, venue, nameScore, distanceMiles: distance, addressMatched });
  }

  return matches.sort((left, right) => {
    const leftDistance = left.distanceMiles ?? 0.5;
    const rightDistance = right.distanceMiles ?? 0.5;
    return (right.nameScore * 100 - rightDistance * 8)
      - (left.nameScore * 100 - leftDistance * 8);
  })[0] || null;
}

export function buildOfficialNightlifeCoverage(
  venues: readonly VenueForOfficialDirectoryMatch[],
  candidates: readonly OfficialNightlifeCandidate[],
) {
  const active = candidates.filter(isOfficialCandidateOpen);
  const inactive = candidates.filter(candidate => !isOfficialCandidateOpen(candidate));
  const reviewed = active.map(candidate => ({
    candidate,
    match: findBestOfficialNightlifeMatch(candidate, venues),
  }));
  const matched = reviewed.filter(item => item.match);
  const unmatched = reviewed.filter(item => !item.match);
  return {
    sourceCandidates: candidates.length,
    activeCandidates: active.length,
    inactiveCandidates: inactive.length,
    matchedCandidates: matched.length,
    unmatchedCandidates: unmatched.length,
    coverageRate: active.length ? Number((matched.length / active.length).toFixed(3)) : null,
    reviewed,
    inactive,
  };
}
