import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { isCronAuthorized } from "../../../src/lib/cron-auth";
import {
  normalizeSeatGeekEvent,
  seatGeekDemandMetadata,
  seatGeekHasMorePages,
  type SeatGeekEvent,
} from "../../../src/lib/events/seatgeek";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const db = getSupabaseAdmin();

const SEATGEEK_API_BASE = "https://api.seatgeek.com/2";
const CENTER_LATITUDE = 36.8508;
const CENTER_LONGITUDE = -76.2859;
const RANGE_MILES = 50;
const MAX_PAGES = 2;

type SeatGeekResponse = {
  events?: SeatGeekEvent[];
  meta?: { page?: number; per_page?: number; total?: number };
};

type ImportedEvent = {
  id: string;
  source_event_id: string;
  venue_name: string | null;
};

type VenueRow = {
  id: string;
  name: string;
};

function normalize(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^the\s+/, "");
}

async function seatGeekRequest(path: string, clientId: string, clientSecret: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const response = await fetch(`${SEATGEEK_API_BASE}${path}`, {
      headers: {
        Authorization: `Basic ${credentials}`,
        Accept: "application/json",
      },
      cache: "no-store",
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null) as SeatGeekResponse | { message?: unknown; error?: unknown } | null;
    if (!response.ok) {
      const message = payload && typeof payload === "object"
        ? String((payload as { message?: unknown; error?: unknown }).message || (payload as { error?: unknown }).error || `HTTP ${response.status}`)
        : `HTTP ${response.status}`;
      const error = new Error(message) as Error & { status?: number };
      error.status = response.status;
      throw error;
    }
    return payload as SeatGeekResponse;
  } finally {
    clearTimeout(timeout);
  }
}

async function syncProviderMappings(imported: ImportedEvent[], sourceEvents: Map<string, SeatGeekEvent>) {
  if (!imported.length) return { mapped: 0, unmatched: 0, error: null as string | null };

  const { data: venues, error: venueError } = await db.from("venues").select("id,name").limit(5000);
  if (venueError) return { mapped: 0, unmatched: imported.length, error: venueError.message };

  const venueMap = new Map<string, VenueRow>();
  for (const venue of (venues || []) as VenueRow[]) {
    const key = normalize(venue.name);
    if (key && !venueMap.has(key)) venueMap.set(key, venue);
  }

  const mappings = imported.flatMap(event => {
    const sourceEvent = sourceEvents.get(event.source_event_id);
    const venue = venueMap.get(normalize(event.venue_name));
    const externalId = event.source_event_id.replace(/^seatgeek:/, "");
    if (!sourceEvent || !venue || !externalId) return [];
    return [{
      event_id: event.id,
      venue_id: venue.id,
      provider: "seatgeek",
      external_id: externalId,
      metadata: seatGeekDemandMetadata(sourceEvent),
      updated_at: new Date().toISOString(),
    }];
  });

  if (!mappings.length) return { mapped: 0, unmatched: imported.length, error: null as string | null };
  const { error } = await db.from("buzz_provider_events").upsert(mappings, { onConflict: "provider,external_id" });
  return {
    mapped: error ? 0 : mappings.length,
    unmatched: imported.length - mappings.length,
    error: error?.message || null,
  };
}

export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const clientId = process.env.SEATGEEK_CLIENT_ID || "";
  const clientSecret = process.env.SEATGEEK_CLIENT_SECRET || "";
  if (!clientId) {
    return NextResponse.json({
      success: false,
      configured: false,
      source: "seatgeek",
      error: "Missing SEATGEEK_CLIENT_ID",
    }, { status: 503 });
  }

  try {
    const now = new Date();
    const end = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
    const providerEvents: SeatGeekEvent[] = [];
    let providerTotal = 0;

    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const params = new URLSearchParams({
        lat: String(CENTER_LATITUDE),
        lon: String(CENTER_LONGITUDE),
        range: `${RANGE_MILES}mi`,
        "datetime_utc.gte": now.toISOString().replace(/\.\d{3}Z$/, ""),
        "datetime_utc.lte": end.toISOString().replace(/\.\d{3}Z$/, ""),
        sort: "datetime_utc.asc",
        per_page: "100",
        page: String(page),
      });
      const payload = await seatGeekRequest(`/events?${params.toString()}`, clientId, clientSecret);
      providerEvents.push(...(Array.isArray(payload.events) ? payload.events : []));
      providerTotal = Number(payload.meta?.total || providerTotal);
      if (!seatGeekHasMorePages(payload)) break;
    }

    const createdAt = new Date().toISOString();
    const normalized = providerEvents
      .map(event => normalizeSeatGeekEvent(event, createdAt))
      .filter((event): event is NonNullable<typeof event> => Boolean(event));
    const rows = [...new Map(normalized.map(event => [event.source_event_id, event])).values()];
    const sourceEvents = new Map<string, SeatGeekEvent>();
    for (const event of providerEvents) {
      const id = String(event.id || "").trim();
      if (id) sourceEvents.set(`seatgeek:${id}`, event);
    }

    let imported: ImportedEvent[] = [];
    if (rows.length) {
      const { data, error } = await db
        .from("events")
        .upsert(rows, { onConflict: "source_event_id" })
        .select("id,source_event_id,venue_name");
      if (error) {
        return NextResponse.json({
          success: false,
          configured: true,
          authenticated: true,
          source: "seatgeek",
          error: "Supabase upsert failed",
          details: error.message,
        }, { status: 500 });
      }
      imported = (data || []) as ImportedEvent[];
    }

    const mappings = await syncProviderMappings(imported, sourceEvents);
    return NextResponse.json({
      success: true,
      configured: true,
      authenticated: true,
      source: "seatgeek",
      providerTotal,
      providerEventsFetched: providerEvents.length,
      marketEventsUpserted: rows.length,
      skippedOutsideMarketOrIncomplete: providerEvents.length - normalized.length,
      demandMappings: mappings,
      coverage: {
        center: { latitude: CENTER_LATITUDE, longitude: CENTER_LONGITUDE },
        rangeMiles: RANGE_MILES,
        horizonDays: 60,
      },
      truthNote: "SeatGeek listings, prices and popularity are scheduled commercial-demand context only. They cannot prove current venue occupancy or mark a venue Live.",
    }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    const status = error instanceof Error && "status" in error
      ? Number((error as Error & { status?: number }).status)
      : 502;
    return NextResponse.json({
      success: false,
      configured: true,
      authenticated: status !== 401 && status !== 403,
      source: "seatgeek",
      error: error instanceof Error ? error.message : "SeatGeek request failed",
    }, { status: Number.isFinite(status) && status >= 400 ? status : 502 });
  }
}
