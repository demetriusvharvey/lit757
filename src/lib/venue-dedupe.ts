const HAMPTON_ROADS_CITIES = [
  "Virginia Beach",
  "Newport News",
  "Chesapeake",
  "Portsmouth",
  "Norfolk",
  "Hampton",
  "Suffolk",
] as const;

export type VenueIdentityRow = {
  id: string;
  name: string;
  city?: string | null;
  address?: string | null;
  lat?: number | string | null;
  lng?: number | string | null;
  [key: string]: unknown;
};

function normalized(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalName(value: unknown) {
  return normalized(value).replace(/^the\s+/, "");
}

function normalizedCity(value: unknown) {
  const candidate = normalized(value);
  return HAMPTON_ROADS_CITIES.find(city => normalized(city) === candidate) || null;
}

export function venueCityFromAddress(address: unknown) {
  const value = normalized(address);
  if (!value) return null;
  return HAMPTON_ROADS_CITIES.find(city => {
    const cityName = normalized(city);
    return new RegExp(`(?:^|\\s)${cityName.replace(/\s+/g, "\\s+")}(?:\\s+va|\\s+virginia|$)`).test(value);
  }) || null;
}

function coordinate(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function identityKey(row: VenueIdentityRow) {
  const name = canonicalName(row.name);
  const latitude = coordinate(row.lat);
  const longitude = coordinate(row.lng);
  if (!name || latitude === null || longitude === null) return `id:${row.id}`;
  return `${name}:${latitude.toFixed(4)}:${longitude.toFixed(4)}`;
}

function isMissing(value: unknown) {
  return value === null || value === undefined || (typeof value === "string" && !value.trim());
}

function rowQuality(row: VenueIdentityRow) {
  const city = normalizedCity(row.city);
  const addressCity = venueCityFromAddress(row.address);
  let score = addressCity && city === addressCity ? 200 : 0;
  if (row.google_place_id) score += 30;
  if (row.address) score += 10;
  if (row.phone) score += 6;
  if (row.website) score += 6;
  if (row.hours) score += 5;
  if (row.enriched_at) score += 4;
  if (row.ai_summary) score += 2;
  return score;
}

export function dedupeVenueRows<T extends VenueIdentityRow>(rows: readonly T[]) {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = identityKey(row);
    groups.set(key, [...(groups.get(key) || []), row]);
  }

  const venues: T[] = [];
  const sourceIdsByVenue = new Map<string, string[]>();
  const primaryVenueIdBySourceId = new Map<string, string>();

  for (const group of groups.values()) {
    const candidates = [...group].sort((left, right) => rowQuality(right) - rowQuality(left));
    const primary = candidates[0];
    const merged: Record<string, unknown> = { ...primary };
    for (const candidate of candidates.slice(1)) {
      for (const [key, value] of Object.entries(candidate)) {
        if (isMissing(merged[key]) && !isMissing(value)) merged[key] = value;
      }
    }

    const addressCity = venueCityFromAddress(merged.address);
    if (addressCity) merged.city = addressCity;

    const sourceIds = candidates.map(candidate => candidate.id);
    venues.push(merged as T);
    sourceIdsByVenue.set(primary.id, sourceIds);
    for (const sourceId of sourceIds) primaryVenueIdBySourceId.set(sourceId, primary.id);
  }

  return {
    venues,
    sourceIdsByVenue,
    primaryVenueIdBySourceId,
    duplicateRowsRemoved: rows.length - venues.length,
  };
}
