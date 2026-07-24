/* eslint-disable @typescript-eslint/no-explicit-any -- Legacy geocoder records are normalized at runtime. */
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

const supabase = getSupabaseAdmin();

function cleanName(value?: string | null) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeName(value?: string | null) {
  return cleanName(value).toLowerCase();
}

function guessCityFromVenueName(venueName: string) {
  const lower = venueName.toLowerCase();

  if (lower.includes("virginia beach")) return "Virginia Beach";
  if (lower.includes("norfolk")) return "Norfolk";
  if (lower.includes("chesapeake")) return "Chesapeake";
  if (lower.includes("hampton")) return "Hampton";
  if (lower.includes("newport news")) return "Newport News";
  if (lower.includes("portsmouth")) return "Portsmouth";

  return "Norfolk"; // default
}

function cityCoords(city: string) {
  const key = city.toLowerCase();

  if (key.includes("virginia beach")) return { lat: 36.8529, lng: -75.9780 };
  if (key.includes("norfolk")) return { lat: 36.8508, lng: -76.2859 };
  if (key.includes("chesapeake")) return { lat: 36.7682, lng: -76.2875 };
  if (key.includes("hampton")) return { lat: 37.0299, lng: -76.3452 };
  if (key.includes("newport news")) return { lat: 37.0871, lng: -76.4730 };
  if (key.includes("portsmouth")) return { lat: 36.8354, lng: -76.2983 };

  return { lat: 36.8508, lng: -76.2859 };
}

export async function GET(req: Request) {
  const requestUrl = new URL(req.url);
  const secret = requestUrl.searchParams.get("secret");

  if (secret !== process.env.CRON_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    // 1. Get events
    const { data: events, error: eventsError } = await supabase
      .from("events")
      .select("venue_name, source, source_url")
      .not("venue_name", "is", null);

    if (eventsError) {
      return NextResponse.json({ error: eventsError }, { status: 500 });
    }

    // 2. Get existing venues
    const { data: venues, error: venuesError } = await supabase
      .from("venues")
      .select("id, name, city");

    if (venuesError) {
      return NextResponse.json({ error: venuesError }, { status: 500 });
    }

    const existing = new Set(
      (venues || []).map(
        (v: any) =>
          `${normalizeName(v.name)}__${normalizeName(v.city)}`
      )
    );

    const uniqueVenueMap = new Map<string, any>();

    // 3. Build new venues
    for (const event of events || []) {
      const venueName = cleanName(event.venue_name);

      if (
        !venueName ||
        venueName.toLowerCase() === "unknown venue" ||
        venueName.toLowerCase().includes("event")
      ) {
        continue;
      }

      const city = guessCityFromVenueName(venueName);
      const coords = cityCoords(city);

      const key = `${normalizeName(venueName)}__${normalizeName(city)}`;

      if (existing.has(key) || uniqueVenueMap.has(key)) continue;

      uniqueVenueMap.set(key, {
        name: venueName,
        city,
        address: null,
        lat: coords.lat,
        lng: coords.lng,
        type: "event_venue",
        category: "Events",
        music: null,
        age: null,
        cover: event.source === "eventbrite" ? "Eventbrite" : "Varies",
        parking: null,
        dress_code: null,
      });
    }

    const newVenues = Array.from(uniqueVenueMap.values());

    if (!newVenues.length) {
      return NextResponse.json({
        success: true,
        inserted: 0,
        message: "No new venues to insert",
      });
    }

    // 4. Insert
    const { error: insertError } = await supabase
      .from("venues")
      .insert(newVenues);

    if (insertError) {
      return NextResponse.json({ error: insertError }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      inserted: newVenues.length,
      sample: newVenues.slice(0, 10),
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        error: "Failed to sync event venues",
        details: error?.message || error,
      },
      { status: 500 }
    );
  }
}
