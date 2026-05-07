import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function hoursUntil(dateValue?: string | null) {
  if (!dateValue) return null;

  const date = new Date(dateValue);

  if (Number.isNaN(date.getTime())) return null;

  return (date.getTime() - Date.now()) / (1000 * 60 * 60);
}

function hoursSince(dateValue?: string | null) {
  if (!dateValue) return null;

  const date = new Date(dateValue);

  if (Number.isNaN(date.getTime())) return null;

  return (Date.now() - date.getTime()) / (1000 * 60 * 60);
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
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(
      /\b(the|a|an|bar|grill|restaurant|lounge|club|venue|va|virginia)\b/g,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();
}

function eventMatchesVenue(event: any, venue: any) {
  const eventVenue = normalize(
    event.venue_name || event.venue || event.location
  );

  const venueName = normalize(venue.name);

  if (!eventVenue || !venueName) return false;
  if (eventVenue === venueName) return true;
  if (eventVenue.includes(venueName) || venueName.includes(eventVenue)) {
    return true;
  }

  const eventTokens = new Set(
    eventVenue.split(" ").filter((x: string) => x.length >= 3)
  );

  const venueTokens = venueName
    .split(" ")
    .filter((x: string) => x.length >= 3);

  const hits = venueTokens.filter((token: string) =>
    eventTokens.has(token)
  ).length;

  return hits / Math.max(venueTokens.length, eventTokens.size) >= 0.55;
}

function getCategoryBoost(venue: any) {
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

function getSignalBoost(signals: any[]) {
  let boost = 0;

  const recentSignals = signals.filter((signal) => {
    const h = hoursSince(signal.created_at);
    return h !== null && h <= 12;
  });

  const veryFreshSignals = signals.filter((signal) => {
    const h = hoursSince(signal.created_at);
    return h !== null && h <= 3;
  });

  const activeSignals = recentSignals.filter((signal) =>
    ["active", "packed", "good", "line", "music"].includes(signal.vibe_type)
  );

  const quietSignals = recentSignals.filter((signal) =>
    ["quiet"].includes(signal.vibe_type)
  );

  boost += Math.min(25, activeSignals.length * 6);
  boost += Math.min(15, veryFreshSignals.length * 4);

  if (quietSignals.length >= 2 && activeSignals.length === 0) {
    boost -= 18;
  } else {
    boost -= Math.min(10, quietSignals.length * 4);
  }

  return boost;
}

function getSignalTone(signals: any[]) {
  const recentSignals = signals.filter((signal) => {
    const h = hoursSince(signal.created_at);
    return h !== null && h <= 12;
  });

  const counts = recentSignals.reduce<Record<string, number>>((acc, signal) => {
    acc[signal.vibe_type] = (acc[signal.vibe_type] || 0) + 1;
    return acc;
  }, {});

  const activeTotal =
    (counts.active || 0) +
    (counts.packed || 0) +
    (counts.good || 0) +
    (counts.line || 0) +
    (counts.music || 0);

  const quietTotal = counts.quiet || 0;

  if (activeTotal >= 5) return "people are clearly feeling it";
  if (activeTotal >= 2) return "people are starting to speak on it";
  if (quietTotal >= 2 && activeTotal === 0) return "people are calling it slow";
  if (recentSignals.length > 0) return "people are checking in";

  return null;
}

function buildSummary(
  venue: any,
  matchedEvents: any[],
  signals: any[],
  score: number
) {
  const tonightEvents = matchedEvents.filter((event) =>
    isTonight(event.start_time || event.date || event.starts_at)
  );

  const signalTone = getSignalTone(signals);

  if (signalTone) {
    if (score >= 75) return `This spot is heating up — ${signalTone}.`;
    if (score >= 55) return `This spot has momentum tonight — ${signalTone}.`;
    if (score >= 35) return `Worth keeping an eye on — ${signalTone}.`;
    return `Still early here, but ${signalTone}.`;
  }

  if (tonightEvents.length > 0) {
    const event = tonightEvents[0];
    const title = event.title || event.name || "an event";

    if (score >= 75) {
      return `${title} has this spot looking like one of the stronger moves tonight.`;
    }

    if (score >= 55) {
      return `${title} gives this spot a reason to keep an eye on tonight.`;
    }

    return `${title} is on the calendar tonight, but the vibe still looks early.`;
  }

  if (score >= 75) return "This spot is looking active tonight.";
  if (score >= 55) return "This spot has some momentum tonight.";
  if (score >= 35) return "Worth watching if you are nearby.";

  return "Quiet right now, but that can change later.";
}

export async function GET() {
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

    const { data: signals, error: signalsError } = await supabaseAdmin
      .from("venue_signals")
      .select("*")
      .gte(
        "created_at",
        new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      );

    if (signalsError) {
      return NextResponse.json(
        { success: false, error: signalsError.message },
        { status: 500 }
      );
    }

    const results: any[] = [];

    for (const venue of venues || []) {
      const matchedEvents = (events || []).filter((event) =>
        eventMatchesVenue(event, venue)
      );

      const tonightEvents = matchedEvents.filter((event) =>
        isTonight(event.start_time || event.date || event.starts_at)
      );

      const venueSignals = (signals || []).filter(
        (signal) => signal.venue_id === venue.id
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

      const signalBoost = getSignalBoost(venueSignals);
      score += signalBoost;

      const finalScore = clampScore(score);

      const status =
        finalScore >= 75
          ? "Buzzing"
          : finalScore >= 55
          ? "Picking up"
          : finalScore >= 35
          ? "Worth watching"
          : "Quiet";

      const summary = buildSummary(
        venue,
        matchedEvents,
        venueSignals,
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
        signals_24h: venueSignals.length,
        signal_boost: signalBoost,
        updated: !updateError,
        error: updateError?.message || null,
      });
    }

    return NextResponse.json({
      success: true,
      venues_processed: results.length,
      results,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}