import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isCronAuthorized } from "../../../src/lib/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

type TicketmasterEvent = {
  id?: string;
  name?: string;
  url?: string;
  dates?: {
    start?: { dateTime?: string };
    status?: { code?: string };
  };
  _embedded?: { venues?: Array<{ name?: string }> };
};

type TicketmasterResponse = {
  _embedded?: { events?: TicketmasterEvent[] };
};

type ImportedEvent = {
  id: string;
  source_event_id: string;
  venue_name: string | null;
};

type VenueLookup = {
  id: string;
  name: string;
};

const normalize = (value: unknown) => String(value || "")
  .toLowerCase()
  .normalize("NFKD")
  .replace(/\p{Diacritic}/gu, "")
  .replace(/&/g, " and ")
  .replace(/[^a-z0-9\s]/g, " ")
  .replace(/\s+/g, " ")
  .trim()
  .replace(/^the\s+/, "");

export async function GET(req: Request) {
  if (!isCronAuthorized(req)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const requestUrl = new URL(req.url);
  const secret = process.env.CRON_SECRET!;
  const baseUrl = requestUrl.origin;

  try {
    const ticketmasterResult = await fetchTicketmasterEvents();
    const [eventbriteResult, seatGeekResult] = await Promise.all([
      safeInternalFetch(`${baseUrl}/api/fetch-eventbrite`, secret),
      safeInternalFetch(`${baseUrl}/api/fetch-seatgeek`, secret),
    ]);
    const venueScoreResult = await safeInternalFetch(
      `${baseUrl}/api/run-venue-intelligence`,
      secret,
    );
    const dataQualityResult = await safeInternalFetch(
      `${baseUrl}/api/data-quality`,
      secret,
    );

    return NextResponse.json({
      success: true,
      synced_at: new Date().toISOString(),
      ticketmaster: ticketmasterResult,
      eventbrite: eventbriteResult,
      seatgeek: seatGeekResult,
      venue_scores: venueScoreResult,
      data_quality: dataQualityResult,
    }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    console.error("Pipeline error:", err);
    return NextResponse.json(
      { success: false, error: "Failed to run event pipeline" },
      { status: 500 },
    );
  }
}

async function fetchTicketmasterEvents() {
  const API_KEY = process.env.TICKETMASTER_API_KEY;

  if (!API_KEY) {
    return { success: false, error: "Missing Ticketmaster API key" };
  }

  const cities = [
    "Norfolk",
    "Virginia Beach",
    "Chesapeake",
    "Portsmouth",
    "Suffolk",
    "Hampton",
    "Newport News",
  ];

  const allFormatted: Array<{
    source_event_id: string;
    name: string;
    venue_name: string;
    start_time: string;
    end_time: null;
    source: "ticketmaster";
    ticket_status: string;
    source_url: string | null;
    created_at: string;
  }> = [];
  const sourceErrors: Array<{ city: string; status: number }> = [];
  const startDateTime = new Date(Date.now() - 6 * 60 * 60 * 1000)
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z");
  const endDateTime = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000)
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z");
  const syncedAt = new Date().toISOString();

  for (const city of cities) {
    const ticketmasterUrl =
      `https://app.ticketmaster.com/discovery/v2/events.json?apikey=${API_KEY}`
      + `&city=${encodeURIComponent(city)}&stateCode=VA&size=100`
      + `&startDateTime=${encodeURIComponent(startDateTime)}`
      + `&endDateTime=${encodeURIComponent(endDateTime)}`
      + `&sort=date,asc`;

    const res = await fetch(ticketmasterUrl, {
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) {
      sourceErrors.push({ city, status: res.status });
      continue;
    }
    const data = (await res.json()) as TicketmasterResponse;
    const events = data._embedded?.events || [];

    for (const event of events) {
      const startTime = event.dates?.start?.dateTime;
      if (!event.id || !event.name || !startTime) continue;
      const venue = event._embedded?.venues?.[0];
      allFormatted.push({
        source_event_id: `ticketmaster_${event.id}`,
        name: event.name,
        venue_name: venue?.name || `${city} Event`,
        start_time: startTime,
        end_time: null,
        source: "ticketmaster",
        ticket_status: getTicketStatus(event),
        source_url: event.url || null,
        created_at: syncedAt,
      });
    }
  }

  const uniqueEvents = [...new Map(allFormatted.map(event => [event.source_event_id, event])).values()];
  if (!uniqueEvents.length) {
    return { success: true, upserted: 0, message: "No Ticketmaster events found", city_errors: sourceErrors };
  }

  const { data, error } = await supabase
    .from("events")
    .upsert(uniqueEvents, { onConflict: "source_event_id" })
    .select("id,source_event_id,venue_name");

  if (error) {
    console.error("Ticketmaster upsert error:", error);
    return { success: false, error };
  }

  const inventoryMappings = await syncTicketmasterInventoryMappings((data || []) as ImportedEvent[]);

  return {
    success: true,
    source: "ticketmaster",
    upserted: uniqueEvents.length,
    city_errors: sourceErrors,
    inventory_mappings: inventoryMappings,
  };
}

async function syncTicketmasterInventoryMappings(events: ImportedEvent[]) {
  if (!events.length) return { mapped: 0, unmatched: 0, error: null as string | null };

  const { data: venueData, error: venueError } = await supabase
    .from("venues")
    .select("id,name")
    .limit(5000);

  if (venueError) return { mapped: 0, unmatched: events.length, error: venueError.message };

  const venueMap = new Map<string, VenueLookup>();
  for (const venue of (venueData || []) as VenueLookup[]) {
    const key = normalize(venue.name);
    if (key && !venueMap.has(key)) venueMap.set(key, venue);
  }

  const mappings = events.flatMap(event => {
    const venue = venueMap.get(normalize(event.venue_name));
    const externalId = event.source_event_id.replace(/^ticketmaster_/, "");
    if (!venue || !externalId) return [];
    return [{
      event_id: event.id,
      venue_id: venue.id,
      provider: "ticketmaster",
      external_id: externalId,
      metadata: { venueName: event.venue_name },
      updated_at: new Date().toISOString(),
    }];
  });

  if (!mappings.length) return { mapped: 0, unmatched: events.length, error: null as string | null };

  const { error: mappingError } = await supabase
    .from("buzz_provider_events")
    .upsert(mappings, { onConflict: "provider,external_id" });

  return {
    mapped: mappingError ? 0 : mappings.length,
    unmatched: events.length - mappings.length,
    error: mappingError?.message || null,
  };
}

async function safeInternalFetch(url: string, secret: string) {
  try {
    const res = await fetch(url, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(20_000),
    });
    const data = await res.json().catch(() => null);

    return {
      success: res.ok,
      status: res.status,
      data,
    };
  } catch (error: unknown) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Internal fetch failed",
    };
  }
}

function getTicketStatus(event: TicketmasterEvent) {
  const status = event.dates?.status?.code;

  if (status === "offsale") return "Sold Out";
  if (status === "cancelled") return "Cancelled";
  if (status === "postponed") return "Postponed";
  if (status === "onsale") return "Available";

  return "Available";
}
