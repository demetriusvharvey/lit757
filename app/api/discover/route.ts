import { after, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { getRequestUser } from "../../../src/lib/server-auth";
import { inferInterestTags } from "../../../src/lib/interest-tags";
import { getVenueImage } from "../../../src/lib/venue-image";
import {
  DIRECT_PRESENCE_WINDOW_MINUTES,
  groupDirectPresence,
  type DirectPresenceRow,
} from "../../../src/lib/buzz/direct-presence";
import { dedupeVenueRows } from "../../../src/lib/venue-dedupe";
import { venueKinds } from "../../../src/lib/venue-kind";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const supabaseAdmin = getSupabaseAdmin();

let lastRefreshAttemptAt = 0;

type DiscoveryMode = "all" | "food" | "nightlife" | "explore" | "events";

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
  ai_summary?: string | null;
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

const SEARCH_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "any",
  "around",
  "at",
  "do",
  "doing",
  "find",
  "for",
  "go",
  "going",
  "in",
  "kind",
  "me",
  "my",
  "near",
  "nearby",
  "of",
  "place",
  "places",
  "plan",
  "plans",
  "some",
  "something",
  "the",
  "thing",
  "things",
  "this",
  "to",
  "today",
  "tonight",
  "type",
  "want",
  "with",
]);

type SearchTheme = {
  signals: string[];
  terms: string[];
  requiredTerms?: string[];
  kinds: Array<RankedVenue["kind"]>;
  strictKinds?: boolean;
};

