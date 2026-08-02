import { ACTIVITY_DISTRICTS } from "./buzz/districts";

export type LocationSearchResult = {
  id: string;
  name: string;
  detail: string;
  featureType: string;
  longitude: number;
  latitude: number;
  bbox: number[] | null;
};

type LocalLocation = LocationSearchResult & { aliases: string[] };

const HAMPTON_ROADS_CITIES: LocalLocation[] = [
  ["norfolk", "Norfolk", 36.8508, -76.2859],
  ["virginia-beach", "Virginia Beach", 36.8424, -76.1356],
  ["chesapeake", "Chesapeake", 36.7687, -76.235],
  ["portsmouth", "Portsmouth", 36.8353, -76.2983],
  ["suffolk", "Suffolk", 36.7282, -76.5836],
  ["hampton", "Hampton", 37.0299, -76.3452],
  ["newport-news", "Newport News", 37.0877, -76.473],
].map(([id, name, latitude, longitude]) => ({
  id: `local-city:${id}`,
  name: String(name),
  detail: "Hampton Roads city",
  featureType: "place",
  longitude: Number(longitude),
  latitude: Number(latitude),
  bbox: null,
  aliases: [String(name), `${name} va`, `${name} virginia`],
}));

const ACTIVITY_DISTRICT_LOCATIONS: LocalLocation[] = ACTIVITY_DISTRICTS.map(district => ({
  id: `local-district:${district.id}`,
  name: district.name,
  detail: `${district.city} activity district`,
  featureType: "neighborhood",
  longitude: district.center.lng,
  latitude: district.center.lat,
  bbox: null,
  aliases: [
    district.name,
    district.shortName,
    district.id.replaceAll("-", " "),
    `${district.shortName} ${district.city}`,
    ...district.points.map(point => point.label),
  ],
}));

const LOCAL_LOCATIONS = [...HAMPTON_ROADS_CITIES, ...ACTIVITY_DISTRICT_LOCATIONS];

function normalize(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function matchRank(location: LocalLocation, query: string) {
  const aliases = location.aliases.map(normalize);
  if (aliases.some(alias => alias === query)) return 0;
  if (aliases.some(alias => alias.startsWith(query))) return 1;

  const queryParts = query.split(" ").filter(Boolean);
  if (queryParts.length && aliases.some(alias => queryParts.every(part => alias.includes(part)))) return 2;
  if (aliases.some(alias => alias.includes(query))) return 3;
  return null;
}

/**
 * Gives Buzz useful regional area search without making a metered network call.
 * Venue-name and address matching remains available separately through /api/nearby.
 */
export function searchLocalLocations(query: string, limit = 8): LocationSearchResult[] {
  const normalizedQuery = normalize(query);
  if (normalizedQuery.length < 2 || limit <= 0) return [];

  return LOCAL_LOCATIONS.flatMap((location, index) => {
    const rank = matchRank(location, normalizedQuery);
    return rank == null ? [] : [{ location, rank, index }];
  })
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .slice(0, limit)
    .map(({ location }) => ({
      id: location.id,
      name: location.name,
      detail: location.detail,
      featureType: location.featureType,
      longitude: location.longitude,
      latitude: location.latitude,
      bbox: location.bbox,
    }));
}

export function mergeLocationResults(
  local: LocationSearchResult[],
  external: LocationSearchResult[],
  limit = 8,
) {
  const seen = new Set<string>();
  const results: LocationSearchResult[] = [];

  for (const result of [...local, ...external]) {
    const key = `${normalize(result.name)}:${result.latitude.toFixed(3)}:${result.longitude.toFixed(3)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(result);
    if (results.length >= limit) break;
  }

  return results;
}
