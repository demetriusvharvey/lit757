import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(req: Request) {
  const requestUrl = new URL(req.url);
  const secret = requestUrl.searchParams.get("secret");

  if (secret !== process.env.CRON_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  const baseUrl = requestUrl.origin;

  try {
    const ticketmasterResult = await fetchTicketmasterEvents();

    const eventbriteResult = await safeInternalFetch(
      `${baseUrl}/api/scrape-eventbrite?secret=${secret}`
    );

    const venueIntelResult = await safeInternalFetch(
      `${baseUrl}/api/agents/run-venue-intel?secret=${secret}`
    );

    return NextResponse.json({
      success: true,
      ticketmaster: ticketmasterResult,
      eventbrite: eventbriteResult,
      venue_intel: venueIntelResult,
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

  const cities = ["Norfolk", "Virginia Beach", "Chesapeake", "Hampton", "Newport News"];

  const allFormatted = [];

  for (const city of cities) {
    const ticketmasterUrl =
      `https://app.ticketmaster.com/discovery/v2/events.json?apikey=${API_KEY}` +
      `&city=${encodeURIComponent(city)}&stateCode=VA&size=50`;

    const res = await fetch(ticketmasterUrl);
    const data = await res.json();

    const events = data._embedded?.events || [];

    const formatted = events.map((event: any) => {
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
  };
}

async function safeInternalFetch(url: string) {
  try {
    const res = await fetch(url, { cache: "no-store" });
    const data = await res.json().catch(() => null);

    return {
      success: res.ok,
      status: res.status,
      data,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error?.message || "Internal fetch failed",
    };
  }
}

function getTicketStatus(event: any) {
  const status = event.dates?.status?.code;

  if (status === "offsale") return "Sold Out";
  if (status === "cancelled") return "Cancelled";
  if (status === "postponed") return "Postponed";
  if (status === "onsale") return "Available";

  return "Available";
}