const SEARCH_THEMES: SearchTheme[] = [
  {
    signals: ["date night", "romantic", "romance", "couple", "couples"],
    terms: ["restaurant", "dining", "wine", "winery", "rooftop", "museum", "arts", "comedy", "theater", "theatre"],
    kinds: ["food", "activity", "events"],
  },
  {
    signals: ["family", "families", "kid", "kids", "children", "child friendly", "all ages"],
    terms: ["family", "children", "aquarium", "zoo", "museum", "park", "arcade", "waterpark", "all ages"],
    kinds: ["activity"],
  },
  {
    signals: ["hike", "hiking", "trail", "trails", "nature walk"],
    terms: ["hike", "hiking", "trail", "nature", "park", "wildlife", "refuge", "preserve", "garden", "arboretum", "botanical"],
    requiredTerms: ["hike", "hiking", "trail", "nature", "wildlife", "refuge", "preserve", "arboretum", "botanical", "botanical garden", "state park"],
    kinds: ["activity"],
    strictKinds: true,
  },
  {
    signals: ["beach", "beaches", "surf", "ocean", "waterfront"],
    terms: ["beach", "boardwalk", "surf", "ocean", "waterfront"],
    kinds: ["activity"],
  },
  {
    signals: ["outdoor", "outdoors", "outside", "nature"],
    terms: ["outdoor", "nature", "park", "trail", "beach", "garden", "boardwalk", "surf", "farm", "wildlife", "refuge"],
    kinds: ["activity"],
  },
  {
    signals: ["active", "adventure", "fitness", "sport", "sports", "game", "games"],
    terms: ["sports", "arcade", "surf", "bowling", "golf", "recreation", "waterpark", "adventure", "game"],
    kinds: ["activity", "events"],
  },
  {
    signals: ["art", "arts", "culture", "cultural", "history", "historic", "museum", "painting"],
    terms: ["art", "arts", "gallery", "museum", "historic", "cultural", "theater", "theatre", "opera", "paint"],
    kinds: ["activity", "events"],
  },
  {
    signals: ["music", "concert", "concerts", "band", "bands", "live music"],
    terms: ["live music", "music", "concert", "band", "dj", "theater", "theatre", "amphitheater", "pavilion"],
    kinds: ["events", "nightlife"],
  },
  {
    signals: ["comedy", "comedian", "laugh", "laughs", "improv"],
    terms: ["comedy", "comedian", "improv"],
    kinds: ["activity", "events"],
  },
  {
    signals: ["food", "eat", "eating", "dinner", "lunch", "brunch", "breakfast"],
    terms: ["restaurant", "food", "dining", "kitchen", "brunch", "breakfast"],
    kinds: ["food"],
  },
  {
    signals: ["coffee", "cafe", "bakery", "dessert"],
    terms: ["coffee", "cafe", "bakery", "dessert", "creamery"],
    kinds: ["food"],
  },
  {
    signals: ["drink", "drinks", "cocktail", "cocktails", "beer", "brewery", "wine"],
    terms: ["bar", "cocktail", "brewery", "wine", "winery", "tap", "rooftop"],
    kinds: ["food", "nightlife"],
  },
  {
    signals: ["dance", "dancing", "club", "clubs", "nightlife", "late night"],
    terms: ["dance", "club", "nightlife", "dj", "lounge"],
    kinds: ["nightlife", "events"],
  },
  {
    signals: ["shop", "shopping", "mall"],
    terms: ["shopping", "mall", "district"],
    kinds: ["activity"],
  },
  {
    signals: ["market", "markets", "farmers market", "flea market"],
    terms: ["market", "farmers market", "flea market", "farm"],
    kinds: ["activity"],
  },
  {
    signals: ["free", "cheap", "budget", "no cover"],
    terms: ["free", "no cover", "park", "beach", "market"],
    kinds: ["activity"],
  },
  {
    signals: ["fun", "entertainment", "experience", "experiences"],
    terms: ["entertainment", "experience", "arcade", "museum", "park", "comedy", "theater", "theatre"],
    kinds: ["activity", "events"],
  },
  {
    signals: ["book", "books", "reading", "read", "bookstore", "library"],
    terms: ["book", "bookstore", "library", "reading"],
    kinds: ["activity", "events"],
  },
  {
    signals: ["wellness", "relax", "relaxing", "spa", "massage", "yoga"],
    terms: ["wellness", "spa", "massage", "yoga", "meditation"],
    kinds: ["activity"],
  },
  {
    signals: ["karaoke", "trivia", "quiz", "open mic"],
    terms: ["karaoke", "trivia", "quiz", "open mic"],
    kinds: ["events", "nightlife", "activity"],
  },
  {
    signals: ["golf", "mini golf", "putt putt"],
    terms: ["golf", "mini golf", "putt putt"],
    kinds: ["activity"],
  },
  {
    signals: ["bowling", "bowl"],
    terms: ["bowling", "bowl"],
    kinds: ["activity"],
  },
  {
    signals: ["escape room", "escape rooms"],
    terms: ["escape room", "escape rooms"],
    requiredTerms: ["escape room", "escape rooms"],
    kinds: ["activity"],
    strictKinds: true,
  },
  {
    signals: ["kayak", "kayaking", "paddle", "paddling"],
    terms: ["kayak", "kayaking", "paddle", "paddling"],
    requiredTerms: ["kayak", "kayaking", "paddle", "paddling"],
    kinds: ["activity"],
    strictKinds: true,
  },
  {
    signals: ["boat", "boating", "fishing"],
    terms: ["boat", "boating", "fishing", "marina"],
    kinds: ["activity"],
  },
  {
    signals: ["dog", "dogs", "pet friendly"],
    terms: ["dog", "dogs", "pet friendly", "park", "outdoor"],
    kinds: ["activity"],
  },
  {
    signals: ["play", "plays", "musical", "musicals", "theater", "theatre", "stage show"],
    terms: ["play", "musical", "theater", "theatre", "performing arts", "opera"],
    kinds: ["events", "activity"],
  },
  {
    signals: ["chill", "laid back", "low key", "quiet", "relaxed"],
    terms: ["lounge", "cafe", "coffee", "tea", "garden", "museum", "brewery", "wine", "rooftop"],
    kinds: ["food", "activity", "nightlife"],
  },
  {
    signals: ["rainy", "rainy day", "indoors", "indoor"],
    terms: ["indoor", "museum", "aquarium", "arcade", "bowling", "theater", "theatre", "comedy", "mall"],
    kinds: ["activity", "events"],
  },
  {
    signals: ["energetic", "exciting", "high energy", "party"],
    terms: ["dance", "club", "dj", "arcade", "sports", "concert", "live music"],
    kinds: ["nightlife", "events", "activity"],
  },
];

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

