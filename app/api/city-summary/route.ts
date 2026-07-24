/* eslint-disable @typescript-eslint/no-explicit-any -- This compatibility endpoint shapes legacy venue payloads. */
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

const supabaseAdmin = getSupabaseAdmin();

function normalizeCity(value?: string | null) {
  return String(value || "").trim();
}

function cityFromAddress(address?: string | null, fallback?: string | null) {
  const match = String(address || "").match(
    /,\s*(Norfolk|Virginia Beach|Chesapeake|Portsmouth|Suffolk|Hampton|Newport News)\s*,\s*VA\b/i
  );

  if (!match?.[1]) return normalizeCity(fallback) || "757";
  return match[1].toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function isToday(dateValue?: string | null) {
  if (!dateValue) return false;

  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return false;

  const dateKey = date.toLocaleDateString("en-CA", {
    timeZone: "America/New_York",
  });
  const todayKey = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/New_York",
  });

  return dateKey === todayKey;
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
  todayEvents: any[];
  cityLeaders: ReturnType<typeof getCityGroup>;
}) {
  const {
    city,
    topVenues,
    hotVenues,
    todayEvents,
    cityLeaders,
  } = args;

  const topNames = getVenueNameList(topVenues, 3);
  const hotNames = getVenueNameList(hotVenues, 3);
  const leadCity = cityLeaders[0]?.city;
  const leadNames = getVenueNameList(
    [...(cityLeaders[0]?.venues || [])].sort(
      (a, b) => Number(b.ai_score || 0) - Number(a.ai_score || 0)
    ),
    3
  );
  const area = city === "All 757" ? "across the 757" : `in ${city}`;
  const modelLine = "The forecast updates automatically from schedules, venue patterns, ratings, and time of day.";

  if (city !== "All 757") {
    if (hotVenues.length > 0) {
      return `${hotNames || topNames} ${
        hotVenues.length === 1 ? "leads" : "lead"
      } tonight's ${city} forecast. ${modelLine}`;
    }

    if (todayEvents.length > 0) {
      return `${todayEvents.length} event${todayEvents.length === 1 ? " is" : "s are"} scheduled ${area} today. ${
        topNames || "The event venues"
      } ${topNames ? "rank highest for tonight" : "will anchor tonight's picks"}. ${modelLine}`;
    }

    return `${topNames || "A few local spots"} ${
      topNames ? "rank highest" : "are being ranked"
    } for ${city} tonight. ${modelLine}`;
  }

  if (leadCity && hotVenues.length > 0) {
    return `${leadCity} leads tonight's automatic forecast. ${
      leadNames || hotNames || topNames
    } ${hotVenues.length === 1 ? "is" : "are"} among the strongest moves. ${modelLine}`;
  }

  if (todayEvents.length > 0) {
    return `${todayEvents.length} event${todayEvents.length === 1 ? " is" : "s are"} scheduled ${area} today. ${
      topNames || "The event venues"
    } ${topNames ? "lead tonight's shortlist" : "anchor the forecast"}. ${modelLine}`;
  }

  return `${topNames || "The 757's venues"} ${
    topNames ? "lead tonight's shortlist" : "are being ranked for tonight"
  }. ${modelLine}`;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const city = url.searchParams.get("city") || "All 757";

    const venueQuery = supabaseAdmin
      .from("venues")
      .select(
        "id,name,city,address,type,category,ai_score,ai_status,ai_summary,photo_url,google_rating,enriched_at"
      )
      .order("ai_score", { ascending: false })
      .limit(600);

    const { data: venues, error: venuesError } = await venueQuery;

    if (venuesError) {
      return NextResponse.json(
        { success: false, error: venuesError.message },
        { status: 500 }
      );
    }

    const { data: events, error: eventsError } = await supabaseAdmin
      .from("events")
      .select("id,name,venue_name,start_time,source,source_url,created_at")
      .gte(
        "start_time",
        new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()
      )
      .order("start_time", { ascending: true })
      .limit(500);

    if (eventsError) {
      return NextResponse.json(
        { success: false, error: eventsError.message },
        { status: 500 }
      );
    }

    const safeVenues = (venues || [])
      .map((venue) => ({
        ...venue,
        city: cityFromAddress(venue.address, venue.city),
        automatic_score: Number(venue.ai_score || 0),
      }))
      .filter((venue) => city === "All 757" || venue.city === city);
    const safeEvents = events || [];

    const topVenues = safeVenues
      .filter((venue) => Number(venue.ai_score || 0) > 0)
      .sort(
        (a, b) =>
          Number(b.ai_score || 0) - Number(a.ai_score || 0)
      )
      .slice(0, 8);

    const hotVenues = safeVenues
      .filter((venue) => Number(venue.ai_score || 0) >= 55)
      .sort((a, b) => Number(b.ai_score || 0) - Number(a.ai_score || 0))
      .slice(0, 8);

    const todayEvents = safeEvents.filter((event) => isToday(event.start_time));

    const cityLeaders = getCityGroup(safeVenues);

    const summary = buildSummary({
      city,
      topVenues,
      hotVenues,
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
      forecast_model: {
        automatic: true,
        inputs: ["event schedules", "venue intelligence", "ratings", "venue type", "time of day"],
      },
      data_freshness: {
        events_last_synced_at:
          safeEvents
            .map((event) => event.created_at)
            .filter(Boolean)
            .sort()
            .at(-1) || null,
        venue_photos: safeVenues.filter((venue) => Boolean(venue.photo_url)).length,
        venues: safeVenues.length,
      },
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
