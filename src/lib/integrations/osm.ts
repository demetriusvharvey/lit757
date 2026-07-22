export const OVERPASS_ENDPOINTS = process.env.OVERPASS_API_URL
  ? [process.env.OVERPASS_API_URL]
  : [
    "https://overpass.maprva.org/api/interpreter",
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
  ];

export const HAMPTON_ROADS_OSM_BOUNDS = {
  south: 36.42,
  west: -76.95,
  north: 37.38,
  east: -75.70,
} as const;

export type OsmElement = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: Record<string, string>;
};

export type OsmVenueCandidate = {
  osmType: OsmElement["type"];
  osmId: number;
  osmUrl: string;
  name: string;
  latitude: number;
  longitude: number;
  city: string | null;
  address: string | null;
  phone: string | null;
  website: string | null;
  category: string;
  type: string;
  rawTag: { key: string; value: string };
  tags: Record<string, string>;
};

export type VenueForOsmMatch = {
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

export type OsmVenueMatch = {
  venue: VenueForOsmMatch;
  candidate: OsmVenueCandidate;
  nameScore: number;
  distanceMiles: number | null;
  cityMatched: boolean;
};

const RELEVANT_TAGS = {
  amenity: [
    "arts_centre",
    "bar",
    "biergarten",
    "bowling_alley",
    "cafe",
    "cinema",
    "community_centre",
    "fast_food",
    "food_court",
    "marketplace",
    "music_venue",
    "nightclub",
    "pub",
    "restaurant",
    "theatre",
  ],
  tourism: ["aquarium", "attraction", "gallery", "museum", "theme_park", "zoo"],
  leisure: [
    "amusement_arcade",
    "dance",
    "fitness_centre",
    "garden",
    "golf_course",
    "park",
    "sports_centre",
    "stadium",
    "water_park",
  ],
  shop: ["mall"],
} as const;

const GENERIC_VALUES = new Set(["", "other", "unknown", "local spot", "local business", "place"]);
const CORPORATE_TOKENS = new Set(["llc", "inc", "incorporated", "ltd", "company", "co"]);

function regex(values: readonly string[]) {
  return `^(${values.join("|")})$`;
}

export function buildHamptonRoadsOverpassQuery() {
  const { south, west, north, east } = HAMPTON_ROADS_OSM_BOUNDS;
  const bbox = `${south},${west},${north},${east}`;
  return `[out:json][timeout:40][maxsize:536870912];\n(\n`
    + `  nwr["name"]["amenity"~"${regex(RELEVANT_TAGS.amenity)}"](${bbox});\n`
    + `  nwr["name"]["tourism"~"${regex(RELEVANT_TAGS.tourism)}"](${bbox});\n`
    + `  nwr["name"]["leisure"~"${regex(RELEVANT_TAGS.leisure)}"](${bbox});\n`
    + `  nwr["name"]["shop"~"${regex(RELEVANT_TAGS.shop)}"](${bbox});\n`
    + `);\nout tags center qt;`;
}

function clean(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function first(tags: Record<string, string>, keys: string[]) {
  for (const key of keys) {
    const value = clean(tags[key]);
    if (value) return value;
  }
  return null;
}

function address(tags: Record<string, string>) {
  const street = [clean(tags["addr:housenumber"]), clean(tags["addr:street"])]
    .filter((value): value is string => Boolean(value))
    .join(" ") || null;
  const parts = [
    street,
    clean(tags["addr:city"]),
    clean(tags["addr:state"]),
    clean(tags["addr:postcode"]),
  ].filter((value): value is string => Boolean(value));
  return parts.join(", ") || clean(tags["addr:full"]);
}

function titleCase(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, character => character.toUpperCase());
}

function categoryFor(key: string, value: string) {
  if (key === "amenity") {
    if (["bar", "pub", "nightclub", "biergarten", "music_venue"].includes(value)) return "Nightlife";
    if (["restaurant", "cafe", "fast_food", "food_court"].includes(value)) return "Food";
    if (["theatre", "cinema", "arts_centre"].includes(value)) return "Arts & Culture";
    if (value === "bowling_alley") return "Entertainment";
    if (value === "marketplace") return "Shopping";
    if (value === "community_centre") return "Community";
  }
  if (key === "tourism") {
    if (["museum", "gallery"].includes(value)) return "Arts & Culture";
    return "Attraction";
  }
  if (key === "leisure") {
    if (["park", "garden", "golf_course"].includes(value)) return "Outdoors";
    if (["fitness_centre", "sports_centre", "stadium", "dance"].includes(value)) return "Sports & Fitness";
    return "Entertainment";
  }
  if (key === "shop") return "Shopping";
  return "Local Spot";
}

function relevantTag(tags: Record<string, string>) {
  for (const key of ["amenity", "tourism", "leisure", "shop"] as const) {
    const value = clean(tags[key]);
    if (value) return { key, value };
  }
  return null;
}

export function normalizeOsmElement(element: OsmElement): OsmVenueCandidate | null {
  const tags = element.tags || {};
  const name = first(tags, ["name", "brand", "operator"]);
  const latitude = Number(element.lat ?? element.center?.lat);
  const longitude = Number(element.lon ?? element.center?.lon);
  const rawTag = relevantTag(tags);
  if (!name || !rawTag || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  return {
    osmType: element.type,
    osmId: element.id,
    osmUrl: `https://www.openstreetmap.org/${element.type}/${element.id}`,
    name,
    latitude,
    longitude,
    city: first(tags, ["addr:city", "addr:place", "is_in:city", "is_in:town"]),
    address: address(tags),
    phone: first(tags, ["contact:phone", "phone"]),
    website: first(tags, ["contact:website", "website", "url"]),
    category: categoryFor(rawTag.key, rawTag.value),
    type: titleCase(rawTag.value),
    rawTag,
    tags,
  };
}

export function parseOverpassResponse(payload: unknown) {
  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const osm3s = record.osm3s && typeof record.osm3s === "object"
    ? record.osm3s as Record<string, unknown>
    : {};
  const elements = Array.isArray(record.elements) ? record.elements as OsmElement[] : [];
  const candidates = elements
    .map(normalizeOsmElement)
    .filter((candidate): candidate is OsmVenueCandidate => Boolean(candidate));
  return {
    generatedAt: new Date().toISOString(),
    osmBaseTimestamp: clean(osm3s.timestamp_osm_base),
    copyright: clean(osm3s.copyright),
    rawElementCount: elements.length,
    candidates: [...new Map(candidates.map(candidate => [
      `${candidate.osmType}:${candidate.osmId}`,
      candidate,
    ])).values()],
  };
}

export async function fetchOsmVenueCandidates() {
  const query = buildHamptonRoadsOverpassQuery();
  const errors: string[] = [];
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "Buzz/1.0 (https://lit757.vercel.app; demetriusvharvey@gmail.com)",
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(48_000),
      });
      if (!response.ok) {
        const body = (await response.text()).slice(0, 500);
        errors.push(`${endpoint} returned ${response.status}: ${body}`);
        continue;
      }
      return {
        ...parseOverpassResponse(await response.json()),
        endpoint,
      };
    } catch (error) {
      errors.push(`${endpoint}: ${error instanceof Error ? error.message : "request failed"}`);
    }
  }
  throw new Error(`All Overpass endpoints failed: ${errors.join(" | ")}`);
}

