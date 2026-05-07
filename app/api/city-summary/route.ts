import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function normalizeCity(value?: string | null) {
  return String(value || "").trim();
}

function isToday(dateValue?: string | null) {
  if (!dateValue) return false;

  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return false;

  const now = new Date();

  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

function hoursSince(dateValue?: string | null) {
  if (!dateValue) return null;

  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return null;

  return (Date.now() - date.getTime()) / (1000 * 60 * 60);
}

function getVenueNameList(venues: any[], max = 3) {
  const names = venues
    .map((venue) => venue.name)
    .filter(Boolean)
    .slice(0, max);

  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;

  return `${names[0]}, ${names[1]}, and ${names[2]}`;
}

function getCityGroup(venues: any[]) {
  const groups = venues.reduce<Record<string, any[]>>((acc, venue) => {
    const city = normalizeCity(venue.city || "757");
    acc[city] = acc[city] || [];
    acc[city].push(venue);
    return acc;
  }, {});

  return Object.entries(groups)
    .map(([city, cityVenues]) => {
      const avgScore =
        cityVenues.reduce((sum, venue) => sum + Number(venue.ai_score || 0), 0) /
        Math.max(1, cityVenues.length);

      const hotCount = cityVenues.filter(
        (venue) => Number(venue.ai_score || 0) >= 55
      ).length;

      return {
        city,
        venues: cityVenues,
        avgScore,
        hotCount,
        weight: avgScore + hotCount * 6,
      };
    })
    .sort((a, b) => b.weight - a.weight);
}

function buildSummary(args: {
  city: string;
  topVenues: any[];
  hotVenues: any[];
  quietVenues: any[];
  freshSignals: any[];
  todayEvents: any[];
  cityLeaders: ReturnType<typeof getCityGroup>;
}) {
  const {
    city,
    topVenues,
    hotVenues,
    quietVenues,
    freshSignals,
    todayEvents,
    cityLeaders,
  } = args;

  const topNames = getVenueNameList(topVenues, 3);
  const hotNames = getVenueNameList(hotVenues, 3);
  const quietName = quietVenues[0]?.name;
  const leadCity = cityLeaders[0]?.city;

  const signalLine =
    freshSignals.length > 0
      ? "Fresh movement is starting to come in from people out tonight."
      : "The night is still early, so the read is mostly based on events, venue history, and current momentum.";

  if (city !== "All 757") {
    if (hotVenues.length > 0) {
      return `${city} has some movement tonight. ${hotNames || topNames} ${
        hotVenues.length === 1 ? "is" : "are"
      } leading the board right now. ${signalLine}`;
    }

    if (todayEvents.length > 0) {
      return `${city} has events on the calendar tonight, but the energy still looks early. ${
        topNames || "A few spots"
      } ${
        topNames ? "are worth watching" : "may pick up later"
      }. ${signalLine}`;
    }

    return `${city} looks calm right now. ${topNames || "A few spots"} ${
      topNames ? "are still worth keeping an eye on" : "may heat up later"
    }. ${signalLine}`;
  }

  if (leadCity && hotVenues.length > 0) {
    return `${leadCity} has the strongest movement tonight. ${
      hotNames || topNames
    } ${hotVenues.length === 1 ? "is" : "are"} leading right now. ${
      quietName ? `${quietName} looks quieter for the moment.` : ""
    } ${signalLine}`;
  }

  if (todayEvents.length > 0) {
    return `Tonight has activity across the 757, but it is still warming up. ${
      topNames || "The event spots"
    } ${
      topNames ? "are the first places to watch" : "should lead the early movement"
    }. ${signalLine}`;
  }

  return `The 757 looks calm right now, but the map is ready to shift as people start moving. ${
    topNames || "A few spots"
  } ${
    topNames ? "are worth watching first" : "should surface once activity starts"
  }. ${signalLine}`;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const city = url.searchParams.get("city") || "All 757";

    let venueQuery = supabaseAdmin
      .from("venues")
      .select(
        "id,name,city,type,category,ai_score,ai_status,ai_summary,photo_url,google_rating,enriched_at"
      )
      .order("ai_score", { ascending: false })
      .limit(250);

    if (city !== "All 757") {
      venueQuery = venueQuery.eq("city", city);
    }

    const { data: venues, error: venuesError } = await venueQuery;

    if (venuesError) {
      return NextResponse.json(
        { success: false, error: venuesError.message },
        { status: 500 }
      );
    }

    const { data: events, error: eventsError } = await supabaseAdmin
      .from("events")
      .select("id,name,venue_name,start_time,source,source_url")
      .order("start_time", { ascending: true })
      .limit(200);

    if (eventsError) {
      return NextResponse.json(
        { success: false, error: eventsError.message },
        { status: 500 }
      );
    }

    const { data: signals, error: signalsError } = await supabaseAdmin
      .from("venue_signals")
      .select("id,venue_id,vibe_type,comment,created_at")
      .gte(
        "created_at",
        new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString()
      )
      .limit(200);

    if (signalsError) {
      return NextResponse.json(
        { success: false, error: signalsError.message },
        { status: 500 }
      );
    }

    const safeVenues = venues || [];
    const safeEvents = events || [];
    const safeSignals = signals || [];

    const topVenues = safeVenues
      .filter((venue) => Number(venue.ai_score || 0) > 0)
      .slice(0, 8);

    const hotVenues = safeVenues
      .filter((venue) => Number(venue.ai_score || 0) >= 55)
      .slice(0, 8);

    const quietVenues = safeVenues
      .filter((venue) => Number(venue.ai_score || 0) <= 30)
      .slice(0, 8);

    const freshSignals = safeSignals.filter((signal) => {
      const h = hoursSince(signal.created_at);
      return h !== null && h <= 6;
    });

    const todayEvents = safeEvents.filter((event) => isToday(event.start_time));

    const cityLeaders = getCityGroup(safeVenues);

    const summary = buildSummary({
      city,
      topVenues,
      hotVenues,
      quietVenues,
      freshSignals,
      todayEvents,
      cityLeaders,
    });

    return NextResponse.json({
      success: true,
      city,
      summary,
      top_venues: topVenues.slice(0, 5).map((venue) => ({
        id: venue.id,
        name: venue.name,
        city: venue.city,
        score: venue.ai_score,
        status: venue.ai_status,
        summary: venue.ai_summary,
        photo_url: venue.photo_url,
      })),
      hot_venues: hotVenues.slice(0, 5).map((venue) => ({
        id: venue.id,
        name: venue.name,
        city: venue.city,
        score: venue.ai_score,
        status: venue.ai_status,
      })),
      today_events: todayEvents.slice(0, 5).map((event) => ({
        id: event.id,
        title: event.name,
        venue_name: event.venue_name,
        start_time: event.start_time,
        source_url: event.source_url,
      })),
      fresh_signals: freshSignals.length,
      city_leaders: cityLeaders.slice(0, 5).map((item) => ({
        city: item.city,
        weight: Math.round(item.weight),
        hot_count: item.hotCount,
        avg_score: Math.round(item.avgScore),
      })),
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: error.message,
      },
      { status: 500 }
    );
  }
}