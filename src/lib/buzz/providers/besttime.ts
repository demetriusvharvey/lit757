import type { BuzzSignal, VenueForBuzz } from "../types";

const BASE_URL = "https://besttime.app/api/v1";
const TIMEOUT_MS = 12_000;

type BestTimeVenueInfo = {
  venue_id?: string;
  venue_name?: string;
  venue_address?: string;
  venue_open?: string;
  venue_timezone?: string;
  venue_dwell_time_min?: number;
  venue_dwell_time_max?: number;
  venue_dwell_time_avg?: number;
  venue_current_localtime_iso?: string;
};

export type BestTimeLiveResponse = {
  status?: string;
  message?: string;
  day_int?: number;
  epoch_analysis?: number;
  forecast_updated_on?: string;
  analysis?: {
    venue_forecasted_busyness?: number;
    venue_forecast_busyness_available?: boolean;
    venue_live_busyness?: number;
    venue_live_busyness_available?: boolean;
    venue_live_forecasted_delta?: number;
    hour_start?: number;
    hour_end?: number;
    hour_raw?: number;
    hour_analysis?: {
      hour?: number;
      intensity_nr?: number;
      intensity_txt?: string;
    };
  };
  venue_info?: BestTimeVenueInfo;
};

type BestTimeForecastResponse = {
  status?: string;
  message?: string;
  epoch_analysis?: number;
  forecast_updated_on?: string;
  venue_info?: BestTimeVenueInfo;
};

export type BestTimeAccountVenue = {
  epoch_analysis?: number;
  forecast_updated_on?: string;
  venue_address?: string;
  venue_forecasted?: boolean | string | number;
  venue_id?: string;
  venue_name?: string;
  venue_timezone?: string;
};

export type BestTimeVenueMapping = {
  venueId: string;
  providerVenueId: string;
  providerName: string | null;
  providerAddress: string | null;
  timezone: string | null;
  metadata: Record<string, unknown>;
};

type BestTimeKeyKind = "private" | "public";

class BestTimeRequestError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message);
    this.name = "BestTimeRequestError";
  }
}

let accountVenuesPromise: Promise<BestTimeAccountVenue[]> | null = null;

function privateApiKey() {
  return process.env.BESTTIME_API_KEY_PRIVATE || "";
}

function publicApiKey() {
  return process.env.BESTTIME_API_KEY_PUBLIC || "";
}

export function isBestTimeConfigured() {
  return Boolean(privateApiKey());
}

export function isBestTimeForecastQueryConfigured() {
  return Boolean(publicApiKey());
}

function responseMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return fallback;
  const record = payload as { message?: unknown; error?: unknown };
  return String(record.message || record.error || fallback);
}

