import { after, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

let lastRefreshAttemptAt = 0;

type DiscoveryMode = "all" | "food" | "nightlife" | "events";

type VenueRow = {
  id: string;
  name: string;
  city?: string | null;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  type?: string | null;
  category?: string | null;
  music_genre?: string | null;
  age_limit?: string | null;
  cover?: string | null;
  parking?: string | null;
  dress_code?: string | null;
  ai_score?: number | null;
  google_rating?: number | null;
  google_place_id?: string | null;
  photo_source?: string | null;
  phone?: string | null;
  website?: string | null;
  hours?: GoogleHours | null;
  enriched_at?: string | null;
};

type EventRow = {
  id: string;
  name?: string | null;
  venue_name?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  source?: string | null;
  ticket_status?: string | null;
  source_url?: string | null;
  created_at?: string | null;
};

type GoogleHours = {
  periods?: Array<{
    open?: { day?: number; hour?: number; minute?: number };
    close?: { day?: number; hour?: number; minute?: number };
  }>;
};

type RankedVenue = ReturnType<typeof rankVenue>;

const CITIES = [
  "Norfolk",
  "Virginia Beach",
  "Chesapeake",
  "Portsmouth",
  "Suffolk",
  "Hampton",
  "Newport News",
];

const GENERIC_MATCH_TOKENS = new Set([
  "and",
  "arena",
  "at",
  "bar",
  "brewery",
  "cafe",
  "center",
  "club",
  "company",
  "grill",
  "hall",
  "inc",
  "llc",
  "lounge",
  "pavilion",
  "restaurant",
  "rooftop",
  "the",
  "theater",
  "theatre",
  "venue",
]);

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
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

function meaningfulTokens(value?: string | null) {
  return normalize(value)
    .split(" ")
    .filter((token) => token.length >= 2 && !GENERIC_MATCH_TOKENS.has(token));
}

function eventVenueMatchScore(event: EventRow, venue: VenueRow) {
  const eventName = canonicalVenueName(event.venue_name);
  const venueName = canonicalVenueName(venue.name);
  if (!eventName || !venueName) return 0;
  if (eventName === venueName) return 1;

  const shorter = eventName.length <= venueName.length ? eventName : venueName;
  if (
    shorter.length >= 6 &&
    shorter.split(" ").length >= 2 &&
    (eventName.includes(venueName) || venueName.includes(eventName))
  ) {
    return 0.94;
  }

  const eventTokens = new Set(meaningfulTokens(event.venue_name));
  const venueTokens = meaningfulTokens(venue.name);
  if (!eventTokens.size || !venueTokens.length) return 0;

  const hits = venueTokens.filter((token) => eventTokens.has(token)).length;
  const coverage = hits / Math.max(venueTokens.length, eventTokens.size);
  // A shared word such as "Sky" is not enough to connect Sky Bar to Sky Lounge.
  // Exact and contained names are handled above; fuzzy matches need two anchors.
  return hits >= 2 ? Math.min(0.89, coverage) : 0;
}

function venueCity(venue: VenueRow) {
  const addressMatch = String(venue.address || "").match(
    /,\s*(Norfolk|Virginia Beach|Chesapeake|Portsmouth|Suffolk|Hampton|Newport News)\s*,\s*VA\b/i
  );
  return addressMatch?.[1] || venue.city || "757";
}

function easternNow() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value || "";
  const weekdayIndex: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  return {
    day: weekdayIndex[part("weekday")] ?? 0,
    hour: Number(part("hour")) % 24,
    minute: Number(part("minute")) || 0,
  };
}

function isVenueOpen(hours?: GoogleHours | null) {
  const periods = hours?.periods;
  if (!Array.isArray(periods) || periods.length === 0) return null;

  const now = easternNow();
  const currentMinutes = now.hour * 60 + now.minute;

  return periods.some((period) => {
    const openDay = Number(period.open?.day);
    const closeDay = Number(period.close?.day);
    const openMinutes = Number(period.open?.hour || 0) * 60 + Number(period.open?.minute || 0);
    const closeMinutes = Number(period.close?.hour || 0) * 60 + Number(period.close?.minute || 0);

    if (!Number.isFinite(openDay) || !Number.isFinite(closeDay)) return false;
    if (openDay === closeDay) {
      return now.day === openDay && currentMinutes >= openMinutes && currentMinutes < closeMinutes;
    }

    return (
      (now.day === openDay && currentMinutes >= openMinutes) ||
      (now.day === closeDay && currentMinutes < closeMinutes)
    );
  });
}

