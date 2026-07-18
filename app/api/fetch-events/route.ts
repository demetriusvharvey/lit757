import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isCronAuthorized } from "../../../src/lib/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
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

export async function GET(req: Request) {
  if (!isCronAuthorized(req)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const requestUrl = new URL(req.url);
  const secret = process.env.CRON_SECRET!;
  const baseUrl = requestUrl.origin;

  try {
    const ticketmasterResult = await fetchTicketmasterEvents();

    const eventbriteApiResult = await safeInternalFetch(
      `${baseUrl}/api/fetch-eventbrite`,
      secret
    );

    const eventbriteScrapeResult = await safeInternalFetch(
      `${baseUrl}/api/scrape-eventbrite`,
      secret
    );

    const venueScoreResult = await safeInternalFetch(
      `${baseUrl}/api/run-venue-intelligence`,
      secret
    );

    const dataQualityResult = await safeInternalFetch(
      `${baseUrl}/api/data-quality`,
      secret
    );

    return NextResponse.json({
      success: true,
      synced_at: new Date().toISOString(),
      ticketmaster: ticketmasterResult,
      eventbrite_api: eventbriteApiResult,
      eventbrite_scrape: eventbriteScrapeResult,
      venue_scores: venueScoreResult,
      data_quality: dataQualityResult,
    }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    console.error("Pipeline error:", err);
    return NextResponse.json(
      { error: "Failed to run event pipeline" },
      { status: 500 }
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

  const allFormatted = [];
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
      `https://app.ticketmaster.com/discovery/v2/events.json?apikey=${API_KEY}` +
      `&city=${encodeURIComponent(city)}&stateCode=VA&size=100` +
      `&startDateTime=${encodeURIComponent(startDateTime)}` +
      `&endDateTime=${encodeURIComponent(endDateTime)}` +
      `&sort=date,asc`;

    const res = await fetch(ticketmasterUrl, { cache: "no-store" });
    if (!res.ok) {
      sourceErrors.push({ city, status: res.status });
      continue;
    }
    const data = (await res.json()) as TicketmasterResponse;

    const events = data._embedded?.events || [];

    const formatted = events.map((event) => {
      const venue = event._embedded?.venues?.[0];

      return {
        source_event_id: `ticketmaster_${event.id}`,
        name: event.name,
        venue_name: venue?.name || `${city} Event`,
        start_time: event.dates?.start?.dateTime || null,
        end_time: null,
        source: "ticketmaster",
        ticket_status: getTicketStatus(event),
        source_url: event.url || null,
        created_at: syncedAt,
      };
    });

    allFormatted.push(...formatted);
  }

  if (!allFormatted.length) {
    return { success: true, upserted: 0, message: "No Ticketmaster events found" };
  }

  const { error } = await supabase
    .from("events")
    .upsert(allFormatted, { onConflict: "source_event_id" });

  if (error) {
    console.error("Ticketmaster upsert error:", error);
    return { success: false, error };
  }

  return {
    success: true,
    source: "ticketmaster",
    upserted: allFormatted.length,
    city_errors: sourceErrors,
  };
}

async function safeInternalFetch(url: string, secret: string) {
  try {
    const res = await fetch(url, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${secret}` },
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
