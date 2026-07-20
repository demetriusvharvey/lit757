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
};

type BestTimeLiveResponse = {
  status?: string;
  message?: string;
  analysis?: {
    venue_forecasted_busyness?: number;
    venue_forecast_busyness_available?: boolean;
    venue_live_busyness?: number;
    venue_live_busyness_available?: boolean;
    venue_live_forecasted_delta?: number;
    hour_start?: number;
    hour_end?: number;
  };
  venue_info?: BestTimeVenueInfo;
};

type BestTimeForecastResponse = {
  status?: string;
  message?: string;
  epoch_analysis?: number;
  venue_info?: BestTimeVenueInfo;
};

export type BestTimeVenueMapping = {
  venueId: string;
  providerVenueId: string;
  providerName: string | null;
  providerAddress: string | null;
  timezone: string | null;
  metadata: Record<string, unknown>;
};

function apiKey() {
  return process.env.BESTTIME_API_KEY_PRIVATE || "";
}

export function isBestTimeConfigured() {
  return Boolean(apiKey());
}

async function bestTimeRequest<T>(path: string, params: URLSearchParams, method: "GET" | "POST" = "POST") {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    params.set("api_key_private", apiKey());
    const response = await fetch(`${BASE_URL}${path}?${params.toString()}`, {
      method,
      cache: "no-store",
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({})) as T & { status?: string; message?: string };
    if (!response.ok || payload.status === "Error") {
      throw new Error(payload.message || `BestTime request failed (${response.status})`);
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

export async function createBestTimeForecast(venue: VenueForBuzz): Promise<BestTimeVenueMapping> {
  if (!isBestTimeConfigured()) throw new Error("BESTTIME_API_KEY_PRIVATE is not configured");
  const address = [venue.address, venue.city].filter(Boolean).join(", ");
  if (!address) throw new Error(`Cannot create BestTime forecast for ${venue.name} without an address`);
  const params = new URLSearchParams({ venue_name: venue.name, venue_address: address });
  const payload = await bestTimeRequest<BestTimeForecastResponse>("/forecasts", params);
  const providerVenueId = payload.venue_info?.venue_id;
  if (!providerVenueId) throw new Error(`BestTime did not return a venue id for ${venue.name}`);

  return {
    venueId: venue.id,
    providerVenueId,
    providerName: payload.venue_info?.venue_name || null,
    providerAddress: payload.venue_info?.venue_address || null,
    timezone: payload.venue_info?.venue_timezone || null,
    metadata: { epochAnalysis: payload.epoch_analysis || null },
  };
}

export async function fetchBestTimeLive(providerVenueId: string) {
  if (!isBestTimeConfigured()) throw new Error("BESTTIME_API_KEY_PRIVATE is not configured");
  const params = new URLSearchParams({ venue_id: providerVenueId });
  try {
    return await bestTimeRequest<BestTimeLiveResponse>("/forecasts/live", params);
  } catch (error) {
    // The documentation has historically shown both singular and plural routes.
    if (!(error instanceof Error) || !error.message.includes("404")) throw error;
    return bestTimeRequest<BestTimeLiveResponse>("/forecast/live", new URLSearchParams({ venue_id: providerVenueId }));
  }
}

export function bestTimeSignals(payload: BestTimeLiveResponse, observedAt = new Date()): BuzzSignal[] {
  const analysis = payload.analysis || {};
  const observed = observedAt.toISOString();
  const nextHour = new Date(observedAt);
  nextHour.setMinutes(70, 0, 0);
  const liveExpires = nextHour.toISOString();
  const forecastExpires = new Date(observedAt.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const commonMetadata = {
    providerVenueId: payload.venue_info?.venue_id || null,
    providerName: payload.venue_info?.venue_name || null,
    providerAddress: payload.venue_info?.venue_address || null,
    openStatus: payload.venue_info?.venue_open || null,
    timezone: payload.venue_info?.venue_timezone || null,
    liveForecastDelta: analysis.venue_live_forecasted_delta ?? null,
    dwellMinutes: payload.venue_info?.venue_dwell_time_avg ?? null,
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
      expiresAt: forecastExpires,
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
      expiresAt: liveExpires,
      metadata: commonMetadata,
    });
  }
  return signals;
}
