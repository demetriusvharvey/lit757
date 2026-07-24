import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { isCronAuthorized } from "../../../src/lib/cron-auth";

const supabaseAdmin = getSupabaseAdmin();

type VenueRow = {
  id: string;
  name: string;
  category?: string | null;
  type?: string | null;
  google_types?: string[] | null;
  google_rating?: number | null;
  photo_url?: string | null;
  phone?: string | null;
  website?: string | null;
};

type EventRow = {
  name?: string | null;
  title?: string | null;
  venue_name?: string | null;
  venue?: string | null;
  location?: string | null;
  start_time?: string | null;
  date?: string | null;
  starts_at?: string | null;
};

type IntelligenceResult = {
  venue: string;
  score: number;
  status: string;
  matched_events: number;
  tonight_events: number;
  model: "automatic";
  updated: boolean;
  error: string | null;
};

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function hoursUntil(dateValue?: string | null) {
  if (!dateValue) return null;

  const date = new Date(dateValue);

  if (Number.isNaN(date.getTime())) return null;

  return (date.getTime() - Date.now()) / (1000 * 60 * 60);
}

function isTonight(dateValue?: string | null) {
  if (!dateValue) return false;

  const eventDate = new Date(dateValue);

  if (Number.isNaN(eventDate.getTime())) return false;

  const now = new Date();

  return (
    eventDate.getFullYear() === now.getFullYear() &&
    eventDate.getMonth() === now.getMonth() &&
    eventDate.getDate() === now.getDate()
  );
}

function normalize(value?: string | null) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalVenueName(value?: string | null) {
  return normalize(value).replace(/^the\s+/, "");
}

const GENERIC_VENUE_MATCH_TOKENS = new Set([
  "arena",
  "brewery",
  "brewing",
  "bar",
  "cafe",
  "center",
  "club",
  "coffee",
  "deli",
  "grill",
  "hall",
  "kitchen",
  "lounge",
  "pavilion",
  "pub",
  "restaurant",
  "rooftop",
  "the",
  "venue",
]);

function eventVenueMatchScore(event: EventRow, venue: VenueRow) {
  const eventVenue = canonicalVenueName(
    event.venue_name || event.venue || event.location
  );

  const venueName = canonicalVenueName(venue.name);

  if (!eventVenue || !venueName) return 0;
  if (eventVenue === venueName) return 1;
  const shorterName = eventVenue.length <= venueName.length ? eventVenue : venueName;
  if (
    shorterName.length >= 6 &&
    shorterName.split(" ").length >= 2 &&
    (eventVenue.includes(venueName) || venueName.includes(eventVenue))
  ) {
    return 0.94;
  }

  const eventTokens = new Set(
    eventVenue
      .split(" ")
      .filter(
        (x: string) => x.length >= 3 && !GENERIC_VENUE_MATCH_TOKENS.has(x)
      )
  );

  const venueTokens = venueName
    .split(" ")
    .filter(
      (x: string) => x.length >= 3 && !GENERIC_VENUE_MATCH_TOKENS.has(x)
    );

  const hits = venueTokens.filter((token: string) =>
    eventTokens.has(token)
  ).length;

  const coverage = hits / Math.max(venueTokens.length, eventTokens.size);
  return hits >= 2 && coverage >= 0.55 ? Math.min(0.89, coverage) : 0;
}

function assignEventsToVenues(venues: VenueRow[], events: EventRow[]) {
  const assignments = new Map<string, EventRow[]>();

  for (const event of events) {
    const best = venues
      .map((venue) => ({ venue, match: eventVenueMatchScore(event, venue) }))
      .filter(({ match }) => match >= 0.55)
      .sort(
        (left, right) =>
          right.match - left.match ||
          Number(right.venue.google_rating || 0) - Number(left.venue.google_rating || 0)
      )[0];

    if (!best) continue;
    assignments.set(best.venue.id, [
      ...(assignments.get(best.venue.id) || []),
      event,
    ]);
  }

  return assignments;
}