function getDaypart() {
  const { hour } = easternNow();
  if (hour >= 5 && hour < 11) {
    return {
      key: "morning",
      eyebrow: "This morning in Hampton Roads",
      headline: "Three good ways to start the day.",
      timing: "This morning",
    } as const;
  }
  if (hour >= 11 && hour < 16) {
    return {
      key: "afternoon",
      eyebrow: "This afternoon in Hampton Roads",
      headline: "Three good moves for right now.",
      timing: "This afternoon",
    } as const;
  }
  if (hour >= 16 && hour < 22) {
    return {
      key: "evening",
      eyebrow: "Tonight in Hampton Roads",
      headline: "Three good moves. Pick one.",
      timing: "Tonight",
    } as const;
  }

  return {
    key: "late",
    eyebrow: "Late night in Hampton Roads",
    headline: "Still deciding? Start here.",
    timing: "Late tonight",
  } as const;
}

function categoryText(venue: VenueRow) {
  return normalize(`${venue.type || ""} ${venue.category || ""} ${venue.music_genre || ""}`);
}

function venueKind(venue: VenueRow) {
  const text = categoryText(venue);
  if (/restaurant|food|cafe|coffee|brunch|brewery|dining|kitchen/.test(text)) return "food";
  if (/club|nightlife|bar|lounge|hookah|dj|dance/.test(text)) return "nightlife";
  if (/concert|theater|theatre|music|arena|pavilion|event/.test(text)) return "events";
  return "other";
}

function daypartBoost(venue: VenueRow, daypart: ReturnType<typeof getDaypart>["key"]) {
  const text = categoryText(venue);

  if (daypart === "morning") {
    if (/brunch|breakfast|coffee|cafe|bakery|park|museum|beach/.test(text)) return 26;
    if (/club|nightlife|hookah/.test(text)) return -22;
  }
  if (daypart === "afternoon") {
    if (/brewery|restaurant|cafe|park|museum|beach|market|attraction/.test(text)) return 20;
    if (/nightclub|club/.test(text)) return -12;
  }
  if (daypart === "evening") {
    if (/restaurant|bar|lounge|music|concert|brewery|event/.test(text)) return 18;
  }
  if (daypart === "late") {
    if (/club|nightlife|bar|lounge|hookah|dj/.test(text)) return 24;
    if (/park|museum|cafe|breakfast/.test(text)) return -20;
  }

  return 4;
}

function formatEventTime(value?: string | null) {
  if (!value) return "Time TBA";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time TBA";

  return date.toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
  });
}

function hoursUntil(value?: string | null) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? null : (timestamp - Date.now()) / 3_600_000;
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

function bestEventForVenue(events: EventRow[]) {
  return events
    .filter((event) => hoursUntil(event.start_time) !== null)
    .sort((left, right) => {
      const leftHours = Math.max(-2, hoursUntil(left.start_time) || 999);
      const rightHours = Math.max(-2, hoursUntil(right.start_time) || 999);
      return leftHours - rightHours;
    })[0] || null;
}

function rankVenue(venue: VenueRow, events: EventRow[], daypart: ReturnType<typeof getDaypart>) {
  const event = bestEventForVenue(events);
  const eventHours = hoursUntil(event?.start_time);
  const openNow = isVenueOpen(venue.hours);
  const rating = Number(venue.google_rating || 0);
  const baseScore = clamp(Number(venue.ai_score || 28), 0, 100) * 0.44;
  const eventBoost = eventHours === null
    ? 0
    : eventHours >= -2 && eventHours <= 1.5
      ? 46
      : eventHours <= 6
        ? 38
        : eventHours <= 14
          ? 27
          : eventHours <= 72
            ? 10
            : 0;
  const ratingBoost = rating >= 3.5 ? (rating - 3.4) * 9 : 0;
  const openBoost = openNow === true ? 12 : openNow === false && !event ? -16 : 0;
  const photoBoost = venue.photo_source === "google_streetview" ? 7 : 0;
  const freshnessHours = venue.enriched_at ? hoursUntil(venue.enriched_at) : null;
  const freshnessBoost = freshnessHours !== null && freshnessHours >= -24 ? 5 : 0;
  const score = Math.round(
    baseScore +
      eventBoost +
      ratingBoost +
      openBoost +
      photoBoost +
      freshnessBoost +
      daypartBoost(venue, daypart.key)
  );
  const kind = venueKind(venue);
  const city = venueCity(venue);
  const eventTime = formatEventTime(event?.start_time);
  const reason = event
    ? `${event?.name || "An event"} starts at ${eventTime}.`
    : openNow === true && rating >= 4
      ? `Open now and rated ${rating.toFixed(1)} by Google.`
      : rating >= 4.5
        ? `A ${rating.toFixed(1)}-rated ${String(venue.type || venue.category || "local spot").toLowerCase()}.`
        : `A solid ${daypart.timing.toLowerCase()} option in ${city}.`;
  const timing = event
    ? eventHours !== null && eventHours <= 1.5
      ? `Starts soon · ${eventTime}`
      : `${eventTime}`
    : openNow === true
      ? "Open now"
      : daypart.timing;

  return {
    ...venue,
    city,
    kind,
    score,
    openNow,
    event,
    reason,
    timing,
  };
}

