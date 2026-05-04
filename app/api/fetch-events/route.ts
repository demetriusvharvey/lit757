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

  try {
    const API_KEY = process.env.TICKETMASTER_API_KEY;

    if (!API_KEY) {
      return NextResponse.json({ error: "Missing Ticketmaster API key" }, { status: 500 });
    }

    const ticketmasterUrl =
      `https://app.ticketmaster.com/discovery/v2/events.json?apikey=${API_KEY}` +
      `&city=Norfolk&stateCode=VA&size=50`;

    const res = await fetch(ticketmasterUrl);
    const data = await res.json();

    const events = data._embedded?.events || [];

    const formatted = events.map((event: any) => {
      const venue = event._embedded?.venues?.[0];

      return {
        source_event_id: event.id,
        name: event.name,
        venue_name: venue?.name || "Unknown Venue",
        start_time: event.dates?.start?.dateTime || null,
        end_time: null,
        source: "ticketmaster",
        ticket_status: getTicketStatus(event),
      };
    });

    const { error } = await supabase
      .from("events")
      .upsert(formatted, { onConflict: "source_event_id" });

    if (error) {
      console.error("Upsert error:", error);
      return NextResponse.json({ error }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      upserted: formatted.length,
    });
  } catch (err) {
    console.error("Fetch error:", err);
    return NextResponse.json({ error: "Failed to fetch events" }, { status: 500 });
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