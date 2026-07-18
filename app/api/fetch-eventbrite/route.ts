/* eslint-disable @typescript-eslint/no-explicit-any -- Eventbrite payloads vary by source and expansion. */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isCronAuthorized } from "../../../src/lib/cron-auth";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const EVENTBRITE_API_BASE = "https://www.eventbriteapi.com/v3";

export async function GET(req: Request) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const token = process.env.EVENTBRITE_PRIVATE_TOKEN;

  if (!token) {
    return NextResponse.json(
      { error: "Missing EVENTBRITE_PRIVATE_TOKEN" },
      { status: 500 }
    );
  }

  try {
    const now = new Date();
    const rangeEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const searchParams = new URLSearchParams({
      "location.address": "Norfolk, VA",
      "location.within": "50mi",
      "start_date.range_start": now.toISOString(),
      "start_date.range_end": rangeEnd.toISOString(),
      expand: "venue,ticket_availability",
      sort_by: "date",
    });

    const eventbriteUrl = `${EVENTBRITE_API_BASE}/events/search/?${searchParams.toString()}`;

    const response = await fetch(eventbriteUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });

    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      console.error("Eventbrite API error:", {
        status: response.status,
        payload,
        url: eventbriteUrl,
      });

      return NextResponse.json(
        {
          error: "Eventbrite API request failed",
          status: response.status,
          details: payload,
          note:
            response.status === 404
              ? "The endpoint was not found. Confirm Eventbrite still enables /v3/events/search/ for your token/account."
              : undefined,
        },
        { status: response.status }
      );
    }

    const events = Array.isArray(payload?.events) ? payload.events : [];

    const formatted = events
      .map((event: any) => {
        const venue = event.venue || null;
        const ticketAvailability = event.ticket_availability || null;

        return {
          source_event_id: `eventbrite:${event.id}`,
          name: event.name?.text || event.name?.html || "Eventbrite Event",
          venue_name: venue?.name || venue?.address?.localized_address_display || "Unknown Venue",
          start_time: event.start?.utc || event.start?.local || null,
          end_time: event.end?.utc || event.end?.local || null,
          source: "eventbrite",
          ticket_status: getEventbriteTicketStatus(event, ticketAvailability),
        };
      })
      .filter((event: any) => event.name && event.start_time);

    if (!formatted.length) {
      return NextResponse.json({
        success: true,
        source: "eventbrite",
        found: events.length,
        upserted: 0,
        message: "No Eventbrite events found for Norfolk/757 in the next 30 days.",
      });
    }

    const { error } = await supabase
      .from("events")
      .upsert(formatted, { onConflict: "source_event_id" });

    if (error) {
      console.error("Eventbrite Supabase upsert error:", error);
      return NextResponse.json({ error }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      source: "eventbrite",
      found: events.length,
      upserted: formatted.length,
    });
  } catch (error) {
    console.error("Eventbrite route error:", error);
    return NextResponse.json(
      { error: "Failed to fetch Eventbrite events" },
      { status: 500 }
    );
  }
}

function getEventbriteTicketStatus(event: any, ticketAvailability: any) {
  if (event.is_free) return "Free Entry";
  if (event.status === "sold_out") return "Sold Out";
  if (event.status === "ended") return "Ended";
  if (event.status === "canceled") return "Cancelled";

  const hasAvailableTickets = ticketAvailability?.has_available_tickets;
  const minimumTicketPrice = ticketAvailability?.minimum_ticket_price;
  const maximumTicketPrice = ticketAvailability?.maximum_ticket_price;

  if (hasAvailableTickets === false) return "Sold Out";
  if (minimumTicketPrice || maximumTicketPrice) return "Tickets Available";

  return "Available";
}