function getCategoryBoost(venue: VenueRow) {
  const text =
    `${venue.category || ""} ${venue.type || ""} ${
      venue.google_types?.join(" ") || ""
    }`.toLowerCase();

  if (text.includes("night_club") || text.includes("club")) return 18;
  if (text.includes("hookah")) return 16;
  if (text.includes("live music")) return 16;
  if (text.includes("bar")) return 14;
  if (text.includes("brewery")) return 10;
  if (text.includes("restaurant")) return 8;

  return 5;
}

function buildSummary(
  matchedEvents: EventRow[],
  score: number
) {
  const tonightEvents = matchedEvents.filter((event) =>
    isTonight(event.start_time || event.date || event.starts_at)
  );

  if (tonightEvents.length > 0) {
    const event = tonightEvents[0];
    const title = event.title || event.name || "an event";

    if (score >= 75) {
      return `${title} makes this one of tonight's strongest scheduled options.`;
    }

    if (score >= 55) {
      return `${title} puts this spot on tonight's shortlist.`;
    }

    return `${title} is confirmed on the calendar tonight.`;
  }

  if (score >= 75) return "A highly rated option backed by current venue data.";
  if (score >= 55) return "A strong option based on ratings, venue details, and time of day.";
  if (score >= 35) return "A known local option with enough data to recommend.";

  return "Still gathering enough current data to recommend this confidently.";
}

export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { data: venues, error: venuesError } = await supabaseAdmin
      .from("venues")
      .select("*");

    if (venuesError) {
      return NextResponse.json(
        { success: false, error: venuesError.message },
        { status: 500 }
      );
    }

    const { data: events, error: eventsError } = await supabaseAdmin
      .from("events")
      .select("*")
      .order("start_time", { ascending: true });

    if (eventsError) {
      return NextResponse.json(
        { success: false, error: eventsError.message },
        { status: 500 }
      );
    }

    const eventAssignments = assignEventsToVenues(
      (venues || []) as VenueRow[],
      (events || []) as EventRow[]
    );
    const results: IntelligenceResult[] = [];

    for (const venue of venues || []) {
      const matchedEvents = eventAssignments.get(venue.id) || [];

      const tonightEvents = matchedEvents.filter((event) =>
        isTonight(event.start_time || event.date || event.starts_at)
      );

      let score = 15;

      score += getCategoryBoost(venue);

      if (venue.google_rating) {
        score += Number(venue.google_rating) * 4;
      }

      if (venue.photo_url) score += 5;
      if (venue.phone) score += 2;
      if (venue.website) score += 2;

      if (tonightEvents.length > 0) score += 35;
      else if (matchedEvents.length > 0) score += 15;

      for (const event of tonightEvents) {
        const h = hoursUntil(event.start_time || event.date || event.starts_at);

        if (h !== null && h >= -2 && h <= 6) score += 20;
        else if (h !== null && h > 6 && h <= 12) score += 10;
      }

      const finalScore = clampScore(score);

      const status =
        finalScore >= 75
          ? "Top option"
          : finalScore >= 55
          ? "Strong option"
          : finalScore >= 35
          ? "Known option"
          : "Needs more data";

      const summary = buildSummary(
        matchedEvents,
        finalScore
      );

      const { error: updateError } = await supabaseAdmin
        .from("venues")
        .update({
          ai_score: finalScore,
          ai_status: status,
          ai_summary: summary,
          has_ghost_data: true,
          enriched_at: new Date().toISOString(),
        })
        .eq("id", venue.id);

      results.push({
        venue: venue.name,
        score: finalScore,
        status,
        matched_events: matchedEvents.length,
        tonight_events: tonightEvents.length,
        model: "automatic",
        updated: !updateError,
        error: updateError?.message || null,
      });
    }

    return NextResponse.json({
      success: true,
      venues_processed: results.length,
      results,
    });
  } catch (error: unknown) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Venue intelligence failed",
      },
      { status: 500 }
    );
  }
}