async function bestTimeRequest<T>(
  path: string,
  params: URLSearchParams,
  options: { method?: "GET" | "POST"; keyKind?: BestTimeKeyKind } = {},
) {
  const method = options.method || "GET";
  const keyKind = options.keyKind || "private";
  const key = keyKind === "public" ? publicApiKey() : privateApiKey();
  const keyName = keyKind === "public" ? "api_key_public" : "api_key_private";
  if (!key) throw new Error(`${keyName.toUpperCase()} is not configured`);

  const query = new URLSearchParams(params);
  query.set(keyName, key);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${BASE_URL}${path}?${query.toString()}`, {
      method,
      cache: "no-store",
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({})) as T;
    const status = !Array.isArray(payload) && payload && typeof payload === "object"
      ? String((payload as { status?: unknown }).status || "")
      : "";
    if (!response.ok || status.toLowerCase() === "error") {
      throw new BestTimeRequestError(
        responseMessage(payload, `BestTime request failed (${response.status})`),
        response.status,
      );
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeName(value: string | null | undefined) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/^the\s+/, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function normalizeAddress(value: string | null | undefined) {
  return String(value || "")
    .toLowerCase()
    .replace(/\b(united states|usa)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function streetNumber(value: string | null | undefined) {
  return normalizeAddress(value).match(/^\d+[a-z]?/)?.[0] || "";
}

function namesMatch(localName: string, providerName: string) {
  const local = normalizeName(localName);
  const provider = normalizeName(providerName);
  if (!local || !provider) return false;
  if (local === provider) return true;
  return Math.min(local.length, provider.length) >= 7 && (local.includes(provider) || provider.includes(local));
}

function accountVenueArray(value: unknown): BestTimeAccountVenue[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter(item => item && typeof item === "object" && !Array.isArray(item)) as BestTimeAccountVenue[];
}

export function extractBestTimeAccountVenues(payload: unknown): BestTimeAccountVenue[] {
  const direct = accountVenueArray(payload);
  if (direct) return direct;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];

  const record = payload as Record<string, unknown>;
  for (const key of ["venues", "data", "results", "items"]) {
    const candidate = accountVenueArray(record[key]);
    if (candidate) return candidate;
  }

  const data = record.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const nested = data as Record<string, unknown>;
    for (const key of ["venues", "results", "items"]) {
      const candidate = accountVenueArray(nested[key]);
      if (candidate) return candidate;
    }
  }

  const arrays = Object.values(record).map(accountVenueArray).filter((value): value is BestTimeAccountVenue[] => value !== null);
  return arrays.length === 1 ? arrays[0] : [];
}

export function isBestTimeAccountVenueForecasted(venue: BestTimeAccountVenue) {
  return venue.venue_forecasted === true
    || venue.venue_forecasted === 1
    || String(venue.venue_forecasted).toLowerCase() === "true";
}

export function findBestTimeAccountVenue(venue: VenueForBuzz, accountVenues: BestTimeAccountVenue[]) {
  const nameMatches = accountVenues.filter(candidate => namesMatch(venue.name, candidate.venue_name || ""));
  if (!nameMatches.length) return null;

  const localNumber = streetNumber(venue.address);
  if (localNumber) {
    const numberMatches = nameMatches.filter(candidate => streetNumber(candidate.venue_address) === localNumber);
    if (numberMatches.length === 1) return numberMatches[0];
  }

  const city = normalizeAddress(venue.city);
  if (city) {
    const cityMatches = nameMatches.filter(candidate => normalizeAddress(candidate.venue_address).includes(city));
    if (cityMatches.length === 1) return cityMatches[0];
  }

  return nameMatches.length === 1 ? nameMatches[0] : null;
}

export async function listBestTimeAccountVenues() {
  if (!isBestTimeConfigured()) throw new Error("BESTTIME_API_KEY_PRIVATE is not configured");
  if (!accountVenuesPromise) {
    accountVenuesPromise = bestTimeRequest<unknown>(
      "/venues",
      new URLSearchParams({ limit: "1000", page: "0" }),
      { method: "GET", keyKind: "private" },
    ).then(extractBestTimeAccountVenues);
  }
  return accountVenuesPromise;
}

export function resetBestTimeAccountVenueCacheForTests() {
  accountVenuesPromise = null;
}

export function mappingFromBestTimeAccountVenue(venue: VenueForBuzz, accountVenue: BestTimeAccountVenue): BestTimeVenueMapping {
  if (!accountVenue.venue_id) throw new Error(`BestTime account venue is missing an id for ${venue.name}`);
  return {
    venueId: venue.id,
    providerVenueId: accountVenue.venue_id,
    providerName: accountVenue.venue_name || null,
    providerAddress: accountVenue.venue_address || null,
    timezone: accountVenue.venue_timezone || null,
    metadata: {
      epochAnalysis: accountVenue.epoch_analysis || null,
      forecastUpdatedOn: accountVenue.forecast_updated_on || null,
      reusedExistingForecast: true,
    },
  };
}

export async function findExistingBestTimeForecast(
  venue: VenueForBuzz,
  accountVenues?: BestTimeAccountVenue[],
) {
  const venues = accountVenues || await listBestTimeAccountVenues();
  const accountVenue = findBestTimeAccountVenue(venue, venues);
  if (!accountVenue || !isBestTimeAccountVenueForecasted(accountVenue) || !accountVenue.venue_id) return null;
  return mappingFromBestTimeAccountVenue(venue, accountVenue);
}

export async function createBestTimeForecast(venue: VenueForBuzz): Promise<BestTimeVenueMapping> {
  if (!isBestTimeConfigured()) throw new Error("BESTTIME_API_KEY_PRIVATE is not configured");
  const address = [venue.address, venue.city].filter(Boolean).join(", ");
  if (!address) throw new Error(`Cannot create BestTime forecast for ${venue.name} without an address`);

  const accountVenues = await listBestTimeAccountVenues();
  const accountVenue = findBestTimeAccountVenue(venue, accountVenues);
  if (accountVenue) {
    if (!isBestTimeAccountVenueForecasted(accountVenue)) {
      throw new Error(`BestTime found ${venue.name}, but does not have enough visitor history to forecast it`);
    }
    return mappingFromBestTimeAccountVenue(venue, accountVenue);
  }

  const params = new URLSearchParams({ venue_name: venue.name, venue_address: address });
  const payload = await bestTimeRequest<BestTimeForecastResponse>(
    "/forecasts",
    params,
    { method: "POST", keyKind: "private" },
  );
  const providerVenueId = payload.venue_info?.venue_id;
  if (!providerVenueId) throw new Error(`BestTime did not return a venue id for ${venue.name}`);

  return {
    venueId: venue.id,
    providerVenueId,
    providerName: payload.venue_info?.venue_name || null,
    providerAddress: payload.venue_info?.venue_address || null,
    timezone: payload.venue_info?.venue_timezone || null,
    metadata: {
      epochAnalysis: payload.epoch_analysis || null,
      forecastUpdatedOn: payload.forecast_updated_on || null,
      reusedExistingForecast: false,
    },
  };
}

async function fetchBestTimeForecastNow(providerVenueId: string) {
  if (!isBestTimeForecastQueryConfigured()) {
    throw new Error("BESTTIME_API_KEY_PUBLIC is not configured");
  }
  return bestTimeRequest<BestTimeLiveResponse>(
    "/forecasts/now/raw",
    new URLSearchParams({ venue_id: providerVenueId }),
    { method: "GET", keyKind: "public" },
  );
}

function forecastAsLiveCompatible(payload: BestTimeLiveResponse): BestTimeLiveResponse {
  const raw = Number(payload.analysis?.hour_raw);
  const hour = payload.analysis?.hour_analysis?.hour;
  return {
    ...payload,
    analysis: {
      ...payload.analysis,
      venue_forecasted_busyness: raw,
      venue_forecast_busyness_available: Number.isFinite(raw),
      venue_live_busyness_available: false,
      hour_start: hour,
      hour_end: Number.isFinite(Number(hour)) ? (Number(hour) + 1) % 24 : undefined,
    },
  };
}

export async function fetchBestTimeCurrentForecast(providerVenueId: string) {
  return forecastAsLiveCompatible(await fetchBestTimeForecastNow(providerVenueId));
}

function noLiveData(error: unknown) {
  return error instanceof Error && /no live data available/i.test(error.message);
}

async function requestBestTimeLive(providerVenueId: string) {
  const params = new URLSearchParams({ venue_id: providerVenueId });
  try {
    return await bestTimeRequest<BestTimeLiveResponse>(
      "/forecasts/live",
      params,
      { method: "POST", keyKind: "private" },
    );
  } catch (error) {
    if (!(error instanceof BestTimeRequestError) || error.statusCode !== 404) throw error;
    return bestTimeRequest<BestTimeLiveResponse>(
      "/forecast/live",
      new URLSearchParams({ venue_id: providerVenueId }),
      { method: "POST", keyKind: "private" },
    );
  }
}

export async function fetchBestTimeLive(providerVenueId: string) {
  if (!isBestTimeConfigured()) throw new Error("BESTTIME_API_KEY_PRIVATE is not configured");
  try {
    return await requestBestTimeLive(providerVenueId);
  } catch (error) {
    if (!noLiveData(error)) throw error;
    if (!isBestTimeForecastQueryConfigured()) {
      return {
        status: "OK",
        message: "No live data available and BESTTIME_API_KEY_PUBLIC is not configured",
        analysis: {
          venue_forecast_busyness_available: false,
          venue_live_busyness_available: false,
        },
        venue_info: { venue_id: providerVenueId },
      } satisfies BestTimeLiveResponse;
    }
    return fetchBestTimeCurrentForecast(providerVenueId);
  }
}

export function bestTimeSignals(payload: BestTimeLiveResponse, observedAt = new Date()): BuzzSignal[] {
  const analysis = payload.analysis || {};
  const observed = observedAt.toISOString();
  const nextHour = new Date(observedAt);
  nextHour.setMinutes(70, 0, 0);
  const expiresAt = nextHour.toISOString();
  const commonMetadata = {
    providerVenueId: payload.venue_info?.venue_id || null,
    providerName: payload.venue_info?.venue_name || null,
    providerAddress: payload.venue_info?.venue_address || null,
    openStatus: payload.venue_info?.venue_open || null,
    timezone: payload.venue_info?.venue_timezone || null,
    liveForecastDelta: analysis.venue_live_forecasted_delta ?? null,
    dwellMinutes: payload.venue_info?.venue_dwell_time_avg ?? null,
    forecastUpdatedOn: payload.forecast_updated_on || null,
    forecastIntensity: analysis.hour_analysis?.intensity_txt || null,
    localHour: analysis.hour_analysis?.hour ?? analysis.hour_start ?? null,
  };
  const signals: BuzzSignal[] = [];

  if (analysis.venue_forecast_busyness_available && Number.isFinite(Number(analysis.venue_forecasted_busyness))) {
    signals.push({
      source: "besttime",
      family: "foot_traffic",
      type: "besttime_forecast",
      value: Number(analysis.venue_forecasted_busyness),
      isLive: false,
      confidence: 0.58,
      observedAt: observed,
      expiresAt,
      metadata: commonMetadata,
    });
  }
  if (analysis.venue_live_busyness_available && Number.isFinite(Number(analysis.venue_live_busyness))) {
    signals.push({
      source: "besttime",
      family: "foot_traffic",
      type: "besttime_live",
      value: Number(analysis.venue_live_busyness),
      isLive: true,
      confidence: 0.82,
      observedAt: observed,
      expiresAt,
      metadata: commonMetadata,
    });
  }
  return signals;
}