function hasNormalizedPhrase(value: string, phrase: string) {
  return ` ${value} `.includes(` ${phrase} `);
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

function isVenueOpen(hours?: GoogleHours | null, clock = easternNow()) {
  const periods = hours?.periods;
  if (!Array.isArray(periods) || periods.length === 0) return null;

  const currentMinutes = clock.hour * 60 + clock.minute;

  return periods.some((period) => {
    const openDay = Number(period.open?.day);
    const closeDay = Number(period.close?.day);
    const openMinutes = Number(period.open?.hour || 0) * 60 + Number(period.open?.minute || 0);
    const closeMinutes = Number(period.close?.hour || 0) * 60 + Number(period.close?.minute || 0);

    if (!Number.isFinite(openDay) || !Number.isFinite(closeDay)) return false;
    if (openDay === closeDay) {
      return clock.day === openDay && currentMinutes >= openMinutes && currentMinutes < closeMinutes;
    }

    return (
      (clock.day === openDay && currentMinutes >= openMinutes) ||
      (clock.day === closeDay && currentMinutes < closeMinutes)
    );
  });
}

function getDaypart(hour = easternNow().hour) {
  if (hour >= 5 && hour < 11) {
    return {
      key: "morning",
      eyebrow: "Your morning in the 757",
      headline: "Find your thing.",
      timing: "This morning",
      description: "Type any interest, hobby, or mood. We’ll make the decision.",
    } as const;
  }
  if (hour >= 11 && hour < 16) {
    return {
      key: "afternoon",
      eyebrow: "Your afternoon in the 757",
      headline: "Find your thing.",
      timing: "This afternoon",
      description: "Type any interest, hobby, or mood. We’ll make the decision.",
    } as const;
  }
  if (hour >= 16 && hour < 22) {
    return {
      key: "evening",
      eyebrow: "Your evening in the 757",
      headline: "Find your thing.",
      timing: "This evening",
      description: "Type any interest, hobby, or mood. We’ll make the decision.",
    } as const;
  }

  return {
    key: "late",
    eyebrow: "Your late night in the 757",
    headline: "Find your thing.",
    timing: "Late tonight",
    description: "Type any interest, hobby, or mood. We’ll make the decision.",
  } as const;
}

function categoryText(venue: VenueRow) {
  return normalize(`${venue.type || ""} ${venue.category || ""} ${venue.music_genre || ""}`);
}

function daypartBoost(venue: VenueRow, daypart: ReturnType<typeof getDaypart>["key"]) {
  const text = categoryText(venue);

  if (daypart === "morning") {
    if (/brunch|breakfast|coffee|cafe|bakery/.test(text)) return 38;
    if (/aquarium|beach|boardwalk|garden|market|museum|nature|outdoor|park|zoo/.test(text)) return 32;
    if (/restaurant|food|dining/.test(text)) return 12;
    if (/club|nightlife|hookah|lounge|dj/.test(text)) return -38;
    if (/bar|concert|live music/.test(text)) return -18;
  }
  if (daypart === "afternoon") {
    if (/aquarium|arcade|arts|beach|boardwalk|district|entertainment|gallery|garden|historic|market|museum|nature|outdoor|park|shopping|surf|theater|theme|waterpark|zoo/.test(text)) return 34;
    if (/brewery|restaurant|cafe|coffee|food|dining/.test(text)) return 20;
    if (/nightclub|club|nightlife|hookah|lounge|dj/.test(text)) return -28;
  }
  if (daypart === "evening") {
    if (/restaurant|bar|lounge|music|concert|brewery|event|entertainment|theater|district/.test(text)) return 18;
    if (/museum|park|garden/.test(text)) return 4;
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

function hoursUntil(value?: string | null, referenceTime = Date.now()) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? null : (timestamp - referenceTime) / 3_600_000;
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

function bestEventForVenue(events: EventRow[], referenceTime: number) {
  return events
    .filter((event) => hoursUntil(event.start_time, referenceTime) !== null)
    .sort((left, right) => {
      const leftHours = Math.max(-2, hoursUntil(left.start_time, referenceTime) || 999);
      const rightHours = Math.max(-2, hoursUntil(right.start_time, referenceTime) || 999);
      return leftHours - rightHours;
    })[0] || null;
}

function rankVenue(
  venue: VenueRow,
  events: EventRow[],
  daypart: ReturnType<typeof getDaypart>,
  clock: ReturnType<typeof easternNow>,
  referenceTime: number,
  nearbyCount = 0,
  personalBoost = 0
) {
  const event = bestEventForVenue(events, referenceTime);
  const eventHours = hoursUntil(event?.start_time, referenceTime);
  const openNow = isVenueOpen(venue.hours, clock);
  const rating = Number(venue.google_rating || 0);
  const baseScore = clamp(Number(venue.ai_score || 28), 0, 100) * 0.44;
  const eventBoost = eventHours === null || eventHours < -2
    ? 0
    : daypart.key === "morning"
      ? eventHours <= 1.5 ? 34 : eventHours <= 5 ? 20 : eventHours <= 10 ? 5 : 0
      : daypart.key === "afternoon"
        ? eventHours <= 1.5 ? 40 : eventHours <= 6 ? 30 : eventHours <= 10 ? 16 : eventHours <= 72 ? 4 : 0
        : daypart.key === "evening"
          ? eventHours <= 1.5 ? 46 : eventHours <= 6 ? 38 : eventHours <= 12 ? 22 : eventHours <= 72 ? 6 : 0
          : eventHours <= 1.5 ? 46 : eventHours <= 4 ? 34 : eventHours <= 10 ? 8 : 0;
  const ratingBoost = rating >= 3.5 ? (rating - 3.4) * 9 : 0;
  const openBoost = openNow === true
    ? daypart.key === "morning" || daypart.key === "afternoon" ? 22 : 14
    : openNow === false && !event ? -22 : 0;
  const photoBoost = venue.photo_source === "google_streetview" ? 7 : 0;
  const freshnessHours = venue.enriched_at ? hoursUntil(venue.enriched_at) : null;
  const freshnessBoost = freshnessHours !== null && freshnessHours >= -24 ? 5 : 0;
  const presenceBoost = Math.min(22, nearbyCount * 4);
  const score = Math.round(
    baseScore +
      eventBoost +
      ratingBoost +
      openBoost +
      photoBoost +
      freshnessBoost +
      presenceBoost +
      personalBoost +
      daypartBoost(venue, daypart.key)
  );
  const kinds = venueKinds({
    name: venue.name,
    type: venue.type,
    category: venue.category,
    musicGenre: venue.music_genre,
    summary: venue.ai_summary,
  });
  const kind = kinds[0];
  const city = venueCity(venue);
  const interestTags = inferInterestTags(venue);
  const eventTime = formatEventTime(event?.start_time);
  const reason = nearbyCount >= 4
    ? "Verified nearby activity is building right now."
    : nearbyCount >= 2
      ? "Verified activity is nearby right now."
    : event
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
    kinds,
    score,
    openNow,
    eventHours,
    event,
    nearbyCount,
    interestTags,
    reason,
    timing,
  };
}

function searchMatchScore(venue: RankedVenue, search: string) {
  if (!search) return 0;

  const haystack = normalize([
    venue.name,
    venue.city,
    venue.type,
    venue.category,
    venue.ai_summary,
    venue.music_genre,
    venue.age_limit,
    venue.cover,
    venue.dress_code,
    venue.event?.name,
    venue.event?.venue_name,
    venue.interestTags.join(" "),
  ].filter(Boolean).join(" "));
  const words = haystack.split(" ");
  const queryTokens = search
    .split(" ")
    .filter((token) => token.length >= 2 && !SEARCH_STOP_WORDS.has(token));
  const tokenMatches = queryTokens.filter((token) =>
    words.some((word) =>
      word === token ||
      (token.length >= 5 && word.length >= 5 && word.startsWith(token)) ||
      (word.length >= 5 && token.length >= 5 && token.startsWith(word))
    )
  ).length;
  const exactPhrase = hasNormalizedPhrase(haystack, search);
  const activeThemes = SEARCH_THEMES.filter((theme) =>
    theme.signals.some((signal) => hasNormalizedPhrase(search, signal))
  );
  const isFarmMarketSearch = ["farmers market", "farmers markets", "flea market"].some(
    (phrase) => hasNormalizedPhrase(search, phrase)
  );
  const minimumTokenMatches = Math.max(1, Math.ceil(queryTokens.length * 0.6));

  if (
    isFarmMarketSearch &&
    !["farmers market", "flea market"].some((term) => hasNormalizedPhrase(haystack, term))
  ) return 0;

  if (
    !exactPhrase &&
    activeThemes.length === 0 &&
    tokenMatches < minimumTokenMatches
  ) return 0;

  let score = exactPhrase ? 90 : tokenMatches * 18;
  let matchedTheme = false;

  for (const theme of activeThemes) {
    if (
      theme.requiredTerms &&
      !theme.requiredTerms.some((term) => hasNormalizedPhrase(haystack, term))
    ) continue;
    if (theme.strictKinds && !theme.kinds.some(kind => venue.kinds.includes(kind))) continue;

    const termMatches = theme.terms.filter((term) => hasNormalizedPhrase(haystack, term)).length;
    if (termMatches === 0) continue;

    matchedTheme = true;
    if (theme.kinds.some(kind => venue.kinds.includes(kind))) score += 18;
    score += Math.min(36, termMatches * 9);
  }

  if (activeThemes.length > 0 && !exactPhrase && !matchedTheme) return 0;

  return score;
}

function chooseDiversePicks(
  ranked: RankedVenue[],
  daypart: ReturnType<typeof getDaypart>["key"],
  mode: DiscoveryMode,
  hasSearch: boolean
) {
  // Search results are already ordered by intent relevance, then live quality.
  // Re-scoring them here would allow a generic high-ranked venue to replace
  // the thing the person actually asked for.
  if (hasSearch) return ranked.slice(0, 3);

  const remaining = [...ranked];
  const chosen: RankedVenue[] = [];

  const takeBest = (predicate: (venue: RankedVenue) => boolean) => {
    const candidates = remaining
      .map((venue, index) => ({
        index,
        venue,
        adjusted:
          venue.score -
          chosen.filter((pick) => pick.city === venue.city).length * 8 -
          chosen.filter((pick) => pick.kind === venue.kind).length * 10,
      }))
      .filter(({ venue }) => predicate(venue))
      .sort((left, right) => right.adjusted - left.adjusted);
    const best = candidates[0];
    if (!best) return false;
    chosen.push(remaining.splice(best.index, 1)[0]);
    return true;
  };

  const eventWithin = (venue: RankedVenue, hours: number) =>
    Boolean(
      venue.event &&
      venue.eventHours !== null &&
      venue.eventHours >= -2 &&
      venue.eventHours <= hours
    );

  if (mode === "all" && !hasSearch) {
    if (daypart === "morning") {
      takeBest((venue) => venue.openNow === true && venue.kind === "food");
      takeBest((venue) => venue.openNow !== false && venue.kind === "activity");
      takeBest((venue) => eventWithin(venue, 5) || (venue.openNow === true && venue.kind === "food"));
    } else if (daypart === "afternoon") {
      if (!takeBest((venue) => venue.openNow === true && venue.kind === "activity")) {
        takeBest((venue) => venue.openNow === true && venue.kind !== "nightlife");
      }
      takeBest((venue) => eventWithin(venue, 8));
      takeBest((venue) => venue.openNow === true && !venue.event);
    } else if (daypart === "evening") {
      takeBest((venue) => eventWithin(venue, 4));
      takeBest((venue) => venue.openNow === true && venue.kind === "food" && !venue.event);
      takeBest((venue) => eventWithin(venue, 8) || (venue.openNow === true && venue.kind === "activity"));
    } else {
      takeBest((venue) => venue.openNow === true && venue.kind === "nightlife");
      takeBest((venue) => venue.openNow === true && venue.kind === "food" && !venue.event);
      takeBest((venue) => eventWithin(venue, 3));
    }
  } else if (mode === "explore" && !hasSearch) {
    takeBest((venue) => venue.kind === "activity" && venue.openNow === true);
    takeBest((venue) => venue.kind === "activity" && venue.openNow === true);
    takeBest((venue) => venue.kind === "activity");
  } else if (mode === "nightlife" && !hasSearch) {
    takeBest((venue) => venue.kinds.includes("nightlife") && venue.openNow === true);
    takeBest((venue) => venue.kinds.includes("nightlife") && venue.openNow !== false);
    takeBest((venue) => venue.kinds.includes("nightlife"));
  }

  while (chosen.length < 3 && remaining.length > 0) {
    takeBest(() => true);
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
  const photoUrl = getVenueImage({
    name: venue.name,
    kind: venue.kind,
    category: venue.category,
    type: venue.type,
    googlePlaceId: venue.google_place_id,
    lat: venue.lat,
    lng: venue.lng,
  });
  const label = venue.event
    ? venue.eventHours !== null && venue.eventHours <= 1.5
      ? "Starting soon"
      : venue.eventHours !== null && venue.eventHours <= 12
        ? "Later today"
        : "Coming up"
    : venue.openNow === true
      ? "Open now"
    : venue.kind === "food"
      ? "Food + drinks"
      : venue.kind === "activity"
        ? "Explore"
      : venue.kind === "nightlife"
        ? "Night out"
        : index === 0
          ? "Best overall"
          : "Worth a look";
  const heat = venue.nearbyCount >= 4
    ? {
        level: "hot" as const,
        label: "Hot right now",
        detail: "Several verified members are nearby.",
        source: "verified_nearby" as const,
      }
    : venue.nearbyCount >= 2
      ? {
          level: "active" as const,
          label: "Activity nearby",
          detail: "Verified members are nearby.",
          source: "verified_nearby" as const,
        }
      : null;

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
    kinds: venue.kinds,
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
    interestTags: venue.interestTags,
    heat,
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
  const mode: DiscoveryMode = ["food", "nightlife", "explore", "events"].includes(requestedMode)
    ? requestedMode as DiscoveryMode
    : "all";
  const requestedCity = url.searchParams.get("city") || "All 757";
  const city = CITIES.includes(requestedCity) ? requestedCity : "All 757";
  const search = normalize(url.searchParams.get("q"));
  const actualClock = easternNow();
  const previewHourParam = url.searchParams.get("__hour");
  const requestedPreviewHour = Number(previewHourParam);
  const previewHour =
    process.env.NODE_ENV === "development" &&
    previewHourParam !== null &&
    Number.isInteger(requestedPreviewHour) &&
    requestedPreviewHour >= 0 &&
    requestedPreviewHour <= 23
      ? requestedPreviewHour
      : actualClock.hour;
  const clock = { ...actualClock, hour: previewHour };
  const referenceTime = Date.now() + (previewHour - actualClock.hour) * 60 * 60 * 1000;
  const daypart = getDaypart(clock.hour);
  const eventStart = new Date(referenceTime - 2 * 60 * 60 * 1000).toISOString();
  const eventEnd = new Date(referenceTime + 7 * 24 * 60 * 60 * 1000).toISOString();
  const presenceStart = new Date(referenceTime - DIRECT_PRESENCE_WINDOW_MINUTES * 60_000).toISOString();
  const member = await getRequestUser(request);

  const [
    { data: venues, error: venuesError },
    { data: events, error: eventsError },
    { data: presenceReports, error: presenceError },
    { data: likes, error: likesError },
  ] = await Promise.all([
    supabaseAdmin
      .from("venues")
      .select(
        "id,name,city,address,lat,lng,type,category,music_genre,age_limit,cover,parking,dress_code,ai_score,ai_summary,google_rating,google_place_id,photo_source,phone,website,hours,enriched_at"
      )
      .limit(700),
    supabaseAdmin
      .from("events")
      .select("id,name,venue_name,start_time,end_time,source,ticket_status,source_url,created_at")
      .gte("start_time", eventStart)
      .lte("start_time", eventEnd)
      .order("start_time", { ascending: true })
      .limit(700),
    supabaseAdmin
      .from("venue_live_reports")
      .select("venue_id,device_id,report_type,created_at")
      .eq("report_type", "nearby_presence")
      .gte("created_at", presenceStart)
      .order("created_at", { ascending: false })
      .limit(1000),
    member
      ? supabaseAdmin
          .from("venue_live_reports")
          .select("venue_id")
          .eq("device_id", member.id)
          .eq("report_type", "member_like")
          .limit(1000)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (venuesError || eventsError) {
    return NextResponse.json(
      { success: false, error: venuesError?.message || eventsError?.message || "Discovery data unavailable" },
      { status: 500 }
    );
  }

  const safeEvents = (events || []) as EventRow[];
  const venueIdentity = dedupeVenueRows((venues || []) as VenueRow[]);
  const primaryVenueIdBySourceId = venueIdentity.primaryVenueIdBySourceId;
  if (presenceError) console.error("Nearby activity unavailable", presenceError.message);
  if (likesError) console.error("Member preferences unavailable", likesError.message);
  const eligibleVenues = venueIdentity.venues.filter((venue) => {
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
  const rawNearbyMembers = groupDirectPresence(
    (presenceReports || []) as DirectPresenceRow[],
    new Date(referenceTime)
  ).byVenue;
  const nearbyMembers = new Map<string, Set<string>>();
  for (const [sourceVenueId, group] of rawNearbyMembers) {
    const venueId = primaryVenueIdBySourceId.get(sourceVenueId) || sourceVenueId;
    const devices = nearbyMembers.get(venueId) || new Set<string>();
    for (const deviceId of group.verified) devices.add(deviceId);
    nearbyMembers.set(venueId, devices);
  }
  const likedVenueIds = new Set((likes || [])
    .map((like) => primaryVenueIdBySourceId.get(like.venue_id) || like.venue_id)
    .filter(Boolean));
  const likedTags = new Set(
    eligibleVenues
      .filter((venue) => likedVenueIds.has(venue.id))
      .flatMap((venue) => inferInterestTags(venue))
  );
  const memberBoost = (venue: VenueRow) => {
    const sharedTags = inferInterestTags(venue).filter((tag) => likedTags.has(tag)).length;
    return (likedVenueIds.has(venue.id) ? 6 : 0) + Math.min(10, sharedTags * 2);
  };
  const assignedEvents = assignEventsToVenues(eligibleVenues, safeEvents);
  const ranked = eligibleVenues
    .map((venue) =>
      rankVenue(
        venue,
        assignedEvents.get(venue.id) || [],
        daypart,
        clock,
        referenceTime,
        nearbyMembers.get(venue.id)?.size || 0,
        memberBoost(venue)
      )
    )
    .filter((venue) => city === "All 757" || venue.city === city)
    .filter((venue) => {
      // Interest search is global. Category tabs only narrow the unsearched feed.
      if (search) return true;
      if (mode === "events") return Boolean(venue.event);
      if (mode === "food") return venue.kinds.includes("food");
      if (mode === "nightlife") return venue.kinds.includes("nightlife");
      if (mode === "explore") return venue.kinds.includes("activity");
      return true;
    })
    .filter((venue) => !search || venue.openNow !== false || Boolean(venue.event))
    .filter((venue) => !search || searchMatchScore(venue, search) > 0)
    .sort((left, right) => {
      if (search) {
        const searchDifference = searchMatchScore(right, search) - searchMatchScore(left, search);
        if (searchDifference) return searchDifference;
      }
      return right.score - left.score;
    });
  const picks = chooseDiversePicks(ranked, daypart.key, mode, Boolean(search));
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
  return NextResponse.json(
    {
      success: true,
      generatedAt: new Date().toISOString(),
      context: {
        ...daypart,
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