export function normalizeVenueName(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^the\s+/, "")
    .split(" ")
    .filter(token => token && !CORPORATE_TOKENS.has(token))
    .join(" ");
}

function tokens(value: string) {
  return new Set(value.split(" ").filter(Boolean));
}

export function venueNameSimilarity(leftValue: unknown, rightValue: unknown) {
  const left = normalizeVenueName(leftValue);
  const right = normalizeVenueName(rightValue);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if ((left.includes(right) || right.includes(left)) && Math.min(left.length, right.length) >= 6) return 0.92;
  const leftTokens = tokens(left);
  const rightTokens = tokens(right);
  const intersection = [...leftTokens].filter(token => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return union ? intersection / union : 0;
}

function radians(value: number) {
  return value * Math.PI / 180;
}

export function distanceMiles(lat1: number, lng1: number, lat2: number, lng2: number) {
  const dLat = radians(lat2 - lat1);
  const dLng = radians(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLng / 2) ** 2;
  return 3_958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function validCoordinate(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed !== 0 ? parsed : null;
}

function cityMatches(venue: VenueForOsmMatch, candidate: OsmVenueCandidate) {
  const venueCity = normalizeVenueName(venue.city);
  const candidateCity = normalizeVenueName(candidate.city);
  if (!venueCity || !candidateCity) return false;
  return venueCity === candidateCity || venueCity.includes(candidateCity) || candidateCity.includes(venueCity);
}

function informationScore(candidate: OsmVenueCandidate) {
  return [candidate.address, candidate.phone, candidate.website, candidate.city].filter(Boolean).length;
}

export function findBestOsmMatch(
  venue: VenueForOsmMatch,
  candidates: OsmVenueCandidate[],
): OsmVenueMatch | null {
  const latitude = validCoordinate(venue.lat);
  const longitude = validCoordinate(venue.lng);
  const hasCoordinates = latitude !== null && longitude !== null;
  const matches: OsmVenueMatch[] = [];

  for (const candidate of candidates) {
    const nameScore = venueNameSimilarity(venue.name, candidate.name);
    if (nameScore < 0.72) continue;
    const matchedCity = cityMatches(venue, candidate);
    let distance: number | null = null;
    if (hasCoordinates) {
      distance = distanceMiles(latitude, longitude, candidate.latitude, candidate.longitude);
      const maximum = nameScore >= 0.95 ? 1 : 0.35;
      if (distance > maximum) continue;
    } else if (nameScore < 0.95 || !matchedCity) {
      continue;
    }
    matches.push({ venue, candidate, nameScore, distanceMiles: distance, cityMatched: matchedCity });
  }

  return matches.sort((left, right) => {
    const leftScore = left.nameScore * 100
      + (left.cityMatched ? 8 : 0)
      + informationScore(left.candidate) * 2
      - (left.distanceMiles || 0) * 8;
    const rightScore = right.nameScore * 100
      + (right.cityMatched ? 8 : 0)
      + informationScore(right.candidate) * 2
      - (right.distanceMiles || 0) * 8;
    return rightScore - leftScore;
  })[0] || null;
}

function missing(value: unknown) {
  return !clean(value);
}

function generic(value: unknown) {
  return GENERIC_VALUES.has(normalizeVenueName(value));
}

export function osmEnrichmentPatch(match: OsmVenueMatch, enrichedAt = new Date().toISOString()) {
  const { venue, candidate } = match;
  const patch: Record<string, unknown> = {};
  if (missing(venue.address) && candidate.address) patch.address = candidate.address;
  if (missing(venue.phone) && candidate.phone) patch.phone = candidate.phone;
  if (missing(venue.website) && candidate.website) patch.website = candidate.website;
  if (generic(venue.category) && candidate.category) patch.category = candidate.category;
  if (generic(venue.type) && candidate.type) patch.type = candidate.type;

  const venueLat = validCoordinate(venue.lat);
  const venueLng = validCoordinate(venue.lng);
  if (venueLat === null && venueLng === null && match.nameScore >= 0.95 && match.cityMatched) {
    patch.lat = candidate.latitude;
    patch.lng = candidate.longitude;
  }

  if (!Object.keys(patch).length) return null;
  patch.enriched_at = enrichedAt;
  return patch;
}

export function summarizeOsmCandidates(candidates: OsmVenueCandidate[]) {
  const byCategory = candidates.reduce<Record<string, number>>((counts, candidate) => {
    counts[candidate.category] = (counts[candidate.category] || 0) + 1;
    return counts;
  }, {});
  const withAddress = candidates.filter(candidate => candidate.address).length;
  const withPhone = candidates.filter(candidate => candidate.phone).length;
  const withWebsite = candidates.filter(candidate => candidate.website).length;
  return { total: candidates.length, byCategory, withAddress, withPhone, withWebsite };
}