function chooseDiversePicks(ranked: RankedVenue[]) {
  const remaining = [...ranked];
  const chosen: RankedVenue[] = [];

  while (chosen.length < 3 && remaining.length > 0) {
    const bestIndex = remaining.reduce((winningIndex, venue, index) => {
      const adjusted = venue.score -
        chosen.filter((pick) => pick.city === venue.city).length * 8 -
        chosen.filter((pick) => pick.kind === venue.kind).length * 10;
      const winning = remaining[winningIndex];
      const winningAdjusted = winning.score -
        chosen.filter((pick) => pick.city === winning.city).length * 8 -
        chosen.filter((pick) => pick.kind === winning.kind).length * 10;
      return adjusted > winningAdjusted ? index : winningIndex;
    }, 0);

    chosen.push(remaining.splice(bestIndex, 1)[0]);
  }

  return chosen;
}

function freshnessLabel(timestamp?: string | null) {
  if (!timestamp) return "Updating now";
  const ageMinutes = Math.max(0, Math.round((Date.now() - new Date(timestamp).getTime()) / 60_000));
  if (ageMinutes <= 2) return "Updated just now";
  if (ageMinutes < 60) return `Updated ${ageMinutes} min ago`;
  const ageHours = Math.round(ageMinutes / 60);
  return ageHours === 1 ? "Updated 1 hour ago" : `Updated ${ageHours} hours ago`;
}

function eventsNeedRefresh(timestamp?: string | null) {
  if (!timestamp) return true;
  const value = new Date(timestamp).getTime();
  return Number.isNaN(value) || Date.now() - value > 2 * 60 * 60 * 1000;
}

function publicVenue(venue: RankedVenue, index?: number) {
  const photoUrl =
    venue.photo_source === "google_streetview" && venue.google_place_id
      ? `/api/venue-photo?placeId=${encodeURIComponent(venue.google_place_id)}`
      : null;
  const label = venue.event
    ? hoursUntil(venue.event.start_time) !== null && (hoursUntil(venue.event.start_time) || 99) <= 1.5
      ? "Starting soon"
      : "Event pick"
    : venue.kind === "food"
      ? "Food + drinks"
      : venue.kind === "nightlife"
        ? "Nightlife"
        : index === 0
          ? "Best overall"
          : "Worth a look";

  return {
    id: venue.id,
    name: venue.name,
    city: venue.city,
    address: venue.address || null,
    lat: Number(venue.lat),
    lng: Number(venue.lng),
    type: venue.type || venue.category || "Local spot",
    category: venue.category || venue.type || "Local spot",
    kind: venue.kind,
    rating: Number(venue.google_rating || 0) || null,
    ageLimit: venue.age_limit || null,
    cover: venue.cover || null,
    parking: venue.parking || null,
    dressCode: venue.dress_code || null,
    phone: venue.phone || null,
    website: venue.website || null,
    photoUrl,
    label,
    reason: venue.reason,
    timing: venue.timing,
    openNow: venue.openNow,
    confidence: venue.event ? "Scheduled" : venue.openNow === true ? "Open now" : "Curated pick",
    score: clamp(venue.score, 0, 100),
    event: venue.event
      ? {
          id: venue.event.id,
          name: venue.event.name || "Event",
          startTime: venue.event.start_time || null,
          timeLabel: formatEventTime(venue.event.start_time),
          ticketStatus: venue.event.ticket_status || null,
          sourceUrl: venue.event.source_url || null,
        }
      : null,
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedMode = url.searchParams.get("mode") || "all";
  const mode: DiscoveryMode = ["food", "nightlife", "events"].includes(requestedMode)
    ? requestedMode as DiscoveryMode
    : "all";
  const requestedCity = url.searchParams.get("city") || "All 757";
  const city = CITIES.includes(requestedCity) ? requestedCity : "All 757";
  const search = normalize(url.searchParams.get("q"));
  const daypart = getDaypart();
  const eventStart = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const eventEnd = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const [{ data: venues, error: venuesError }, { data: events, error: eventsError }] = await Promise.all([
    supabaseAdmin
      .from("venues")
      .select(
        "id,name,city,address,lat,lng,type,category,music_genre,age_limit,cover,parking,dress_code,ai_score,google_rating,google_place_id,photo_source,phone,website,hours,enriched_at"
      )
      .limit(700),
    supabaseAdmin
      .from("events")
      .select("id,name,venue_name,start_time,end_time,source,ticket_status,source_url,created_at")
      .gte("start_time", eventStart)
      .lte("start_time", eventEnd)
      .order("start_time", { ascending: true })
      .limit(700),
  ]);

  if (venuesError || eventsError) {
    return NextResponse.json(
      { success: false, error: venuesError?.message || eventsError?.message || "Discovery data unavailable" },
      { status: 500 }
    );
  }

  const safeEvents = (events || []) as EventRow[];
  const eligibleVenues = ((venues || []) as VenueRow[]).filter((venue) => {
      const latitude = Number(venue.lat);
      const longitude = Number(venue.lng);
      return (
        Number.isFinite(latitude) &&
        Number.isFinite(longitude) &&
        longitude >= -76.9 &&
        longitude <= -75.7 &&
        latitude >= 36.42 &&
        latitude <= 37.38
      );
    });
  const assignedEvents = assignEventsToVenues(eligibleVenues, safeEvents);
  const ranked = eligibleVenues
    .map((venue) => rankVenue(venue, assignedEvents.get(venue.id) || [], daypart))
    .filter((venue) => city === "All 757" || venue.city === city)
    .filter((venue) => {
      if (mode === "events") return Boolean(venue.event);
      if (mode === "food") return venue.kind === "food";
      if (mode === "nightlife") return venue.kind === "nightlife";
      return true;
    })
    .filter((venue) => {
      if (!search) return true;
      return normalize(
        `${venue.name} ${venue.city} ${venue.type} ${venue.category} ${venue.event?.name || ""}`
      ).includes(search);
    })
    .sort((left, right) => right.score - left.score);
  const picks = chooseDiversePicks(ranked.slice(0, 60));
  const freshness = [
    ...((venues || []) as VenueRow[]).map((venue) => venue.enriched_at),
    ...safeEvents.map((event) => event.created_at),
  ]
    .filter(Boolean)
    .sort()
    .at(-1) || null;
  const eventFreshness = safeEvents
    .map((event) => event.created_at)
    .filter(Boolean)
    .sort()
    .at(-1) || null;

  if (
    process.env.CRON_SECRET &&
    eventsNeedRefresh(eventFreshness) &&
    Date.now() - lastRefreshAttemptAt > 30 * 60 * 1000
  ) {
    lastRefreshAttemptAt = Date.now();
    const refreshUrl = new URL("/api/fetch-events", url.origin);
    const secret = process.env.CRON_SECRET;
    after(async () => {
      try {
        await fetch(refreshUrl, {
          cache: "no-store",
          headers: { Authorization: `Bearer ${secret}` },
        });
      } catch (error) {
        console.error("Background event refresh failed", error);
      }
    });
  }
  const resultHeadline =
    picks.length === 1
      ? "One good move for right now."
      : picks.length === 2
        ? "Two good moves for right now."
        : daypart.headline;

  return NextResponse.json(
    {
      success: true,
      generatedAt: new Date().toISOString(),
      context: {
        ...daypart,
        headline: resultHeadline,
        city,
        mode,
        resultCount: ranked.length,
      },
      freshness: {
        label: freshnessLabel(freshness),
        timestamp: freshness,
        automatic: true,
      },
      picks: picks.map((venue, index) => publicVenue(venue, index)),
      venues: ranked.slice(0, 180).map((venue) => publicVenue(venue)),
    },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
