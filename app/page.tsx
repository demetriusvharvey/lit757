"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { supabase } from "../src/lib/supabase";
import { Event, Venue, Vibe } from "../src/types";
import {
  Navigation,
  Share2,
  X,
  ChevronUp,
  Search,
  Music,
  BadgeDollarSign,
  UserRoundCheck,
  CalendarDays,
  LocateFixed,
} from "lucide-react";

type VenueWithEvent = Venue & {
  tonightEvent?: any | null;
  upcomingEvents?: any[];
  hasUpcomingEvent?: boolean;
  voteCount?: number;
  updateCount?: number;
  trendingScore?: number;
  momentumLabel?: string;
  confidence?: "high" | "medium" | "low";
  energyLevel?: "high" | "medium" | "low" | "negative";
  vibeScore?: number;
  vibeTier?: "lit" | "decent" | "dead";
  vibeTrend?: "surging" | "heating" | "steady" | "cooling" | "quiet";
  vibeReason?: string;
  aiScore?: number;
  aiStatus?: string | null;
  aiConfidence?: string | null;
  aiSummary?: string | null;
  aiSignals?: Record<string, any> | null;
  hasGhostData?: boolean;
  liveReportCount?: number;
  liveReportScore?: number;
  reportSummary?: string | null;
  behaviorCategory?: "nightlife" | "restaurant" | "event";
};

type MapMode = "day" | "night";

type NavigationStep = {
  instruction: string;
  distance: number;
  duration: number;
};

type ActiveNavigation = {
  venueName: string;
  distanceMiles: number;
  durationMinutes: number;
  steps: NavigationStep[];
};

type CityPulseItem = {
  id: string;
  venue_name: string | null;
  venue_id?: string | null;
  update_type: string | null;
  message: string | null;
  media_url?: string | null;
  media_type?: string | null;
  created_at: string | null;
};

type ActivityToast = {
  id: string;
  venueId?: string | null;
  venueName: string;
  title: string;
  message: string;
  icon: string;
  createdAt?: string | null;
};

type LiveTickerItem = {
  id: string;
  venue?: VenueWithEvent | null;
  title: string;
  detail: string;
  tone: "hot" | "active" | "watch" | "calm";
};

type TodayMoveItem = {
  id: string;
  label: string;
  venue: VenueWithEvent;
  detail: string;
  score: number;
  tone: "hot" | "active" | "watch" | "calm";
};


type SupabaseEventRow = {
  id: string;
  name?: string | null;
  title?: string | null;
  venue_name?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  source?: string | null;
  source_event_id?: string | null;
  ticket_status?: string | null;
  genre?: string | null;
  dj?: string | null;
  cover_price?: string | null;
  age_limit?: string | null;
  dress_code?: string | null;
  description?: string | null;
  source_url?: string | null;
  created_at?: string | null;
};

function formatEventTimeLabel(startIso?: string | null) {
  if (!startIso) return "Time TBA";

  const date = new Date(startIso);
  if (Number.isNaN(date.getTime())) return "Time TBA";

  return date.toLocaleString("en-US", {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

function normalizeText(value?: string | null) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(the|a|an|at|and|llc|inc|venue|center|centre|theater|theatre|club|nightclub|bar|lounge|restaurant|va|virginia)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getTicketDemandBoost(ticketStatus?: string | null) {
  const status = String(ticketStatus || "").toLowerCase();

  if (status.includes("sold out")) return 30;
  if (status.includes("almost")) return 25;
  if (status.includes("selling fast")) return 22;
  if (status.includes("limited")) return 18;
  if (status.includes("available")) return 10;
  if (status.includes("free")) return 8;

  return 0;
}

function getEventTimingBoost(event?: any | null) {
  if (!event?.start_time) return 10;

  const start = new Date(event.start_time).getTime();
  if (Number.isNaN(start)) return 10;

  const now = Date.now();
  const hoursUntilStart = (start - now) / (1000 * 60 * 60);
  const hoursSinceStart = (now - start) / (1000 * 60 * 60);

  // Event started recently or is happening tonight.
  if (hoursSinceStart >= 0 && hoursSinceStart <= 6) return 28;
  if (hoursUntilStart > 0 && hoursUntilStart <= 4) return 24;
  if (hoursUntilStart > 4 && hoursUntilStart <= 12) return 18;
  if (hoursUntilStart > 12 && hoursUntilStart <= 48) return 12;

  return 6;
}

function normalizeEventForUi(event: SupabaseEventRow | null): any | null {
  if (!event) return null;

  const startIso = event.start_time || null;
  const eventDate = startIso ? startIso.split("T")[0] : null;
  const title = event.title || event.name || "Tonight event";
  const ticketStatus = event.ticket_status || null;
  const ticketBoost = getTicketDemandBoost(ticketStatus);

  return {
    ...event,
    title,
    name: event.name || title,
    event_title: title,
    event_date: eventDate,
    starts_at_label: formatEventTimeLabel(startIso),
    venue_name: event.venue_name || null,
    genre: event.genre || "Live Event",
    dj: event.dj || null,
    cover_price: event.cover_price || ticketStatus || "Varies",
    age_limit: event.age_limit || "Varies",
    dress_code: event.dress_code || "Casual",
    ticket_status: ticketStatus,
    ticketBoost,
    description:
      event.description ||
      (ticketStatus ? `${ticketStatus} · ${formatEventTimeLabel(startIso)}` : event.source ? `Source: ${event.source}` : null),
  };
}

function getEventDedupeKey(event: any) {
  const titleKey = normalizeText(event?.title || event?.event_title || event?.name || "untitled event");
  const venueKey = normalizeText(event?.venue_name || "unknown venue");
  const sourceKey = normalizeText(event?.source || "unknown source");

  // Group recurring/repeated imports together by what users actually see: title + venue.
  // This keeps the Events tab clean when scrapers return the same event across dates/pages.
  if (titleKey && venueKey) return `${titleKey}__${venueKey}__${sourceKey}`;

  return String(event?.source_event_id || event?.source_url || event?.id || `${titleKey}__${venueKey}__${sourceKey}`).toLowerCase();
}

function dedupeEvents<T extends any>(events: T[]) {
  const seen = new Set<string>();

  return events.filter((event) => {
    const key = getEventDedupeKey(event);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function eventVenueMatchScore(event: SupabaseEventRow, venue: any) {
  // The production events table does not have venue_id. Match by normalized venue_name only.
  const eventVenueName = normalizeText(event.venue_name);
  const venueName = normalizeText(venue.name);

  if (!eventVenueName || !venueName) return 0;
  if (eventVenueName === venueName) return 1;
  if (eventVenueName.includes(venueName) || venueName.includes(eventVenueName)) return 0.92;

  const eventTokens = new Set(eventVenueName.split(" ").filter((token) => token.length >= 3));
  const venueTokens = venueName.split(" ").filter((token) => token.length >= 3);

  if (!eventTokens.size || !venueTokens.length) return 0;

  const hits = venueTokens.filter((token) => eventTokens.has(token)).length;
  return hits / Math.max(venueTokens.length, eventTokens.size);
}

function eventMatchesVenue(event: SupabaseEventRow, venue: any) {
  return eventVenueMatchScore(event, venue) >= 0.55;
}

const MAPBOX_STYLES: Record<MapMode, string> = {
  day: "mapbox://styles/mapbox/outdoors-v12",
  night: "mapbox://styles/mapbox/dark-v11",
};

function getInitialMapMode(): MapMode {
  // Keep the first server render and first client render identical.
  // Browser-only values like time/localStorage can cause hydration mismatches.
  return "night";
}

const VIBE_SCORE: Record<Vibe, number> = {
  lit: 4,
  decent: 2,
  dead: -3,
  line_crazy: 2,
};

const VIBE_ENGINE_CONFIG = {
  voteMultiplier: 9,
  updateMultiplier: 7,
  eventBoost: 22,
  recentBoost: 10,
  lineBoost: 5,
  negativePenalty: 14,
};

const CHIP_CONFIGS = [
  { label: "All", icon: "", preference: null, terms: [] },
  { label: "Nightlife", icon: "", preference: "nightlife", terms: ["nightlife", "club", "bar", "lounge", "party"] },
  { label: "Bars", icon: "", preference: "bars", terms: ["bar", "pub", "cocktail", "drinks"] },
  { label: "Hookah", icon: "", preference: "hookah", terms: ["hookah", "lounge"] },
  { label: "Clubs", icon: "", preference: "club", terms: ["club", "dance", "nightclub"] },
  { label: "Lounges", icon: "", preference: "lounge", terms: ["lounge", "cocktail", "upscale"] },
  { label: "Day Parties", icon: "", preference: "day party", terms: ["day party", "dayparty", "brunch", "patio"] },
  { label: "Brunch", icon: "", preference: "brunch", terms: ["brunch", "mimosa", "day party"] },
  { label: "Happy Hour", icon: "", preference: "happy hour", terms: ["happy hour", "specials", "drinks"] },
  { label: "Latin", icon: "", preference: "latin", terms: ["latin", "salsa", "bachata", "reggaeton", "merengue"] },
  { label: "Afrobeats", icon: "", preference: "afrobeats", terms: ["afrobeats", "afrobeat", "amapiano", "dancehall"] },
  { label: "Hip-Hop", icon: "", preference: "hip-hop", terms: ["hip-hop", "hip hop", "rap", "trap"] },
  { label: "R&B", icon: "", preference: "r&b", terms: ["r&b", "rnb", "r and b"] },
  { label: "EDM", icon: "", preference: "edm", terms: ["edm", "house", "techno", "electronic"] },
  { label: "Live Music", icon: "", preference: "live music", terms: ["live music", "band", "concert", "performance"] },
  { label: "Concerts", icon: "", preference: "concerts", terms: ["concert", "show", "artist", "performance"] },
  { label: "DJs", icon: "", preference: "dj", terms: ["dj", "deejay", "set"] },
  { label: "Experiences", icon: "", preference: "experience", terms: ["experience", "activity", "immersive", "fun"] },
  { label: "Rooftops", icon: "", preference: "rooftop", terms: ["rooftop", "skyline", "patio"] },
  { label: "Waterfront", icon: "", preference: "waterfront", terms: ["waterfront", "waterside", "oceanfront", "beach"] },
  { label: "Breweries", icon: "", preference: "brewery", terms: ["brewery", "breweries", "beer", "taproom"] },
  { label: "Beaches", icon: "", preference: "beach", terms: ["beach", "oceanfront", "shore"] },
  { label: "Museums", icon: "", preference: "museum", terms: ["museum", "gallery", "art"] },
  { label: "Food", icon: "", preference: "food", terms: ["food", "restaurant", "kitchen", "dining"] },
  { label: "Cheap Eats", icon: "", preference: "cheap", terms: ["cheap", "free", "low cover", "no cover", "$0"] },
  { label: "21+", icon: "", preference: "21+", terms: ["21+", "21 and up"] },
  { label: "18+", icon: "", preference: "18+", terms: ["18+", "18 and up"] },
  { label: "Events", icon: "", preference: "events", terms: ["event", "events", "tonight"] },
];


function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function getMinutesSince(date?: string | null) {
  if (!date) return null;
  return Math.max(0, (Date.now() - new Date(date).getTime()) / 60000);
}

function getVibeTier(score: number, signalCount: number): "lit" | "decent" | "dead" {
  if (score >= 68 && signalCount >= 2) return "lit";
  if (score >= 36 || signalCount >= 1) return "decent";
  return "dead";
}

function getVibeTrend(args: {
  score: number;
  recentSignalCount: number;
  hasRecentPositive: boolean;
  negativeDominant: boolean;
  hasSignals: boolean;
}): "surging" | "heating" | "steady" | "cooling" | "quiet" {
  if (!args.hasSignals) return "quiet";
  if (args.negativeDominant) return "cooling";
  if (args.score >= 75 && args.recentSignalCount >= 3) return "surging";
  if (args.hasRecentPositive || args.recentSignalCount >= 2) return "heating";
  return "steady";
}

function vibeTrendLabel(trend?: string) {
  if (trend === "surging") return "Surging";
  if (trend === "heating") return "Heating up";
  if (trend === "steady") return "Steady";
  if (trend === "cooling") return "Cooling off";
  return "Quiet";
}

function vibeReasonText(args: {
  tier: "lit" | "decent" | "dead";
  voteCount: number;
  updateCount: number;
  hasEvent: boolean;
  negativeDominant: boolean;
}) {
  if (args.negativeDominant) return "Recent dead votes are pulling the vibe down.";
  if (args.tier === "lit") return "Strong live signals, recent activity, and tonight context are pushing this spot up.";
  if (args.tier === "decent") return args.hasEvent
    ? "Tonight has some momentum, so this spot is worth watching."
    : "Some momentum is building here.";
  if (args.voteCount + args.updateCount === 0) return "Quiet right now. The night may shift later.";
  return "Signals are light right now, so check again before making the move.";
}

function calculateVenueVibe(args: {
  venueVotes: any[];
  updateMatches: any[];
  tonightEvent: any | null;
}) {
  const now = Date.now();
  const voteCount = args.venueVotes.length;
  const updateCount = args.updateMatches.length;
  const signalCount = voteCount + updateCount;

  const weightedVoteScore = args.venueVotes.reduce((sum, vote) => {
    const raw = VIBE_SCORE[vote.vibe as Vibe] || 0;
    return sum + raw * voteWeight(vote.created_at) * VIBE_ENGINE_CONFIG.voteMultiplier;
  }, 0);

  const weightedUpdateScore = args.updateMatches.reduce((sum, update) => {
    const minutes = getMinutesSince(update.created_at);
    const recency = minutes === null ? 0.35 : minutes <= 30 ? 1 : minutes <= 60 ? 0.7 : minutes <= 90 ? 0.45 : 0.2;
    return sum + getUpdateScore(update) * VIBE_ENGINE_CONFIG.updateMultiplier * recency;
  }, 0);

  const recentVotes = args.venueVotes.filter((vote) => now - new Date(vote.created_at).getTime() <= 30 * 60 * 1000);
  const recentUpdates = args.updateMatches.filter((update) => now - new Date(update.created_at).getTime() <= 30 * 60 * 1000);
  const recentSignalCount = recentVotes.length + recentUpdates.length;

  const positiveVoteCount = args.venueVotes.filter((vote) => ["lit", "decent", "line_crazy"].includes(vote.vibe)).length;
  const negativeVoteCount = args.venueVotes.filter((vote) => vote.vibe === "dead").length;
  const negativeDominant = negativeVoteCount > positiveVoteCount && negativeVoteCount > 0;

  const positiveWords = ["packed", "lit", "crowded", "busy", "good", "jumping", "full", "live", "fun"];
  const hasRecentPositiveUpdate = recentUpdates.some((update) =>
    positiveWords.some((word) => (update.message || "").toLowerCase().includes(word))
  );
  const hasRecentPositiveVote = recentVotes.some((vote) => ["lit", "decent", "line_crazy"].includes(vote.vibe));
  const hasRecentPositive = hasRecentPositiveVote || hasRecentPositiveUpdate;
  const hasLineUpdate = args.updateMatches.some((update) => update.update_type === "Line");

  const eventTimingBoost = args.tonightEvent ? getEventTimingBoost(args.tonightEvent) : 0;
  const ticketDemandBoost = args.tonightEvent ? getTicketDemandBoost(args.tonightEvent.ticket_status || args.tonightEvent.cover_price) : 0;
  const eventBoost = args.tonightEvent
    ? VIBE_ENGINE_CONFIG.eventBoost + eventTimingBoost + ticketDemandBoost
    : 0;
  const recentBoost = recentSignalCount > 0 ? Math.min(18, recentSignalCount * VIBE_ENGINE_CONFIG.recentBoost) : 0;
  const lineBoost = hasLineUpdate ? VIBE_ENGINE_CONFIG.lineBoost : 0;
  const penalty = negativeDominant ? VIBE_ENGINE_CONFIG.negativePenalty : 0;
  const hasRealSignals = signalCount > 0 || !!args.tonightEvent;
  const baseline = hasRealSignals ? 18 : 0;
  const effectiveSignalCount = signalCount + (args.tonightEvent ? 1 : 0);

  // No votes, no live updates, no event = no fake heat.
  // Quiet venues should stay visible as subtle dots, not red/orange heat.
  const score = clampScore(baseline + weightedVoteScore + weightedUpdateScore + eventBoost + recentBoost + lineBoost - penalty);
  const tier = getVibeTier(score, effectiveSignalCount);
  const trend = getVibeTrend({ score, recentSignalCount, hasRecentPositive, negativeDominant, hasSignals: hasRealSignals });
  const reason = vibeReasonText({ tier, voteCount, updateCount, hasEvent: !!args.tonightEvent, negativeDominant });

  let energyLevel: "high" | "medium" | "low" | "negative" = "low";
  if (tier === "lit" || trend === "surging") energyLevel = "high";
  else if (negativeDominant || trend === "cooling") energyLevel = "negative";
  else if (tier === "decent" || trend === "heating") energyLevel = "medium";

  const momentumLabel = trend === "surging"
    ? "surging now"
    : trend === "heating"
    ? "gaining fast"
    : trend === "cooling"
    ? "cooling off"
    : trend === "steady"
    ? "steady signals"
    : "quiet night";

  const trendingScore = hasRealSignals
    ? Math.round(score + recentSignalCount * 4 + (args.tonightEvent ? 8 : 0))
    : 0;

  return {
    score,
    finalScore: score,
    status: tier,
    vibeScore: score,
    vibeTier: tier,
    vibeTrend: trend,
    vibeReason: reason,
    momentumLabel,
    trendingScore,
    energyLevel,
  };
}

function voteWeight(createdAt?: string | null) {
  if (!createdAt) return 0;

  const minutes = (Date.now() - new Date(createdAt).getTime()) / 60000;

  if (minutes <= 30) return 1;
  if (minutes <= 60) return 0.7;
  if (minutes <= 90) return 0.5;
  return 0;
}

function getStatus(score: number, signalCount: number) {
  if (score >= 6) return "lit";
  if (score >= 2) return "decent";
  if (signalCount >= 1 && score >= 0) return "decent";
  return "dead";
}

function confidenceLabel(confidence?: "high" | "medium" | "low") {
  if (confidence === "high") return "Strong read";
  if (confidence === "medium") return "Good read";
  return "Early read";
}

function pinColor(status?: string) {
  if (status === "lit") return "#ef4444";
  if (status === "decent") return "#f5b301";
  return "#9ca3af";
}

function statusLabel(status?: string) {
  if (status === "lit") return "Buzzing";
  if (status === "decent") return "Worth a look";
  return "Quiet";
}

function activityPhrase(venue: Partial<VenueWithEvent>) {
  if (venue.status === "lit") return "Active right now";
  if (venue.status === "decent") return "Warming up";
  return "Still early";
}

function checkInLabel(count: number) {
  if (count <= 0) return "No check-ins yet";
  if (count === 1) return "1 live check-in";
  return `${count} night moves`;
}

function trustLabel(confidence?: "high" | "medium" | "low") {
  if (confidence === "high") return "Looks solid";
  if (confidence === "medium") return "Some motion";
  return "Still early";
}

function scoreToVenueStatus(score: number): "lit" | "decent" | "dead" {
  if (score >= 68) return "lit";
  if (score >= 36) return "decent";
  return "dead";
}

function scoreToEnergyLevel(score: number): "high" | "medium" | "low" | "negative" {
  if (score >= 75) return "high";
  if (score >= 45) return "medium";
  if (score <= 25) return "negative";
  return "low";
}

function scoreToVibeTrend(score: number, hasLiveSignals: boolean): "surging" | "heating" | "steady" | "cooling" | "quiet" {
  if (hasLiveSignals && score >= 75) return "surging";
  if (score >= 65) return "heating";
  if (score >= 40) return "steady";
  if (score > 0) return "quiet";
  return "quiet";
}

function trendingLabel(score?: number) {
  if (score === undefined || score === null) return "active";
  if (score >= 8) return "exploding";
  if (score >= 4) return "active";
  return "slow";
}

function energyColor(level?: string) {
  if (level === "high") return "#fb923c";
  if (level === "medium") return "#facc15";
  if (level === "negative") return "#60a5fa";
  return "#94a3b8";
}

function energyGlow(level?: string) {
  if (level === "high") return "shadow-[0_0_40px_rgba(251,146,60,0.3)]";
  if (level === "medium") return "shadow-[0_0_30px_rgba(250,204,21,0.28)]";
  if (level === "negative") return "shadow-[0_0_26px_rgba(96,165,250,0.22)]";
  return "shadow-[0_0_16px_rgba(148,163,184,0.14)]";
}

function energyLabel(level?: string) {
  if (level === "high") return "Buzzing now";
  if (level === "medium") return "Picking up";
  if (level === "negative") return "Quiet right now";
  return "Low motion";
}

function tickerToneClasses(tone: LiveTickerItem["tone"], isDay: boolean) {
  if (tone === "hot") {
    return isDay
      ? "bg-red-600 text-white shadow-[0_0_18px_rgba(220,38,38,0.26)]"
      : "bg-red-500 text-white shadow-[0_0_18px_rgba(239,68,68,0.32)]";
  }

  if (tone === "active") {
    return isDay
      ? "bg-orange-600 text-white shadow-[0_0_18px_rgba(234,88,12,0.24)]"
      : "bg-orange-500 text-white shadow-[0_0_18px_rgba(251,146,60,0.3)]";
  }

  if (tone === "watch") {
    return isDay
      ? "bg-slate-950 text-white"
      : "bg-white text-black";
  }

  return isDay
    ? "bg-slate-200 text-slate-700"
    : "bg-white/12 text-white/75";
}

function tickerInitial(title: string) {
  const clean = title.trim();
  return clean ? clean[0].toUpperCase() : "•";
}

function todayMoveTone(score: number): TodayMoveItem["tone"] {
  if (score >= 82) return "hot";
  if (score >= 62) return "active";
  if (score >= 42) return "watch";
  return "calm";
}

function todayMoveScore(venue: VenueWithEvent) {
  const liveSignals = (venue.voteCount || 0) + (venue.updateCount || 0) + (venue.liveReportCount || 0);
  const eventBoost = venue.tonightEvent ? 20 : venue.hasUpcomingEvent ? 8 : 0;
  const score = venue.vibeScore || venue.score || venue.aiScore || 0;
  const trendBoost =
    venue.vibeTrend === "surging"
      ? 22
      : venue.vibeTrend === "heating"
      ? 14
      : venue.vibeTrend === "steady"
      ? 6
      : 0;

  return Math.round(score + liveSignals * 11 + eventBoost + trendBoost);
}

function todayMoveDetail(venue: VenueWithEvent) {
  if (venue.tonightEvent?.title) return venue.tonightEvent.title;
  if (venue.aiSummary) return venue.aiSummary;
  if (venue.vibeTrend && venue.vibeTrend !== "quiet") return vibeTrendLabel(venue.vibeTrend);
  return energyLabel(venue.energyLevel);
}

function updateTypeIcon(type?: string) {
  switch (type) {
    case "Vibe":
      return "";
    case "Line":
      return "";
    case "Music":
      return "";
    case "Event":
      return "";
    case "Cover":
      return "";
    default:
      return "";
  }
}

function getUpdateScore(update: { update_type?: string | null; message?: string | null }) {
  const type = update.update_type || "";
  const message = (update.message || "").toLowerCase();

  if (type === "Vibe") {
    const positive = ["packed", "lit", "crowded", "busy", "good", "jumping"];
    const negative = ["dead", "empty", "slow", "quiet"];

    if (positive.some((word) => message.includes(word))) return 2;
    if (negative.some((word) => message.includes(word))) return -2;
    return 0;
  }

  if (type === "Line") return 1;
  if (type === "Music" || type === "Event") return 1;
  return 0;
}

function getBehaviorCategory(venue: Partial<VenueWithEvent>): "nightlife" | "restaurant" | "event" {
  const searchable = [
    venue.name,
    venue.type,
    venue.category,
    venue.music_genre,
    venue.tonightEvent?.title,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/concert|arena|theater|theatre|music hall|opera|event|performance|show|venue/.test(searchable)) {
    return "event";
  }

  if (/restaurant|grill|diner|taco|taqueria|pizza|seafood|burger|kitchen|food|cafe|brunch|eat|deli|fish|oyster|chophouse/.test(searchable)) {
    return "restaurant";
  }

  return "nightlife";
}

type LiveReportOption = {
  label: string;
  type: string;
  value: string;
  tone: "quiet" | "watch" | "active" | "hot";
};

function getLiveReportOptions(category: "nightlife" | "restaurant" | "event"): LiveReportOption[] {
  if (category === "restaurant") {
    return [
      { label: "No Wait", type: "crowd", value: "no_wait", tone: "quiet" },
      { label: "Busy", type: "crowd", value: "busy", tone: "watch" },
      { label: "Packed", type: "crowd", value: "packed", tone: "hot" },
      { label: "Long Wait", type: "wait", value: "long_wait", tone: "active" },
      { label: "Date Vibe", type: "vibe", value: "decent", tone: "watch" },
    ];
  }

  if (category === "event") {
    return [
      { label: "Selling Fast", type: "tickets", value: "selling_fast", tone: "active" },
      { label: "Packed", type: "crowd", value: "packed", tone: "hot" },
      { label: "Good Crowd", type: "crowd", value: "great_crowd", tone: "hot" },
      { label: "Long Line", type: "line", value: "line_crazy", tone: "active" },
      { label: "Quiet", type: "crowd", value: "dead", tone: "quiet" },
    ];
  }

  return [
    { label: "Packed", type: "crowd", value: "packed", tone: "hot" },
    { label: "Good Crowd", type: "crowd", value: "great_crowd", tone: "hot" },
    { label: "Good Energy", type: "vibe", value: "decent", tone: "watch" },
    { label: "Long Line", type: "line", value: "line_crazy", tone: "active" },
    { label: "Quiet", type: "vibe", value: "dead", tone: "quiet" },
  ];
}

function liveReportValueScore(reportValue?: string | null) {
  switch (reportValue) {
    case "lit":
      return 34;
    case "great_crowd":
      return 32;
    case "packed":
      return 36;
    case "line_crazy":
      return 24;
    case "long_wait":
      return 22;
    case "selling_fast":
      return 26;
    case "busy":
      return 20;
    case "decent":
      return 14;
    case "no_wait":
      return 6;
    case "dead":
      return -34;
    default:
      return 0;
  }
}

function getLiveReportScore(reports: any[]) {
  return reports.reduce((sum, report) => {
    const minutes = getMinutesSince(report.created_at);
    const recency = minutes === null ? 0.35 : minutes <= 20 ? 1 : minutes <= 45 ? 0.75 : minutes <= 90 ? 0.45 : 0.2;
    return sum + liveReportValueScore(report.report_value) * recency;
  }, 0);
}

function getDominantReportSummary(reports: any[]) {
  if (!reports.length) return null;

  const counts = reports.reduce<Record<string, number>>((acc, report) => {
    const value = report.report_value || "unknown";
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});

  const [value, count] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  const label = value.replace(/_/g, " ");
  return `People are calling it: ${label}`;
}

function reportToneClasses(tone: LiveReportOption["tone"]) {
  if (tone === "hot") return "border-red-300/30 bg-red-500/15 text-red-50 hover:bg-red-500/25";
  if (tone === "active") return "border-orange-300/25 bg-orange-500/15 text-orange-50 hover:bg-orange-500/25";
  if (tone === "watch") return "border-yellow-300/25 bg-yellow-500/15 text-yellow-50 hover:bg-yellow-500/25";
  return "border-white/10 bg-white/10 text-white/75 hover:bg-white/15";
}

function venueType(venue: VenueWithEvent) {
  return venue.type || "Nightlife Spot";
}

function minutesAgo(date?: string | null) {
  if (!date) return "No recent votes";
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Updated just now";
  return `Updated ${mins} min ago`;
}

function getDeviceId() {
  if (typeof window === "undefined") return null;

  let deviceId = localStorage.getItem("lit757_device_id");

  if (!deviceId) {
    deviceId = crypto.randomUUID();
    localStorage.setItem("lit757_device_id", deviceId);
  }

  return deviceId;
}

function hasRealVenueSignals(venue: VenueWithEvent) {
  // Real signals are human votes, live updates, or a scheduled event.
  // Local signal should guide discovery, but it should not create “packed” heat by itself.
  return (
    (venue.voteCount || 0) > 0 ||
    (venue.updateCount || 0) > 0 ||
    (venue.liveReportCount || 0) > 0 ||
    !!venue.tonightEvent
  );
}

function hasGhostVenueSignal(venue: VenueWithEvent) {
  return !!venue.hasGhostData && (venue.aiScore || 0) > 0;
}

function isAiWatchingVenue(venue: VenueWithEvent) {
  // AI-only signal: visible, calm, and honest. No red heat.
  return !hasRealVenueSignals(venue) && hasGhostVenueSignal(venue) && (venue.aiScore || 0) >= 45;
}

function getMapVisualStatus(venue: VenueWithEvent): "quiet" | "watching" | "active" | "packed" {
  const hasReal = hasRealVenueSignals(venue);
  const score = venue.vibeScore || venue.score || venue.aiScore || 0;

  if (hasReal && score >= 78) return "packed";
  if (hasReal) return "active";
  if (isAiWatchingVenue(venue)) return "watching";
  return "quiet";
}

function getHeatWeight(venue: VenueWithEvent) {
  // Heatmap is only for confirmed or live context.
  // AI-only venues stay as clean dots so the map doesn’t lie.
  if (!hasRealVenueSignals(venue)) return 0;

  const baseVotes = venue.voteCount || 0;
  const baseUpdates = venue.updateCount || 0;
  const baseReports = venue.liveReportCount || 0;
  const eventWeight = venue.tonightEvent ? 8 : 0;
  const score = Math.max(0, venue.vibeScore || venue.score || 0);
  const trending = Math.max(0, venue.trendingScore || 0);

  const rawValue = baseVotes * 10 + baseUpdates * 8 + baseReports * 12 + eventWeight + score * 0.18 + trending * 0.12;
  return Math.max(1, rawValue);
}

function updateMarkerElement(el: HTMLElement, venue: VenueWithEvent, zoom: number) {
  const signals = (venue.voteCount || 0) + (venue.updateCount || 0) + (venue.liveReportCount || 0);
  const hasReal = hasRealVenueSignals(venue);
  const visualStatus = getMapVisualStatus(venue);
  const active = hasReal && (signals > 0 || (venue.trendingScore || 0) > 2 || venue.status === "lit" || !!venue.tonightEvent);
  const watching = visualStatus === "watching";
  const hasUpcomingEvent = (venue.upcomingEvents || []).length > 0 || !!venue.hasUpcomingEvent;
  
  let shouldShow = true;
  let displaySize = 0;
  
  if (zoom < 10) {
    shouldShow = active || watching || hasUpcomingEvent;
    displaySize = active ? 11 : watching ? 7 : hasUpcomingEvent ? 7 : 4;
  } else if (zoom < 12) {
    shouldShow = true;
    displaySize = active ? 14 : watching ? 9 : hasUpcomingEvent ? 9 : 7;
  } else {
    shouldShow = true;
    displaySize = active
      ? signals === 0 ? 16 : signals <= 2 ? 22 : signals <= 5 ? 28 : 34
      : watching
      ? 12
      : hasUpcomingEvent
      ? 11
      : 9;
  }
  
  el.style.display = shouldShow ? "block" : "none";
  el.style.width = `${displaySize}px`;
  el.style.height = `${displaySize}px`;
  el.style.opacity = active ? "1" : watching ? "0.9" : zoom < 12 ? "0.45" : "0.65";

  const core = el.querySelector(".lit-marker-core") as HTMLElement | null;
  if (!core) return;

  const baseColor =
    visualStatus === "packed"
      ? "#ef4444"
      : visualStatus === "active"
      ? "#fb923c"
      : visualStatus === "watching"
      ? "#facc15"
      : hasUpcomingEvent
      ? "#38bdf8"
      : "#6b7280";

  core.style.background = baseColor;
  core.style.border = active || watching ? "1.5px solid white" : "1px solid rgba(255,255,255,0.25)";
  core.style.transform = visualStatus === "packed" && zoom >= 12 ? "scale(1.08)" : "scale(1)";
  core.style.filter = "none";
  core.style.boxShadow = active
    ? visualStatus === "packed"
      ? "0 0 30px rgba(239,68,68,0.42)"
      : "0 0 22px rgba(251,146,60,0.32)"
    : watching
    ? "0 0 12px rgba(250,204,21,0.18)"
    : "none";
  core.style.animation = visualStatus === "packed" && zoom >= 12 ? "litPulse 1.8s ease-in-out infinite" : "none";
}

function buildVenueHeatmapGeoJSON(
  venues: VenueWithEvent[]
): GeoJSON.FeatureCollection<GeoJSON.Geometry, GeoJSON.GeoJsonProperties> {
  type HeatFeature = GeoJSON.Feature<
    GeoJSON.Point,
    {
      weight: number;
      voteCount: number;
      updateCount: number;
      score: number;
      trendingScore: number;
    }
  >;

  const features: HeatFeature[] = venues.flatMap((venue) => {
    // Only real/live signals create heat. Local signal alone stays out of the heatmap.
    if (!hasRealVenueSignals(venue) || !venue.lng || !venue.lat) return [];

    const weight = getHeatWeight(venue);

    return [
      {
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [venue.lng, venue.lat],
        },
        properties: {
          weight,
          voteCount: venue.voteCount || 0,
          updateCount: venue.updateCount || 0,
          liveReportCount: venue.liveReportCount || 0,
          score: venue.score || 0,
          trendingScore: venue.trendingScore || 0,
        },
      },
    ];
  });

  console.log("heatmap geojson build: feature count", features.length);

  return {
    type: "FeatureCollection",
    features,
  };
}

function getVibeIntensity(venue: VenueWithEvent | null) {
  if (!venue) return 12;
  return clampScore(venue.vibeScore ?? venue.score ?? 12);
}

function vibeMeterLabel(venue: VenueWithEvent | null) {
  if (!venue) return "Warming up";
  if (venue.vibeTrend === "surging") return "People are checking in";
  if (venue.vibeTrend === "heating") return "Momentum is building";
  if (venue.vibeTrend === "steady") return "Steady energy";
  if (venue.vibeTrend === "cooling") return "Cooling off";
  return "Needs more night moves";
}

function getVenueScoreBreakdown(venue: VenueWithEvent | null) {
  if (!venue) return [];

  const hasEvent = !!venue.tonightEvent;
  const ticketBoost = hasEvent
    ? getTicketDemandBoost(venue.tonightEvent?.ticket_status || venue.tonightEvent?.cover_price)
    : 0;
  const timingBoost = hasEvent ? getEventTimingBoost(venue.tonightEvent) : 0;
  const liveSignalCount = (venue.voteCount || 0) + (venue.updateCount || 0) + (venue.liveReportCount || 0);
  const voteBoost = Math.min(24, (venue.voteCount || 0) * 9);
  const reportBoost = Math.max(0, Math.min(24, Math.round(venue.liveReportScore || 0)));
  const aiBoost = !hasEvent && liveSignalCount === 0 && venue.hasGhostData ? Math.round(venue.aiScore || 0) : 0;

  const items = [
    {
      label: hasEvent ? "Event pull" : "Event pull",
      value: hasEvent ? `+${22 + timingBoost}` : "+0",
      detail: hasEvent
        ? `${venue.tonightEvent?.title || "Event"} ${venue.tonightEvent?.starts_at_label ? `· ${venue.tonightEvent.starts_at_label}` : ""}`
        : "No event matched yet",
      active: hasEvent,
    },
    {
      label: "Ticket heat",
      value: ticketBoost ? `+${ticketBoost}` : "+0",
      detail: venue.tonightEvent?.ticket_status || "No ticket trend yet",
      active: ticketBoost > 0,
    },
    {
      label: "People there",
      value: liveSignalCount ? `+${voteBoost + reportBoost}` : "+0",
      detail: liveSignalCount
        ? `${liveSignalCount} live signal${liveSignalCount === 1 ? "" : "s"}`
        : "No night moves yet",
      active: liveSignalCount > 0,
    },
    {
      label: "Tonight's vibe",
      value: aiBoost ? `+${aiBoost}` : venue.hasGhostData ? `+${Math.round((venue.aiScore || 0) * 0.28)}` : "+0",
      detail: venue.hasGhostData ? "This spot has a read for tonight" : "Still early tonight",
      active: !!venue.hasGhostData,
    },
  ];

  return items;
}

function getPrimaryLitReason(venue: VenueWithEvent | null) {
  if (!venue) return "Waiting on live signals.";

  const event = venue.tonightEvent as any;
  const liveSignalCount = (venue.voteCount || 0) + (venue.updateCount || 0) + (venue.liveReportCount || 0);

  if (event?.title) {
    const ticket = event.ticket_status || event.cover_price;
    return `${event.title} is driving this score${ticket ? ` · ${ticket}` : ""}${event.starts_at_label ? ` · ${event.starts_at_label}` : ""}.`;
  }

  if (liveSignalCount > 0) {
    return `${liveSignalCount} fresh live signal${liveSignalCount === 1 ? "" : "s"} are driving this score.`;
  }

  if (venue.hasGhostData) {
    return "This spot is on the radar tonight.";
  }

  return "Quiet right now. Check back later tonight.";
}

function getDecisionLabel(venue: VenueWithEvent | null) {
  if (!venue) return "Check before you go";
  if (venue.status === "lit") return "Strong move right now";
  if (venue.status === "decent") return "Worth keeping on your list";
  return "Needs more check-ins";
}

function buildVenuePointsGeoJSON(
  venues: VenueWithEvent[],
  spotlightVenueId?: string | null
): GeoJSON.FeatureCollection<GeoJSON.Point, GeoJSON.GeoJsonProperties> {
  const rankedLiveVenues = [...venues]
    .filter((venue) => venue.lng && venue.lat && hasRealVenueSignals(venue))
    .sort((a, b) => {
      const aScore =
        (a.vibeScore || a.score || 0) +
        (a.trendingScore || 0) +
        ((a.voteCount || 0) + (a.updateCount || 0)) * 10 +
        (a.tonightEvent ? 12 : 0);
      const bScore =
        (b.vibeScore || b.score || 0) +
        (b.trendingScore || 0) +
        ((b.voteCount || 0) + (b.updateCount || 0)) * 10 +
        (b.tonightEvent ? 12 : 0);

      return bScore - aScore;
    });

  const topMoveIds = new Set(rankedLiveVenues.slice(0, 3).map((venue) => venue.id));
  const topMoveOneId = rankedLiveVenues[0]?.id || null;

  const features = venues.flatMap((venue) => {
    if (!venue.lng || !venue.lat) return [];

    const signalCount = (venue.voteCount || 0) + (venue.updateCount || 0) + (venue.liveReportCount || 0);
    const realSignals = hasRealVenueSignals(venue);
    const hasUpcomingEvent = (venue.upcomingEvents || []).length > 0 || !!venue.hasUpcomingEvent;
    const aiScore = Math.max(0, venue.aiScore || 0);
    const vibeScore = Math.max(0, venue.vibeScore || venue.score || aiScore || 0);
    const visualStatus = getMapVisualStatus(venue);
    const isAiWatching = visualStatus === "watching";
    const trending = realSignals ? Math.max(0, venue.trendingScore || 0) : 0;
    const activeScore = realSignals
      ? Math.max(1, signalCount * 7 + (venue.tonightEvent ? 8 : 0) + trending + vibeScore * 0.25)
      : 0;
    const isSurging = realSignals && (venue.vibeTrend === "surging" || vibeScore >= 78 || trending >= 90);
    const isHeating = realSignals && !isSurging && (venue.vibeTrend === "heating" || venue.energyLevel === "medium" || vibeScore >= 55);
    const isCooling = realSignals && (venue.vibeTrend === "cooling" || venue.energyLevel === "negative");
    const isSpotlight = !!spotlightVenueId && venue.id === spotlightVenueId;

    return [
      {
        type: "Feature" as const,
        id: venue.id,
        geometry: {
          type: "Point" as const,
          coordinates: [venue.lng, venue.lat],
        },
        properties: {
          id: venue.id,
          name: venue.name,
          status: venue.status || "dead",
          visualStatus,
          energyLevel: venue.energyLevel || "low",
          voteCount: venue.voteCount || 0,
          updateCount: venue.updateCount || 0,
          liveReportCount: venue.liveReportCount || 0,
          score: vibeScore,
          aiScore,
          vibeScore,
          vibeTrend: realSignals ? venue.vibeTrend || "quiet" : "quiet",
          trendingScore: trending,
          signalCount,
          activeScore,
          hasUpcomingEvent,
          isAiWatching,
          isSurging,
          isHeating,
          isCooling,
          isSpotlight,
          isTopMove: topMoveIds.has(venue.id),
          isTopMoveOne: topMoveOneId === venue.id,
        },
      },
    ];
  });

  return {
    type: "FeatureCollection",
    features,
  };
}


type RecommendationIntent = {
  raw: string;
  preference: string;
  asksHookah: boolean;
  asksBar: boolean;
  asksClub: boolean;
  asksLounge: boolean;
  asksRestaurant: boolean;
  asksEvent: boolean;
  asksConcert: boolean;
  asksCheap: boolean;
  asksNoCover: boolean;
  asksEighteenPlus: boolean;
  asksTwentyOnePlus: boolean;
  asksPacked: boolean;
  asksChill: boolean;
  asksTurnUp: boolean;
  musicTerms: string[];
  hasHardFilters: boolean;
};

function includesAny(value: string, terms: string[]) {
  return terms.some((term) => value.includes(term));
}

function getVenueSearchText(venue: Partial<VenueWithEvent>) {
  return [
    venue.name,
    (venue as any).city,
    (venue as any).address,
    venue.category,
    venue.type,
    venue.music_genre,
    (venue as any).cover,
    (venue as any).age_limit,
    (venue as any).description,
    venue.tonightEvent?.title,
    venue.tonightEvent?.name,
    venue.tonightEvent?.genre,
    venue.tonightEvent?.dj,
    venue.tonightEvent?.cover_price,
    venue.tonightEvent?.age_limit,
    venue.tonightEvent?.description,
    venue.aiSummary,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function getVenueKind(venue: Partial<VenueWithEvent>) {
  const text = getVenueSearchText(venue);

  const isHookah = /\bhookah\b|\bshisha\b|\bcigar lounge\b/.test(text);
  const isTheaterOrEventOnly = /\btheater\b|\btheatre\b|\bopera\b|\bperformance hall\b|\bconcert hall\b|\barena\b|\bcoliseum\b|\bmuseum\b|\bgallery\b|\barts center\b|\bperforming arts\b/.test(text);
  const isRestaurant = /\brestaurant\b|\bgrill\b|\bkitchen\b|\bcafe\b|\bdiner\b|\bseafood\b|\btaco\b|\bpizza\b|\bburger\b|\bbrunch\b|\beats\b|\bdining\b/.test(text);
  const isBar = /\bbar\b|\bpub\b|\btavern\b|\bsaloon\b|\bcocktail\b|\bbrewery\b|\btaproom\b|\bbeer\b|\bsports bar\b/.test(text);
  const isClub = /\bclub\b|\bnightclub\b|\bdance\b|\bdj\b/.test(text);
  const isLounge = /\blounge\b|\bupscale\b|\bcocktail lounge\b/.test(text);
  const isConcert = /\bconcert\b|\blive music\b|\bshow\b|\btour\b|\bartist\b|\bperformance\b/.test(text);
  const isNightlife = isHookah || isBar || isClub || isLounge || (!isTheaterOrEventOnly && /\bnightlife\b|\bparty\b|\bdrinks\b|\bcover\b|\b21\+\b|\b18\+\b/.test(text));

  return {
    text,
    isHookah,
    isTheaterOrEventOnly,
    isRestaurant,
    isBar,
    isClub,
    isLounge,
    isConcert,
    isNightlife,
  };
}

function parseRecommendationIntent(question?: string, preferenceOverride?: string | null, selectedPreference?: string | null): RecommendationIntent {
  const raw = `${question || ""} ${preferenceOverride ?? selectedPreference ?? ""}`.toLowerCase().trim();
  const preference = String(preferenceOverride ?? selectedPreference ?? "").toLowerCase();
  const asksHookah = /\bhookah\b|\bshisha\b/.test(raw) || preference.includes("hookah");
  const asksBar = /\bbar\b|\bbars\b|\bpub\b|\btavern\b|\bcocktail\b|\bdrinks\b|\bcountry bar\b/.test(raw) || preference.includes("bar");
  const asksClub = /\bclub\b|\bclubs\b|\bnightclub\b|\bdance\b/.test(raw) || preference.includes("club");
  const asksLounge = /\blounge\b|\blounges\b/.test(raw) || preference.includes("lounge");
  const asksRestaurant = /\brestaurant\b|\bfood\b|\bdinner\b|\beat\b|\bbrunch\b|\bdate night\b/.test(raw) || preference.includes("food") || preference.includes("brunch");
  const asksConcert = /\bconcert\b|\bshow\b|\blive music\b|\bperformance\b/.test(raw) || preference.includes("concert") || preference.includes("live music");
  const asksEvent = /\bevent\b|\bevents\b|\btonight\b/.test(raw) || preference.includes("event");
  const asksCheap = /\bcheap\b|\blow cover\b|\baffordable\b|\bfree\b|\bno cover\b/.test(raw) || preference.includes("cheap");
  const asksNoCover = /\bno cover\b|\bfree cover\b|\bfree entry\b/.test(raw);
  const asksEighteenPlus = /\b18\+\b|\b18 and up\b|\beighteen\b/.test(raw) || preference.includes("18+");
  const asksTwentyOnePlus = /\b21\+\b|\b21 and up\b|\btwenty one\b|\btwenty-one\b/.test(raw) || preference.includes("21+");
  const asksPacked = /\bpacked\b|\bcrowded\b|\bbusy\b|\bjumping\b|\bactive\b|\bwhat'?s lit\b|\blit now\b/.test(raw);
  const asksChill = /\bchill\b|\brelaxed\b|\blowkey\b|\blow key\b/.test(raw);
  const asksTurnUp = /\bturn up\b|\bparty\b|\blit\b|\bhype\b/.test(raw);

  const possibleMusicTerms = [
    "country",
    "hip-hop",
    "hip hop",
    "rap",
    "r&b",
    "rnb",
    "latin",
    "salsa",
    "bachata",
    "reggaeton",
    "afrobeats",
    "afrobeat",
    "amapiano",
    "dancehall",
    "edm",
    "house",
    "techno",
    "jazz",
    "karaoke",
  ];
  const musicTerms = possibleMusicTerms.filter((term) => raw.includes(term));

  const hasHardFilters =
    asksHookah ||
    asksBar ||
    asksClub ||
    asksLounge ||
    asksRestaurant ||
    asksConcert ||
    asksCheap ||
    asksNoCover ||
    asksEighteenPlus ||
    asksTwentyOnePlus ||
    musicTerms.length > 0;

  return {
    raw,
    preference,
    asksHookah,
    asksBar,
    asksClub,
    asksLounge,
    asksRestaurant,
    asksEvent,
    asksConcert,
    asksCheap,
    asksNoCover,
    asksEighteenPlus,
    asksTwentyOnePlus,
    asksPacked,
    asksChill,
    asksTurnUp,
    musicTerms,
    hasHardFilters,
  };
}

function venueMatchesRecommendationIntent(venue: VenueWithEvent, intent: RecommendationIntent) {
  const kind = getVenueKind(venue);
  const text = kind.text;
  const ageText = `${(venue as any).age_limit || ""} ${venue.tonightEvent?.age_limit || ""}`.toLowerCase();
  const coverText = `${(venue as any).cover || ""} ${venue.tonightEvent?.cover_price || ""} ${venue.tonightEvent?.ticket_status || ""}`.toLowerCase();

  if (intent.asksHookah && !kind.isHookah) return false;

  if (intent.asksBar && !(kind.isBar || kind.isLounge || kind.isClub || kind.isHookah)) return false;
  if (intent.asksClub && !kind.isClub) return false;
  if (intent.asksLounge && !(kind.isLounge || kind.isHookah)) return false;
  if (intent.asksRestaurant && !(kind.isRestaurant || text.includes("food") || text.includes("brunch"))) return false;
  if (intent.asksConcert && !(kind.isConcert || kind.isTheaterOrEventOnly)) return false;

  // If someone asks for nightlife/bar/club/lounge/hookah, do not let theaters, museums, or event-only venues win
  // unless the user specifically asked for concerts/events.
  const asksNightlifePlace = intent.asksHookah || intent.asksBar || intent.asksClub || intent.asksLounge || intent.asksTwentyOnePlus || intent.asksEighteenPlus;
  if (asksNightlifePlace && kind.isTheaterOrEventOnly && !intent.asksConcert) return false;

  if (intent.asksTwentyOnePlus && !(/21\+|21 and up|twenty one|twenty-one/.test(ageText) || (kind.isBar || kind.isClub || kind.isLounge || kind.isHookah))) {
    return false;
  }

  if (intent.asksEighteenPlus && !(/18\+|18 and up|eighteen/.test(ageText))) {
    return false;
  }

  if (intent.asksNoCover && !(/no cover|free cover|free entry|\$0|free/.test(coverText))) return false;
  if (intent.asksCheap && !(/cheap|low cover|no cover|free|\$0|\$5|\$10|varies/.test(coverText) || !coverText.trim())) return false;

  if (intent.musicTerms.length > 0) {
    const normalizedText = text.replace(/r and b/g, "r&b");
    const hasMusicMatch = intent.musicTerms.some((term) => normalizedText.includes(term));
    if (!hasMusicMatch) return false;
  }

  return true;
}

function getRecommendationIntentLabel(intent: RecommendationIntent) {
  const parts: string[] = [];
  if (intent.asksEighteenPlus) parts.push("18+");
  if (intent.asksTwentyOnePlus) parts.push("21+");
  if (intent.musicTerms.length) parts.push(intent.musicTerms[0]);
  if (intent.asksHookah) parts.push("hookah");
  else if (intent.asksClub) parts.push("club");
  else if (intent.asksBar) parts.push("bar");
  else if (intent.asksLounge) parts.push("lounge");
  else if (intent.asksRestaurant) parts.push("food spot");
  else if (intent.asksConcert) parts.push("event");
  if (intent.asksCheap) parts.push("cheap cover");
  return parts.length ? parts.join(" ") : "best move";
}

function getNoExactMatchMessage(intent: RecommendationIntent) {
  const label = getRecommendationIntentLabel(intent);
  return `I couldn’t find a clean ${label} match yet. Try a broader ask like “what’s lit now?” or check another category.`;
}

export default function Home() {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const filteredVenuesRef = useRef<VenueWithEvent[]>([]);
  const touchStartY = useRef<number | null>(null);
  const activeStripRef = useRef<HTMLDivElement | null>(null);

  const [venues, setVenues] = useState<VenueWithEvent[]>([]);
  const [upcomingEvents, setUpcomingEvents] = useState<any[]>([]);
  const [venuesLoading, setVenuesLoading] = useState(true);
  const [selected, setSelected] = useState<VenueWithEvent | null>(null);
  const selectedRef = useRef<VenueWithEvent | null>(null);
  const refreshIntervalRef = useRef<number | null>(null);
  const [city, setCity] = useState("All 757");
  const [query, setQuery] = useState("");
  const [activeChip, setActiveChip] = useState("All");
  const [chipsExpanded, setChipsExpanded] = useState(false);
  const [viewMode, setViewMode] = useState<"map" | "events">("map");
  const [map, setMap] = useState<mapboxgl.Map | null>(null);
  const userLocationMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const [heatmapEnabled, setHeatmapEnabled] = useState(true);
  const [mapMode, setMapMode] = useState<MapMode>(() => getInitialMapMode());
  const [currentZoom, setCurrentZoom] = useState(10);
  const [navigationActive, setNavigationActive] = useState<ActiveNavigation | null>(null);
  const [navigationLoading, setNavigationLoading] = useState(false);
  const [navigationError, setNavigationError] = useState<string | null>(null);
  const [sheetExpanded, setSheetExpanded] = useState(false);
  const [summary, setSummary] = useState("");
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [cityPulseSummary, setCityPulseSummary] = useState("");
  const [cityPulseTopVenues, setCityPulseTopVenues] = useState<any[]>([]);
  const [cityPulseLoading, setCityPulseLoading] = useState(false);
  const [recommendation, setRecommendation] = useState("");
  const [recommendationVenue, setRecommendationVenue] = useState("");
  const [recommendationReasons, setRecommendationReasons] = useState<string[]>([]);
  const [recommendationLoading, setRecommendationLoading] = useState(false);
  const [recommendationQuestion, setRecommendationQuestion] = useState("");
  const [recognitionActive, setRecognitionActive] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState<"idle" | "listening" | "thinking" | "speaking">("idle");
  const [voiceBubbleOpen, setVoiceBubbleOpen] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const [askModalOpen, setAskModalOpen] = useState(false);
  const [askText, setAskText] = useState("");
  const [recognitionError, setRecognitionError] = useState<string | null>(null);
  const [selectedPreference, setSelectedPreference] = useState<string | null>(null);
  const [venueDirectoryOpen, setVenueDirectoryOpen] = useState(false);
  const [suggestionOpen, setSuggestionOpen] = useState(false);
  const [suggestionType, setSuggestionType] = useState("Event");
  const [suggestionMessage, setSuggestionMessage] = useState("");
  const [suggestionMediaFile, setSuggestionMediaFile] = useState<File | null>(null);
  const [suggestionLoading, setSuggestionLoading] = useState(false);
  const [suggestionFeedback, setSuggestionFeedback] = useState("");
  const [suggestionStatus, setSuggestionStatus] = useState<"success" | "error" | null>(null);
  const [shareFeedback, setShareFeedback] = useState("");
  const [liveReportFeedback, setLiveReportFeedback] = useState("");
  const [liveReportLoading, setLiveReportLoading] = useState(false);
  const [eventOpen, setEventOpen] = useState(false);
  const [eventTitle, setEventTitle] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [eventTime, setEventTime] = useState("");
  const [eventGenre, setEventGenre] = useState("");
  const [eventDj, setEventDj] = useState("");
  const [eventCoverPrice, setEventCoverPrice] = useState("");
  const [eventAgeLimit, setEventAgeLimit] = useState("");
  const [eventDescription, setEventDescription] = useState("");
  const [eventLoading, setEventLoading] = useState(false);
  const [eventFeedback, setEventFeedback] = useState("");
  const [eventStatus, setEventStatus] = useState<"success" | "error" | null>(null);
  const [recentUpdates, setRecentUpdates] = useState<Array<{
    id: string;
    update_type: string | null;
    message: string | null;
    media_url?: string | null;
    media_type?: string | null;
    created_at: string | null;
  }>>([]);
  const [cityFeed, setCityFeed] = useState<CityPulseItem[]>([]);
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);
  const [activityToasts, setActivityToasts] = useState<ActivityToast[]>([]);
  const [activePulseVenueId, setActivePulseVenueId] = useState<string | null>(null);
  const activePulseTimeoutRef = useRef<number | null>(null);
  const activityFeedPrimedRef = useRef(false);
  const seenActivityIdsRef = useRef<Set<string>>(new Set());
  const toastTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    async function fetchSummary() {
      try {
        setSummaryLoading(true);
        const response = await fetch("/api/summary");
        if (!response.ok) {
          throw new Error("Summary fetch failed");
        }
        const data = await response.json();
        setSummary(data.summary || "");
      } catch (error) {
        console.error("Summary error:", error);
      } finally {
        setSummaryLoading(false);
      }
    }

    fetchSummary();
  }, []);

  useEffect(() => {
    let ignore = false;

    async function fetchCityPulse() {
      try {
        setCityPulseLoading(true);

        const response = await fetch(
          `/api/city-summary?city=${encodeURIComponent(city)}`
        );

        if (!response.ok) {
          throw new Error("City pulse fetch failed");
        }

        const data = await response.json();

        if (ignore) return;

        setCityPulseSummary(data.summary || "");
        setCityPulseTopVenues(data.top_venues || []);
      } catch (error) {
        console.error("City pulse error:", error);

        if (!ignore) {
          setCityPulseSummary("");
          setCityPulseTopVenues([]);
        }
      } finally {
        if (!ignore) {
          setCityPulseLoading(false);
        }
      }
    }

    fetchCityPulse();

    return () => {
      ignore = true;
    };
  }, [city]);

  useEffect(() => {
    function handleOutsideClick(event: MouseEvent) {
      const target = event.target as HTMLElement;

      if (
        venueDirectoryOpen &&
        !target.closest(".venue-directory-panel") &&
        !target.closest(".all-chip-button")
      ) {
        setVenueDirectoryOpen(false);
      }
    }

    document.addEventListener("mousedown", handleOutsideClick);

    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
    };
  }, [venueDirectoryOpen]);

  async function fetchRecommendation(question?: string, preferenceOverride?: string | null) {
    try {
      setRecommendationLoading(true);
      setRecommendation("");
      setRecommendationVenue("");
      setRecommendationReasons([]);
      setRecommendationQuestion(question || "");

      // Intent-first recommendation engine:
      // 1) Understand what the user asked for.
      // 2) Hard-filter obvious wrong categories before scoring.
      // 3) Rank only valid matches so theaters do not win bar/hookah/21+ requests.
      const intent = parseRecommendationIntent(question, preferenceOverride, selectedPreference);
      const userQuestion = (question || "").toLowerCase();
      const preference = (preferenceOverride !== undefined ? preferenceOverride ?? "" : selectedPreference ?? "").toLowerCase();
      const pool = filteredVenues.length > 0 ? filteredVenues : venues;

      const exactMatches = intent.hasHardFilters
        ? pool.filter((venue) => venueMatchesRecommendationIntent(venue, intent))
        : pool;

      if (intent.hasHardFilters && exactMatches.length === 0) {
        const fallback = getNoExactMatchMessage(intent);
        setRecommendationReasons([
          `No exact ${getRecommendationIntentLabel(intent)} match passed the hard filters.`,
          "I blocked weak matches like theaters, museums, or restaurants from winning nightlife-specific requests.",
          "A broader search may surface better options tonight.",
        ]);
        setRecommendation(fallback);
        return fallback;
      }

      const withSignals = exactMatches.filter((venue) => hasRealVenueSignals(venue));
      const candidates = withSignals.length > 0 ? withSignals : exactMatches;

      const scored = candidates.map((venue) => {
        const vibeScore = venue.vibeScore || venue.score || 0;
        const signals = (venue.voteCount || 0) + (venue.updateCount || 0) + (venue.liveReportCount || 0);
        const eventBoost = venue.tonightEvent ? 10 : 0;
        const photoBoost = (venue as any).photo_url ? 4 : 0;
        const confidenceBoost = venue.confidence === "high" ? 8 : venue.confidence === "medium" ? 4 : 0;
        const trendBoost = venue.vibeTrend === "surging" ? 18 : venue.vibeTrend === "heating" ? 10 : venue.vibeTrend === "steady" ? 4 : 0;
        const realSignalBoost = hasRealVenueSignals(venue) ? 18 : -4;
        const kind = getVenueKind(venue);
        const searchable = kind.text;

        const preferenceBoost = preference && searchable.includes(preference.replace("-", " ")) ? 18 : 0;
        const questionBoost = userQuestion && searchable.split(/\s+/).some((word) => userQuestion.includes(word) && word.length > 3) ? 8 : 0;
        const exactIntentBoost = intent.hasHardFilters ? 28 : 0;
        const packedBoost = intent.asksPacked && (venue.vibeTrend === "surging" || venue.vibeTrend === "heating" || (venue.liveReportCount || 0) > 0) ? 16 : 0;
        const cheapBoost = (intent.asksCheap || preference.includes("cheap")) && /free|cheap|\$0|no cover|\$5|\$10|varies/i.test(String((venue as any).cover || venue.tonightEvent?.cover_price || "")) ? 16 : 0;
        const turnUpBoost = (intent.asksTurnUp || preference.includes("turn")) && ["lit", "decent"].includes(String(venue.status)) ? 12 : 0;
        const chillBoost = (intent.asksChill || preference.includes("chill")) && venue.vibeTrend !== "surging" ? 10 : 0;
        const eventOnlyPenalty = kind.isTheaterOrEventOnly && !intent.asksConcert && !intent.asksEvent ? -35 : 0;

        return {
          venue,
          rank:
            vibeScore +
            signals * 8 +
            eventBoost +
            photoBoost +
            confidenceBoost +
            trendBoost +
            realSignalBoost +
            preferenceBoost +
            questionBoost +
            exactIntentBoost +
            packedBoost +
            cheapBoost +
            turnUpBoost +
            chillBoost +
            eventOnlyPenalty,
        };
      });

      scored.sort((a, b) => b.rank - a.rank);
      const pick = scored[0]?.venue || null;

      if (!pick) {
        const fallback = "I don’t see a strong move yet. Try switching city filters or check back later tonight.";
        setRecommendationReasons([
          "No strong move is standing out in the current filters.",
          "Try widening the city/category filters or check back later tonight.",
        ]);
        setRecommendation(fallback);
        return fallback;
      }

      const signals = (pick.voteCount || 0) + (pick.updateCount || 0) + (pick.liveReportCount || 0);
      const confidence = confidenceLabel(pick.confidence);
      const trend = vibeTrendLabel(pick.vibeTrend);
      const intentLabel = getRecommendationIntentLabel(intent);
      const eventText = pick.tonightEvent
        ? ` There’s also ${pick.tonightEvent.title} tonight${pick.tonightEvent.dj ? ` with ${pick.tonightEvent.dj}` : ""}.`
        : "";
      const urgency = pick.vibeTrend === "surging"
        ? "Go now before it cools off."
        : pick.vibeTrend === "heating"
        ? "This is the move to watch over the next hour."
        : signals > 0
        ? "It has some real activity, but check again before you commit."
        : pick.hasGhostData
        ? "This spot has momentum tonight."
        : "Still early, so treat this as a discovery pick.";

      const reason = pick.vibeReason || "The venue context and tonight’s momentum make this a strong move.";
      const vibeScoreText = `${pick.vibeScore || pick.score || 0}/100 vibe score`;
      const recommendationText = `${pick.name} is my ${intent.hasHardFilters ? intentLabel : "best move"} pick. ${trend}. ${reason}${eventText} ${urgency}`;

      const whyReasons = [
        intent.hasHardFilters
          ? `It matches what you asked for: ${intentLabel}.`
          : `Best current match for your filters.`,
        signals > 0
          ? `This spot has some motion right now.`
          : pick.tonightEvent
          ? "Tonight’s event makes this one worth watching."
          : pick.hasGhostData
          ? `This spot has momentum tonight.`
          : "Discovery pick while the night is still warming up.",
        pick.vibeTrend && pick.vibeTrend !== "quiet"
          ? `${vibeTrendLabel(pick.vibeTrend)} momentum around this spot tonight.`
          : "Still early, so this is more of a safe pick than a hype pick.",
        pick.tonightEvent
          ? `${pick.tonightEvent.title} is on the schedule tonight${pick.tonightEvent.dj ? ` with ${pick.tonightEvent.dj}` : ""}.`
          : `Current vibe based on tonight’s context.`,
      ];

      setRecommendationVenue(pick.name);
      setRecommendationReasons(whyReasons);
      setRecommendation(recommendationText);

      if (map && pick.lng && pick.lat) {
        map.flyTo({
          center: [pick.lng, pick.lat],
          zoom: Math.max(map.getZoom(), 13.7),
          duration: 850,
        });
      }

      return recommendationText;
    } catch (error) {
      console.error("Recommendation error:", error);
      setRecommendationReasons(["The recommendation engine hit an error before it could rank venues."]);
      setRecommendation("Unable to find a recommendation right now.");
      return "";
    } finally {
      setRecommendationLoading(false);
    }
  }

  function closeRecommendationPanel() {
    setRecommendationLoading(false);
    setRecommendation("");
    setRecommendationVenue("");
    setRecommendationReasons([]);
    setRecommendationQuestion("");
  }

  async function shareSelectedVenue() {
    if (!selected || typeof window === "undefined") return;

    const shareUrl = new URL(window.location.href);
    shareUrl.searchParams.set("venue", selected.id);

    const shareTitle = `${selected.name} on Lit757`;
    const shareText = `${selected.name} on Lit757: ${statusLabel(selected.status)} right now.`;

    try {
      if (navigator.share) {
        await navigator.share({
          title: shareTitle,
          text: shareText,
          url: shareUrl.toString(),
        });
        setShareFeedback("Shared venue link.");
      } else {
        await navigator.clipboard.writeText(shareUrl.toString());
        setShareFeedback("Venue link copied.");
      }
    } catch (error) {
      console.error("Share error:", error);

      try {
        await navigator.clipboard.writeText(shareUrl.toString());
        setShareFeedback("Venue link copied.");
      } catch {
        setShareFeedback("Could not share this venue right now.");
      }
    }

    window.setTimeout(() => setShareFeedback(""), 2200);
  }

  function handleRecommendationButtonClick() {
    if (recommendation || recommendationLoading) {
      closeRecommendationPanel();
      return;
    }

    fetchRecommendation();
  }

  function speakRecommendation(text: string) {
    if (typeof window === "undefined" || !window.speechSynthesis || !text) {
      setVoiceStatus("idle");
      return;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.onstart = () => setVoiceStatus("speaking");
    utterance.onend = () => setVoiceStatus("idle");
    utterance.onerror = () => setVoiceStatus("idle");

    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }

  async function handleAskVoice() {
    setRecognitionError(null);
    setAskText("");
    setVoiceTranscript("");
    setVoiceBubbleOpen(true);

    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setVoiceStatus("idle");
      setAskModalOpen(true);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.continuous = false;

    recognition.onstart = () => {
      setRecognitionActive(true);
      setVoiceStatus("listening");
      setRecommendation("Listening for your question...");
      setRecommendationVenue("");
    };

    recognition.onresult = async (event: any) => {
      const transcript = event.results[0]?.[0]?.transcript?.trim();
      if (!transcript) {
        setRecognitionError("Could not hear that clearly. Try typing instead.");
        setRecognitionActive(false);
        setVoiceStatus("idle");
        return;
      }

      setVoiceTranscript(transcript);
      setVoiceStatus("thinking");

      try {
        const responseText = await fetchRecommendation(transcript);
        if (responseText) {
          speakRecommendation(responseText);
        } else {
          setVoiceStatus("idle");
        }
      } finally {
        setRecognitionActive(false);
      }
    };

    recognition.onerror = (event: any) => {
      console.error("Speech recognition error:", event.error);
      setRecognitionError("Speech recognition failed. Try typing your question.");
      setRecognitionActive(false);
      setVoiceStatus("idle");
      setAskModalOpen(true);
    };

    recognition.onend = () => {
      setRecognitionActive(false);
      setVoiceStatus((current) => (current === "listening" ? "idle" : current));
    };

    recognition.start();
  }

  async function handleAskTextSubmit() {
    const question = askText.trim();
    if (!question) return;

    setAskModalOpen(false);
    setVoiceBubbleOpen(true);
    setVoiceTranscript(question);
    setVoiceStatus("thinking");

    const responseText = await fetchRecommendation(question);
    if (responseText) {
      speakRecommendation(responseText);
    } else {
      setVoiceStatus("idle");
    }
  }

  async function loadVenues() {
    setVenuesLoading(true);

    const { data: venuesData, error: venuesError } = await supabase
      .from("venues")
      .select("*");

    if (venuesError) {
      console.error("Venues error:", venuesError);
      setVenuesLoading(false);
      return;
    }

    const scoreWindowStartMs = Date.now() - 6 * 60 * 60 * 1000;
    const scoreWindowEndMs = Date.now() + 12 * 60 * 60 * 1000;
    const futureWindowEndMs = Date.now() + 60 * 24 * 60 * 60 * 1000;

    const { data: eventsData, error: eventsError } = await supabase
      .from("events")
      .select("id, source_event_id, name, venue_name, start_time, end_time, source, ticket_status, source_url, created_at")
      .order("start_time", { ascending: true, nullsFirst: false })
      .limit(300);

    if (eventsError) {
      console.error("Events error details:", {
        message: eventsError.message,
        details: eventsError.details,
        hint: eventsError.hint,
        code: eventsError.code,
      });
    }

    const eventRows = ((eventsData as SupabaseEventRow[] | null | undefined) || []);

    // Events tab can show future/TBA events, but only live/tonight events should affect lit scoring.
    const upcomingEventRows = eventRows.filter((event) => {
      if (!event.start_time) return true;
      const startMs = new Date(event.start_time).getTime();
      return Number.isNaN(startMs) || (startMs >= scoreWindowStartMs && startMs <= futureWindowEndMs);
    });

    const scoringEventRows = eventRows.filter((event) => {
      if (!event.start_time) return false;
      const startMs = new Date(event.start_time).getTime();
      return !Number.isNaN(startMs) && startMs >= scoreWindowStartMs && startMs <= scoreWindowEndMs;
    });

    setUpcomingEvents(
      dedupeEvents(
        upcomingEventRows
          .map((event) => normalizeEventForUi(event))
          .filter(Boolean)
      )
    );

    const since = new Date(Date.now() - 90 * 60 * 1000).toISOString();

    const { data: votesData, error: votesError } = await supabase
      .from("votes")
      .select("*")
      .gte("created_at", since);

    if (votesError) console.error("Votes error:", votesError);

    const { data: updatesData, error: updatesError } = await supabase
      .from("suggested_updates")
      .select("*")
      .gte("created_at", since);

    if (updatesError) console.error("Suggested updates error:", updatesError);

    const { data: liveReportsData, error: liveReportsError } = await supabase
      .from("venue_live_reports")
      .select("*")
      .gte("created_at", since);

    if (liveReportsError) console.error("Updates error:", liveReportsError);

    const { data: intelligenceData, error: intelligenceError } = await supabase
      .from("venue_intelligence")
      .select("*");

    if (intelligenceError) {
      console.error("Venue intelligence error:", intelligenceError);
      console.warn("Local signal is not visible to the frontend. Check RLS SELECT policy on venue_intelligence.");
    }

    const intelligenceByVenueId = new Map(
      (intelligenceData || []).map((intel) => [intel.venue_id, intel])
    );

    const enriched =
      venuesData?.map((venue) => {
        const venueVotes =
          votesData?.filter((vote) => vote.venue_id === venue.id) || [];

        const updateMatches =
          updatesData?.filter(
            (update) =>
              update.venue_id === venue.id ||
              (!update.venue_id && update.venue_name === venue.name)
          ) || [];

        const liveReports =
          liveReportsData?.filter((report) => report.venue_id === venue.id) || [];

        const liveReportCount = liveReports.length;
        const liveReportScore = getLiveReportScore(liveReports);
        const reportSummary = getDominantReportSummary(liveReports);

        const updateCount = updateMatches.length;

        const updateScore = updateMatches.reduce(
          (sum, update) => sum + getUpdateScore(update),
          0
        );

        const voteCount = venueVotes.length;

        const sortedVotes = [...venueVotes].sort(
          (a, b) =>
            new Date(b.created_at).getTime() -
            new Date(a.created_at).getTime()
        );

        const sortedUpdates = [...updateMatches].sort(
          (a, b) =>
            new Date(b.created_at).getTime() -
            new Date(a.created_at).getTime()
        );

        const sortedLiveReports = [...liveReports].sort(
          (a, b) =>
            new Date(b.created_at).getTime() -
            new Date(a.created_at).getTime()
        );

        const upcomingEventsForVenue = dedupeEvents(
          upcomingEventRows
            .filter((event) => eventMatchesVenue(event, venue))
            .map((event) => normalizeEventForUi(event))
            .filter(Boolean)
        );

        const matchedEvents = scoringEventRows
          .filter((event) => eventMatchesVenue(event, venue))
          .sort((a, b) => {
            const aNormalized = normalizeEventForUi(a);
            const bNormalized = normalizeEventForUi(b);
            const aScore =
              eventVenueMatchScore(a, venue) * 100 +
              getEventTimingBoost(aNormalized) +
              getTicketDemandBoost(a.ticket_status);
            const bScore =
              eventVenueMatchScore(b, venue) * 100 +
              getEventTimingBoost(bNormalized) +
              getTicketDemandBoost(b.ticket_status);

            return bScore - aScore;
          });

        const rawTonightEvent = matchedEvents[0] || null;
        const tonightEvent = normalizeEventForUi(rawTonightEvent);

        const vibeEngine = calculateVenueVibe({
          venueVotes,
          updateMatches,
          tonightEvent,
        });

        const intel = intelligenceByVenueId.get(venue.id) as any;
        const aiScore = typeof intel?.lit_score === "number" ? intel.lit_score : 0;
        const hasGhostData = !!intel && aiScore > 0;
        const behaviorCategory = getBehaviorCategory({ ...venue, tonightEvent });
        const hasLiveSignals = voteCount + updateCount + liveReportCount > 0 || !!tonightEvent;

        // Local signal System merge:
        // - If users/events exist, real signals dominate.
        // - If no users/events exist yet, AI keeps the venue useful instead of dead/empty.
        const liveAdjustedScore = clampScore(vibeEngine.finalScore + liveReportScore);

        const finalScore = clampScore(
          hasLiveSignals
            ? liveAdjustedScore * 0.72 + aiScore * 0.28
            : hasGhostData
            ? aiScore
            : vibeEngine.finalScore
        );

        const finalStatus = scoreToVenueStatus(finalScore);
        const finalTrend = hasLiveSignals
          ? vibeEngine.vibeTrend
          : scoreToVibeTrend(finalScore, hasLiveSignals);
        const finalEnergyLevel = hasLiveSignals
          ? vibeEngine.energyLevel
          : scoreToEnergyLevel(finalScore);
        const trendingScore = hasLiveSignals
          ? Math.round(vibeEngine.trendingScore + liveReportCount * 9 + Math.max(0, liveReportScore) * 0.35 + aiScore * 0.2)
          : hasGhostData
          ? Math.round(aiScore)
          : vibeEngine.trendingScore;
        const momentumLabel = hasLiveSignals
          ? vibeEngine.momentumLabel
          : finalTrend === "heating"
          ? "Looks hot"
          : finalTrend === "steady"
          ? "Steady read"
          : "Watching";

        return {
          ...venue,
          score: finalScore,
          voteCount,
          updateCount,
          trendingScore,
          momentumLabel,
          vibeScore: finalScore,
          vibeTier: finalStatus,
          vibeTrend: finalTrend,
          vibeReason: liveReportCount > 0
            ? `${reportSummary}.`
            : hasLiveSignals
            ? vibeEngine.vibeReason
            : intel?.summary || "This spot is on the radar for tonight.",
          confidence:
            voteCount + updateCount + liveReportCount >= 5
              ? "high"
              : voteCount + updateCount + liveReportCount >= 2 || String(intel?.confidence || "").toLowerCase() === "medium"
              ? "medium"
              : hasGhostData
              ? "low"
              : "low",
          status: finalStatus,
          energyLevel: finalEnergyLevel,
          aiScore,
          aiStatus: intel?.status || null,
          aiConfidence: intel?.confidence || null,
          aiSummary: intel?.summary || null,
          aiSignals: intel?.signals_json || null,
          hasGhostData,
          liveReportCount,
          liveReportScore,
          reportSummary,
          behaviorCategory,
          lastUpdated:
            sortedVotes[0]?.created_at || sortedUpdates[0]?.created_at || sortedLiveReports[0]?.created_at || intel?.updated_at || null,
          upcomingEvents: upcomingEventsForVenue,
          hasUpcomingEvent: upcomingEventsForVenue.length > 0,
          tonightEvent,
        };
      }) || [];

    setVenues(enriched);

    if (selectedRef.current) {
      const refreshedSelected = enriched.find(
        (venue) => venue.id === selectedRef.current?.id
      );
      if (refreshedSelected) {
        setSelected(refreshedSelected);
      }
    }

    setVenuesLoading(false);
  }

  useEffect(() => {
    loadVenues();
  }, []);

  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (selected || venues.length === 0) return;

    const venueId = new URLSearchParams(window.location.search).get("venue");
    if (!venueId) return;

    const sharedVenue = venues.find((venue) => venue.id === venueId);
    if (!sharedVenue) return;

    setSelected(sharedVenue);
    setSheetExpanded(true);
    setViewMode("map");

    if (map && sharedVenue.lng && sharedVenue.lat) {
      map.flyTo({
        center: [sharedVenue.lng, sharedVenue.lat],
        zoom: Math.max(map.getZoom(), 14),
        duration: 850,
      });
    }
  }, [venues, map, selected]);

  useEffect(() => {
    if (refreshIntervalRef.current) {
      window.clearInterval(refreshIntervalRef.current);
    }

    refreshIntervalRef.current = window.setInterval(() => {
      loadVenues();
    }, 20000);

    return () => {
      if (refreshIntervalRef.current) {
        window.clearInterval(refreshIntervalRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!mapContainerRef.current) return;

    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

    if (!token) {
      console.error("Missing Mapbox token");
      return;
    }

    mapboxgl.accessToken = token;

    const newMap = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: MAPBOX_STYLES[mapMode],
      center: [-76.2859, 36.8508],
      zoom: 10.8,
    });

    newMap.on("load", () => {
      newMap.resize();

      if (!newMap.getSource("venue-heat")) {
        newMap.addSource("venue-heat", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: [],
          },
        });
      }

      const sourceExists = !!newMap.getSource("venue-heat");
      console.log("heatmap load: source exists", sourceExists);

      const firstSymbol = newMap
        .getStyle()
        .layers?.find((layer) => layer.type === "symbol")?.id;

      if (!newMap.getLayer("venue-heat-layer")) {
        newMap.addLayer(
          {
            id: "venue-heat-layer",
            type: "heatmap",
            source: "venue-heat",
            maxzoom: 18,
            paint: {
              "heatmap-weight": [
                "interpolate",
                ["linear"],
                ["get", "weight"],
                1,
                0.4,
                2,
                0.9,
                4,
                1.4,
                8,
                1.9,
                16,
                2.5,
              ],
              "heatmap-intensity": [
                "interpolate",
                ["linear"],
                ["zoom"],
                7,
                1.4,
                11,
                2.1,
                15,
                2.8,
              ],
              "heatmap-color": [
                "interpolate",
                ["linear"],
                ["heatmap-density"],
                0,
                "rgba(0,0,0,0)",
                0.1,
                "rgba(252,211,77,0.3)",
                0.25,
                "rgba(251,146,60,0.5)",
                0.4,
                "rgba(249,115,22,0.65)",
                0.6,
                "rgba(239,68,68,0.8)",
                0.8,
                "rgba(220,38,38,0.9)",
                1,
                "rgba(185,28,28,0.95)",
              ],
              "heatmap-radius": [
                "interpolate",
                ["linear"],
                ["zoom"],
                7,
                20,
                10,
                35,
                13,
                50,
                16,
                65,
              ],
              "heatmap-opacity": [
                "interpolate",
                ["linear"],
                ["zoom"],
                7,
                0.45,
                11,
                0.6,
                15,
                0.72,
              ],
            },
          },
          firstSymbol
        );
      }

      if (!newMap.getSource("venue-points")) {
        newMap.addSource("venue-points", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: [],
          },
        });
      }

      const activeExpression: any = [">", ["get", "activeScore"], 0];
      const surgingExpression: any = ["==", ["get", "isSurging"], true];
      const heatingExpression: any = ["==", ["get", "isHeating"], true];
      const coolingExpression: any = ["==", ["get", "isCooling"], true];
      const aiWatchingExpression: any = ["==", ["get", "isAiWatching"], true];
      const upcomingEventExpression: any = ["==", ["get", "hasUpcomingEvent"], true];
      const hotColorExpression: any = [
        "case",
        surgingExpression,
        "#ef4444", // confirmed packed / live hot
        heatingExpression,
        "#fb923c", // confirmed active
        coolingExpression,
        "#60a5fa", // confirmed cooling
        aiWatchingExpression,
        "#facc15", // Watching only, no fake heat
        upcomingEventExpression,
        "#38bdf8", // upcoming event venue, not live heat
        "#6b7280", // quiet / monitored
      ];


      const spotlightExpression: any = ["==", ["get", "isSpotlight"], true];
      const topMoveExpression: any = ["==", ["get", "isTopMove"], true];
      const topMoveOneExpression: any = ["==", ["get", "isTopMoveOne"], true];
      const liveTargetExpression: any = ["any", spotlightExpression, topMoveOneExpression];

      if (!newMap.getLayer("venue-pins-activity-spotlight")) {
        newMap.addLayer({
          id: "venue-pins-activity-spotlight",
          type: "circle",
          source: "venue-points",
          paint: {
            "circle-radius": [
              "interpolate",
              ["linear"],
              ["zoom"],
              8,
              ["case", spotlightExpression, 34, 0],
              11,
              ["case", spotlightExpression, 52, 0],
              14,
              ["case", spotlightExpression, 82, 0]
            ],
            "circle-color": "#fb923c",
            "circle-blur": 0.74,
            "circle-opacity": ["case", spotlightExpression, 0.68, 0]
          }
        });
      }

      if (!newMap.getLayer("venue-pins-activity-ring")) {
        newMap.addLayer({
          id: "venue-pins-activity-ring",
          type: "circle",
          source: "venue-points",
          paint: {
            "circle-radius": [
              "interpolate",
              ["linear"],
              ["zoom"],
              8,
              ["case", spotlightExpression, 14, 0],
              11,
              ["case", spotlightExpression, 24, 0],
              14,
              ["case", spotlightExpression, 38, 0]
            ],
            "circle-color": "rgba(0,0,0,0)",
            "circle-stroke-color": "#fff7ed",
            "circle-stroke-width": ["case", spotlightExpression, 3.5, 0],
            "circle-stroke-opacity": ["case", spotlightExpression, 0.95, 0]
          }
        });
      }

      if (!newMap.getLayer("venue-pins-live-radar-wave")) {
        newMap.addLayer({
          id: "venue-pins-live-radar-wave",
          type: "circle",
          source: "venue-points",
          paint: {
            "circle-radius": [
              "interpolate",
              ["linear"],
              ["zoom"],
              8,
              ["case", liveTargetExpression, 42, topMoveExpression, 22, surgingExpression, 28, 0],
              11,
              ["case", liveTargetExpression, 70, topMoveExpression, 36, surgingExpression, 48, 0],
              14,
              ["case", liveTargetExpression, 108, topMoveExpression, 58, surgingExpression, 72, 0]
            ],
            "circle-color": [
              "case",
              spotlightExpression,
              "#fb923c",
              topMoveOneExpression,
              "#ff3b30",
              topMoveExpression,
              "#facc15",
              hotColorExpression
            ],
            "circle-blur": ["case", liveTargetExpression, 0.86, 0.92],
            "circle-opacity": [
              "interpolate",
              ["linear"],
              ["zoom"],
              8,
              ["case", liveTargetExpression, 0.34, topMoveExpression, 0.16, surgingExpression, 0.18, 0],
              12,
              ["case", liveTargetExpression, 0.46, topMoveExpression, 0.22, surgingExpression, 0.26, 0],
              15,
              ["case", liveTargetExpression, 0.56, topMoveExpression, 0.28, surgingExpression, 0.34, 0]
            ]
          }
        });
      }

      if (!newMap.getLayer("venue-pins-mega-halo")) {
        newMap.addLayer({
          id: "venue-pins-mega-halo",
          type: "circle",
          source: "venue-points",
          paint: {
            "circle-radius": [
              "interpolate",
              ["linear"],
              ["zoom"],
              8,
              ["case", liveTargetExpression, 34, topMoveExpression, 26, surgingExpression, 24, heatingExpression, 16, activeExpression, 10, 0],
              11,
              ["case", liveTargetExpression, 54, topMoveExpression, 42, surgingExpression, 38, heatingExpression, 26, activeExpression, 16, 0],
              14,
              ["case", liveTargetExpression, 86, topMoveExpression, 68, surgingExpression, 62, heatingExpression, 44, activeExpression, 26, 0],
            ],
            "circle-color": hotColorExpression,
            "circle-blur": ["case", surgingExpression, 0.9, 0.82],
            "circle-opacity": [
              "interpolate",
              ["linear"],
              ["zoom"],
              8,
              ["case", liveTargetExpression, 0.44, topMoveExpression, 0.34, surgingExpression, 0.3, heatingExpression, 0.18, activeExpression, 0.08, 0],
              12,
              ["case", liveTargetExpression, 0.58, topMoveExpression, 0.46, surgingExpression, 0.42, heatingExpression, 0.27, activeExpression, 0.12, 0],
              15,
              ["case", liveTargetExpression, 0.68, topMoveExpression, 0.54, surgingExpression, 0.52, heatingExpression, 0.34, activeExpression, 0.16, 0],
            ],
          },
        });
      }

      if (!newMap.getLayer("venue-pins-ring")) {
        newMap.addLayer({
          id: "venue-pins-ring",
          type: "circle",
          source: "venue-points",
          paint: {
            "circle-radius": [
              "interpolate",
              ["linear"],
              ["zoom"],
              9,
              ["case", liveTargetExpression, 14, topMoveExpression, 11, surgingExpression, 9, heatingExpression, 7, activeExpression, 5, 0],
              12,
              ["case", liveTargetExpression, 24, topMoveExpression, 19, surgingExpression, 16, heatingExpression, 12, activeExpression, 8, 0],
              15,
              ["case", liveTargetExpression, 36, topMoveExpression, 30, surgingExpression, 24, heatingExpression, 18, activeExpression, 12, 0],
            ],
            "circle-color": "rgba(0,0,0,0)",
            "circle-stroke-color": hotColorExpression,
            "circle-stroke-width": ["case", liveTargetExpression, 4, topMoveExpression, 3.2, surgingExpression, 3, heatingExpression, 2.2, activeExpression, 1.2, 0],
            "circle-stroke-opacity": ["case", surgingExpression, 0.95, heatingExpression, 0.72, activeExpression, 0.35, 0],
          },
        });
      }

      if (!newMap.getLayer("venue-pins-glow")) {
        newMap.addLayer({
          id: "venue-pins-glow",
          type: "circle",
          source: "venue-points",
          paint: {
            "circle-radius": [
              "interpolate",
              ["linear"],
              ["zoom"],
              8,
              ["case", liveTargetExpression, 26, topMoveExpression, 22, surgingExpression, 18, heatingExpression, 14, activeExpression, 10, 3],
              10,
              ["case", liveTargetExpression, 38, topMoveExpression, 32, surgingExpression, 26, heatingExpression, 20, activeExpression, 15, 5],
              12,
              ["case", liveTargetExpression, 54, topMoveExpression, 44, surgingExpression, 36, heatingExpression, 28, activeExpression, 22, 7],
              15,
              ["case", liveTargetExpression, 72, topMoveExpression, 60, surgingExpression, 50, heatingExpression, 38, activeExpression, 32, 10],
            ],
            "circle-color": hotColorExpression,
            "circle-blur": ["case", surgingExpression, 0.65, activeExpression, 0.78, 0.95],
            "circle-opacity": [
              "interpolate",
              ["linear"],
              ["zoom"],
              8,
              ["case", activeExpression, 0.28, 0.05],
              10,
              ["case", activeExpression, 0.38, 0.1],
              12,
              ["case", activeExpression, 0.48, 0.14],
              15,
              ["case", activeExpression, 0.58, 0.18],
            ],
          },
        });
      }

      if (!newMap.getLayer("venue-pins-core")) {
        newMap.addLayer({
          id: "venue-pins-core",
          type: "circle",
          source: "venue-points",
          paint: {
            "circle-radius": [
              "interpolate",
              ["linear"],
              ["zoom"],
              8,
              ["case", liveTargetExpression, 8, topMoveExpression, 7, surgingExpression, 6, heatingExpression, 5, activeExpression, 4, 2.2],
              10,
              ["case", liveTargetExpression, 12, topMoveExpression, 10, surgingExpression, 9, heatingExpression, 7, activeExpression, 6, 3.2],
              12,
              ["case", liveTargetExpression, 17, topMoveExpression, 15, surgingExpression, 13, heatingExpression, 10, activeExpression, 8, 4.2],
              15,
              ["case", liveTargetExpression, 24, topMoveExpression, 21, surgingExpression, 18, heatingExpression, 14, activeExpression, ["case", [">=", ["get", "activeScore"], 8], 12, 10], 4.5],
            ],
            "circle-color": hotColorExpression,
            "circle-opacity": [
              "interpolate",
              ["linear"],
              ["zoom"],
              8,
              ["case", activeExpression, 1, aiWatchingExpression, 0.95, 0.45],
              10,
              ["case", activeExpression, 1, aiWatchingExpression, 0.95, 0.52],
              12,
              ["case", activeExpression, 1, aiWatchingExpression, 0.95, 0.6],
              15,
              ["case", activeExpression, 1, aiWatchingExpression, 0.95, 0.68],
            ],
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": [
              "interpolate",
              ["linear"],
              ["zoom"],
              8,
              ["case", activeExpression, 1, 0.35],
              12,
              ["case", activeExpression, 2, 0.6],
              15,
              ["case", activeExpression, 2.5, 0.85],
            ],
            "circle-stroke-opacity": ["case", activeExpression, 0.9, 0.25],
          },
        });
      }

      newMap.on("click", "venue-pins-core", (event) => {
        const feature = event.features?.[0];
        const venueId = feature?.properties?.id;
        const venue = filteredVenuesRef.current.find((item) => item.id === venueId);

        if (!venue) return;

        setSelected(venue);
        setSheetExpanded(true);
        setViewMode("map");

        newMap.flyTo({
          center: [venue.lng, venue.lat],
          zoom: Math.max(newMap.getZoom(), 14),
        });
      });

      newMap.on("mouseenter", "venue-pins-core", () => {
        newMap.getCanvas().style.cursor = "pointer";
      });

      newMap.on("mouseleave", "venue-pins-core", () => {
        newMap.getCanvas().style.cursor = "";
      });

      const pointSource = newMap.getSource("venue-points") as mapboxgl.GeoJSONSource | null;
      pointSource?.setData(buildVenuePointsGeoJSON(filteredVenuesRef.current, activePulseVenueId));

      const heatSource = newMap.getSource("venue-heat") as mapboxgl.GeoJSONSource | null;
      heatSource?.setData(buildVenueHeatmapGeoJSON(filteredVenuesRef.current) as GeoJSON.FeatureCollection);

      const layerExists = !!newMap.getLayer("venue-heat-layer");
      console.log("heatmap load: layer exists", layerExists, "firstSymbol", firstSymbol);

      newMap.setLayoutProperty(
        "venue-heat-layer",
        "visibility",
        heatmapEnabled ? "visible" : "none"
      );

      const initialZoom = newMap.getZoom();
      setCurrentZoom(Math.round(initialZoom * 10) / 10);

      const handleZoomEnd = () => {
        const zoom = newMap.getZoom();
        setCurrentZoom(Math.round(zoom * 10) / 10);
      };

      const handleMoveEnd = () => {
        const zoom = newMap.getZoom();
        setCurrentZoom(Math.round(zoom * 10) / 10);
      };

      newMap.on("zoomend", handleZoomEnd);
      newMap.on("moveend", handleMoveEnd);

      return () => {
        newMap.off("zoomend", handleZoomEnd);
        newMap.off("moveend", handleMoveEnd);
      };
    });

    setMap(newMap);

    return () => {
      newMap.remove();
    };
  }, []);

  async function loadRecentUpdates() {
    if (!selected) {
      console.log("Recent updates: no selected venue");
      setRecentUpdates([]);
      return;
    }

    console.log("Recent updates: fetching for selected.id", selected.id, "selected.name", selected.name);

    let { data, error } = await supabase
      .from("suggested_updates")
      .select("*")
      .eq("venue_id", selected.id)
      .order("created_at", { ascending: false })
      .limit(5);

    if (error) {
      console.error("Recent updates error (venue_id):", error);
      setRecentUpdates([]);
      return;
    }

    if ((!data || data.length === 0) && selected.name) {
      console.log("Recent updates: venue_id returned no rows, falling back to venue_name", selected.name);
      const fallback = await supabase
        .from("suggested_updates")
        .select("*")
        .eq("venue_name", selected.name)
        .order("created_at", { ascending: false })
        .limit(5);

      if (fallback.error) {
        console.error("Recent updates error (venue_name fallback):", fallback.error);
        setRecentUpdates([]);
        return;
      }

      data = fallback.data;
    }

    console.log("Recent updates fetched:", data);
    setRecentUpdates(data || []);
  }

  function spotlightActivityVenue(venueId?: string | null) {
    if (!venueId) return;

    setActivePulseVenueId(venueId);

    if (activePulseTimeoutRef.current) {
      window.clearTimeout(activePulseTimeoutRef.current);
    }

    activePulseTimeoutRef.current = window.setTimeout(() => {
      setActivePulseVenueId(null);
      activePulseTimeoutRef.current = null;
    }, 7000);
  }

  function dismissActivityToast(toastId: string) {
    setActivityToasts((current) => current.filter((toast) => toast.id !== toastId));
  }

  function showActivityToast(item: CityPulseItem | ActivityToast) {
    const venueName = "venueName" in item
      ? item.venueName
      : item.venue_name || "a spot nearby";
    const updateType = "update_type" in item ? item.update_type : null;
    const rawMessage = item.message;
    const icon = "icon" in item ? item.icon : updateTypeIcon(updateType || undefined);
    const title = "title" in item
      ? item.title
      : `New activity at ${venueName}`;
    const message = rawMessage?.trim()
      ? rawMessage.trim()
      : updateType
      ? `${updateType} just came in.`
      : "Someone just added a vibe.";

    const nextToast: ActivityToast = {
      id: item.id,
      venueId: "venueId" in item ? item.venueId : (item as CityPulseItem).venue_id,
      venueName,
      title,
      message,
      icon,
      createdAt: "createdAt" in item ? item.createdAt : (item as CityPulseItem).created_at,
    };

    spotlightActivityVenue(nextToast.venueId);

    setActivityToasts((current) => {
      const withoutDuplicate = current.filter((toast) => toast.id !== nextToast.id);
      return [nextToast, ...withoutDuplicate].slice(0, 3);
    });

    window.setTimeout(() => {
      dismissActivityToast(nextToast.id);
    }, 6500);
  }

  function openToastVenue(toast: ActivityToast) {
    const venue = venues.find((item) => item.id === toast.venueId || item.name === toast.venueName);

    if (venue) {
      setSelected(venue);
      setSheetExpanded(true);
      setViewMode("map");
      spotlightActivityVenue(venue.id);

      if (map && venue.lng && venue.lat) {
        map.flyTo({
          center: [venue.lng, venue.lat],
          zoom: Math.max(map.getZoom(), 14),
          duration: 850,
        });
      }
    }

    dismissActivityToast(toast.id);
  }

  async function loadCityFeed() {
    const { data, error } = await supabase
      .from("suggested_updates")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(12);

    if (error) {
      console.error("City feed error:", error);
      return;
    }

    const nextFeed = data || [];

    if (!activityFeedPrimedRef.current) {
      nextFeed.forEach((item) => seenActivityIdsRef.current.add(item.id));
      activityFeedPrimedRef.current = true;
    } else {
      const newItems = nextFeed.filter((item) => !seenActivityIdsRef.current.has(item.id));

      if (newItems.length > 0) {
        showActivityToast(newItems[0]);
      }

      nextFeed.forEach((item) => seenActivityIdsRef.current.add(item.id));
    }

    setCityFeed(nextFeed);
  }

  useEffect(() => {
    loadCityFeed();

    const interval = window.setInterval(() => {
      loadCityFeed();
    }, 15000);

    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) {
        window.clearTimeout(toastTimeoutRef.current);
      }
      if (activePulseTimeoutRef.current) {
        window.clearTimeout(activePulseTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    let ignore = false;

    async function loadUpdates() {
      if (ignore) return;
      await loadRecentUpdates();
    }

    loadUpdates();

    return () => {
      ignore = true;
    };
  }, [selected]);

  const filteredVenues = useMemo(() => {
    let results = venues;

    if (city !== "All 757") {
      results = results.filter((venue) => venue.city === city);
    }

    if (activeChip !== "All" && activeChip !== "Events") {
      const activeChipConfig = CHIP_CONFIGS.find((chip) => chip.label === activeChip);
      const activeTerms = activeChipConfig?.terms || [activeChip];

      results = results.filter((venue) => {
        const searchable = [
          venue.name,
          venue.city,
          venue.address,
          venue.type,
          venue.category,
          venue.music_genre,
          venue.age_limit,
          venue.cover,
          venue.parking,
          venue.dress_code,
          venue.status,
          venue.tonightEvent?.title,
          venue.tonightEvent?.genre,
          venue.tonightEvent?.dj,
          venue.tonightEvent?.cover_price,
          venue.tonightEvent?.dress_code,
          venue.tonightEvent?.description,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        const categoryMatch = venue.category === activeChip || venue.type === activeChip;
        const termMatch = activeTerms.some((term) => searchable.includes(term.toLowerCase()));
        const cheapMatch = activeChip === "Cheap Eats" && /free|cheap|no cover|low cover|\$0/.test(searchable);
        const ageMatch = (activeChip === "21+" || activeChip === "18+") && searchable.includes(activeChip.toLowerCase());

        return categoryMatch || termMatch || cheapMatch || ageMatch;
      });
    }

    if (query.trim()) {
      const q = query.toLowerCase();

      results = results.filter((venue) => {
        const searchable = [
          venue.name,
          venue.city,
          venue.address,
          venue.type,
          venue.category,
          venue.music_genre,
          venue.age_limit,
          venue.cover,
          venue.parking,
          venue.dress_code,
          venue.status,
          venue.tonightEvent?.title,
          venue.tonightEvent?.genre,
          venue.tonightEvent?.dj,
          venue.tonightEvent?.cover_price,
          venue.tonightEvent?.dress_code,
          venue.tonightEvent?.description,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        return searchable.includes(q);
      });
    }

    return results;
  }, [venues, city, activeChip, query]);

  useEffect(() => {
    filteredVenuesRef.current = filteredVenues;
  }, [filteredVenues]);

  useEffect(() => {
    if (!map) return;

    const source = map.getSource("venue-points") as mapboxgl.GeoJSONSource | null;
    if (!source) {
      console.log("venue points update: source missing");
      return;
    }

    source.setData(buildVenuePointsGeoJSON(filteredVenues, activePulseVenueId));
  }, [map, filteredVenues, activePulseVenueId]);

  useEffect(() => {
    if (!map) return;

    const source = map.getSource("venue-heat") as mapboxgl.GeoJSONSource | null;
    if (!source) {
      console.log("heatmap update: source missing");
      return;
    }

    const data = buildVenueHeatmapGeoJSON(filteredVenues);
    console.log("heatmap update: updating source", data.features.length);
    source.setData(data as GeoJSON.FeatureCollection);
  }, [map, filteredVenues, activePulseVenueId]);

  useEffect(() => {
    if (!map) return;
    if (!map.getLayer("venue-heat-layer")) {
      console.log("heatmap toggle: layer missing");
      return;
    }

    console.log("heatmap toggle: visibility", heatmapEnabled ? "visible" : "none");
    map.setLayoutProperty(
      "venue-heat-layer",
      "visibility",
      heatmapEnabled ? "visible" : "none"
    );
  }, [map, heatmapEnabled]);

  async function vote(vibe: Vibe) {
    if (!selected) return;

    const deviceId = getDeviceId();

    if (!deviceId) {
      console.error("No device ID found");
      return;
    }

    const since = new Date(Date.now() - 90 * 60 * 1000).toISOString();

    const { data: existingVote, error: findError } = await supabase
      .from("votes")
      .select("*")
      .eq("venue_id", selected.id)
      .eq("device_id", deviceId)
      .gte("created_at", since)
      .maybeSingle();

    if (findError) {
      console.error("Find vote error:", findError);
      return;
    }

    if (existingVote) {
      const { error: updateError } = await supabase
        .from("votes")
        .update({
          vibe,
          created_at: new Date().toISOString(),
        })
        .eq("id", existingVote.id);

      if (updateError) {
        console.error("Update vote error:", updateError);
        return;
      }
    } else {
      const { error: insertError } = await supabase.from("votes").insert({
        venue_id: selected.id,
        vibe,
        device_id: deviceId,
      });

      if (insertError) {
        console.error("Vote error:", insertError);
        return;
      }
    }

    await loadVenues();

    setSelected((prev) =>
      prev
        ? {
            ...prev,
            lastUpdated: new Date().toISOString(),
            voteCount: (prev.voteCount || 0) + 1,
          }
        : prev
    );

    showActivityToast({
      id: `vote-${selected.id}-${Date.now()}`,
      venueId: selected.id,
      venueName: selected.name,
      title: vibe === "lit" ? `${selected.name} just got a Buzzing check-in` : vibe === "dead" ? `${selected.name} got a Quiet check-in` : `${selected.name} got a comment`,
      message: vibe === "lit" ? "Someone nearby says this spot has energy right now." : vibe === "dead" ? "Someone nearby says it is quiet right now." : "Someone nearby says this spot has a decent crowd right now.",
      icon: "",
      createdAt: new Date().toISOString(),
    });

    if ("vibrate" in navigator) navigator.vibrate(40);
  }


  function mapLiveReportOptionToVenueSignal(option: LiveReportOption) {
    const value = String(option.value || "").toLowerCase();
    const type = String(option.type || "").toLowerCase();

    if (["packed"].includes(value)) return "packed";
    if (["great_crowd", "decent", "busy"].includes(value)) return "good";
    if (["dead", "no_wait"].includes(value)) return "quiet";
    if (["line_crazy", "long_wait"].includes(value) || type.includes("line") || type.includes("wait")) return "line";
    if (["selling_fast"].includes(value) || type.includes("tickets")) return "active";
    if (type.includes("music")) return "music";
    if (type.includes("cover")) return "cover";

    return "active";
  }

  function applyOptimisticVenueSignal(option: LiveReportOption) {
    if (!selected) return;

    const scoreDelta = Math.max(4, Math.round(liveReportValueScore(option.value) * 0.35));
    const nextScore = clampScore((selected.vibeScore || selected.score || selected.aiScore || 30) + scoreDelta);
    const nextStatus = scoreToVenueStatus(nextScore);
    const nextEnergyLevel = scoreToEnergyLevel(nextScore);
    const nextTrend = scoreToVibeTrend(nextScore, true);
    const nowIso = new Date().toISOString();

    const patchVenue = (venue: VenueWithEvent): VenueWithEvent => {
      if (venue.id !== selected.id) return venue;

      return {
        ...venue,
        status: nextStatus,
        vibeScore: nextScore,
        score: nextScore,
        aiScore: Math.max(venue.aiScore || 0, nextScore),
        aiStatus: nextStatus === "lit" ? "Buzzing" : nextStatus === "decent" ? "Picking up" : "Quiet",
        aiSummary:
          option.value === "dead"
            ? "Quiet right now, but that can change later."
            : option.value === "line_crazy" || option.value === "long_wait"
            ? "People are seeing movement here right now."
            : "People are starting to show movement here.",
        vibeTrend: nextTrend,
        energyLevel: nextEnergyLevel,
        liveReportCount: (venue.liveReportCount || 0) + 1,
        liveReportScore: (venue.liveReportScore || 0) + liveReportValueScore(option.value),
        lastUpdated: nowIso,
      };
    };

    setVenues((prev) => prev.map(patchVenue));
    setSelected((prev) => (prev ? patchVenue(prev) : prev));
  }

  async function submitVenueSignal(option: LiveReportOption) {
    if (!selected) return;

    try {
      const vibeType = mapLiveReportOptionToVenueSignal(option);

      const response = await fetch("/api/submit-venue-signal", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          venue_id: selected.id,
          vibe_type: vibeType,
          comment: option.label,
          nickname: null,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data?.success) {
        console.error("Venue signal failed:", data?.error || response.statusText);
      }
    } catch (error) {
      console.error("Venue signal error:", error);
    }
  }

  async function submitLiveReport(option: LiveReportOption) {
    if (!selected || liveReportLoading) return;

    const deviceId = getDeviceId();
    setLiveReportLoading(true);
    setLiveReportFeedback("");

    try {
      const response = await fetch("/api/live-report", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          venue_id: selected.id,
          report_type: option.type,
          report_value: option.value,
          venue_category: selected.behaviorCategory || getBehaviorCategory(selected),
          device_id: deviceId,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || "Update failed");
      }

      applyOptimisticVenueSignal(option);
      await submitVenueSignal(option);

      setLiveReportFeedback(`${option.label} added`);
      window.setTimeout(() => {
        loadVenues().catch((error) => console.error("Venue refresh after signal failed:", error));
      }, 450);

      showActivityToast({
        id: `live-report-${selected.id}-${Date.now()}`,
        venueId: selected.id,
        venueName: selected.name,
        title: `${selected.name} got an update`,
        message: `${option.label} was reported just now.`,
        icon: "",
        createdAt: new Date().toISOString(),
      });

      if ("vibrate" in navigator) navigator.vibrate(35);
      window.setTimeout(() => setLiveReportFeedback(""), 2200);
    } catch (error) {
      console.error("Update error:", error);
      setLiveReportFeedback("Could not add that. Try again.");
    } finally {
      setLiveReportLoading(false);
    }
  }

  async function uploadSuggestionMedia() {
    if (!suggestionMediaFile || !selected) {
      return { mediaUrl: null as string | null, mediaType: null as string | null };
    }

    const isVideo = suggestionMediaFile.type.startsWith("video/");
    const isImage = suggestionMediaFile.type.startsWith("image/");

    if (!isVideo && !isImage) {
      throw new Error("Only images and videos are supported.");
    }

    const maxSize = isVideo ? 25 * 1024 * 1024 : 8 * 1024 * 1024;
    if (suggestionMediaFile.size > maxSize) {
      throw new Error(isVideo ? "Video must be under 25MB." : "Image must be under 8MB.");
    }

    const extension = suggestionMediaFile.name.split(".").pop() || (isVideo ? "mp4" : "jpg");
    const safeVenueName = selected.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    const path = `${selected.id}/${Date.now()}-${safeVenueName}.${extension}`;

    const { error: uploadError } = await supabase.storage
      .from("update-media")
      .upload(path, suggestionMediaFile, {
        cacheControl: "3600",
        upsert: false,
        contentType: suggestionMediaFile.type,
      });

    if (uploadError) throw uploadError;

    const { data } = supabase.storage.from("update-media").getPublicUrl(path);

    return {
      mediaUrl: data.publicUrl,
      mediaType: isVideo ? "video" : "image",
    };
  }

  async function submitSuggestion() {
    if (!selected) return;

    setSuggestionLoading(true);
    setSuggestionStatus(null);
    setSuggestionFeedback("");

    try {
      const { mediaUrl, mediaType } = await uploadSuggestionMedia();

      const { error } = await supabase.from("suggested_updates").insert({
        venue_id: selected.id || null,
        venue_name: selected.name,
        update_type: suggestionType,
        message: suggestionMessage.trim(),
        media_url: mediaUrl,
        media_type: mediaType,
      });

      if (error) throw error;

      await loadRecentUpdates();
      await loadVenues();
      setSelected((prev) =>
        prev
          ? {
              ...prev,
              updateCount: (prev.updateCount || 0) + 1,
            }
          : prev
      );

      showActivityToast({
        id: `update-${selected.id}-${Date.now()}`,
        venueId: selected.id,
        venueName: selected.name,
        title: `${updateTypeIcon(suggestionType)} New comment at ${selected.name}`,
        message: suggestionMessage.trim() || `${suggestionType} just came in.`,
        icon: updateTypeIcon(suggestionType),
        createdAt: new Date().toISOString(),
      });

      setSuggestionStatus("success");
      setSuggestionFeedback("Comment added — you just put people on.");
      setSuggestionMessage("");
      setSuggestionMediaFile(null);
      setSuggestionType("Event");
      setSuggestionOpen(false);
    } catch (error) {
      console.error("Suggestion error:", error);
      setSuggestionStatus("error");
      setSuggestionFeedback(error instanceof Error ? error.message : "Could not send update. Please try again.");
    } finally {
      setSuggestionLoading(false);
    }
  }

  async function submitEvent() {
    if (!selected) return;

    setEventLoading(true);
    setEventStatus(null);
    setEventFeedback("");

    try {
      const { error } = await supabase.from("suggested_events").insert({
        venue_id: selected.id || null,
        venue_name: selected.name,
        event_title: eventTitle.trim(),
        event_date: eventDate || null,
        start_time: eventTime.trim() || null,
        genre: eventGenre.trim() || null,
        dj: eventDj.trim() || null,
        cover_price: eventCoverPrice.trim() || null,
        age_limit: eventAgeLimit.trim() || null,
        description: eventDescription.trim() || null,
      });

      if (error) throw error;

      setEventStatus("success");
      setEventFeedback("Event submitted — we’ll review it.");
      setEventTitle("");
      setEventDate("");
      setEventTime("");
      setEventGenre("");
      setEventDj("");
      setEventCoverPrice("");
      setEventAgeLimit("");
      setEventDescription("");
      setEventOpen(false);
    } catch (error) {
      console.error("Event submit error:", error);
      setEventStatus("error");
      setEventFeedback("Could not submit event. Please try again.");
    } finally {
      setEventLoading(false);
    }
  }

  function handleTouchEnd(e: React.TouchEvent<HTMLDivElement>) {
    if (touchStartY.current === null) return;

    const endY = e.changedTouches[0].clientY;
    const diff = touchStartY.current - endY;

    if (diff > 40) setSheetExpanded(true);
    if (diff < -40) setSheetExpanded(false);

    touchStartY.current = null;
  }

  function addVenueSourcesAndLayers(targetMap: mapboxgl.Map, modeOverride?: MapMode) {
    const effectiveMode = modeOverride || mapMode;

    if (!targetMap.isStyleLoaded()) {
      targetMap.once("style.load", () => addVenueSourcesAndLayers(targetMap, effectiveMode));
      return;
    }

    if (!targetMap.getSource("venue-heat")) {
      targetMap.addSource("venue-heat", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: [],
        },
      });
    }

    const firstSymbol = targetMap
      .getStyle()
      .layers?.find((layer) => layer.type === "symbol")?.id;

    if (!targetMap.getLayer("venue-heat-layer")) {
      targetMap.addLayer(
        {
          id: "venue-heat-layer",
          type: "heatmap",
          source: "venue-heat",
          maxzoom: 18,
          paint: {
            "heatmap-weight": [
              "interpolate",
              ["linear"],
              ["get", "weight"],
              1,
              0.4,
              2,
              0.9,
              4,
              1.4,
              8,
              1.9,
              16,
              2.5,
            ],
            "heatmap-intensity": [
              "interpolate",
              ["linear"],
              ["zoom"],
              7,
              1.4,
              11,
              2.1,
              15,
              2.8,
            ],
            "heatmap-color": [
              "interpolate",
              ["linear"],
              ["heatmap-density"],
              0,
              "rgba(0,0,0,0)",
              0.1,
              "rgba(252,211,77,0.3)",
              0.25,
              "rgba(251,146,60,0.5)",
              0.4,
              "rgba(249,115,22,0.65)",
              0.6,
              "rgba(239,68,68,0.8)",
              0.8,
              "rgba(220,38,38,0.9)",
              1,
              "rgba(185,28,28,0.95)",
            ],
            "heatmap-radius": [
              "interpolate",
              ["linear"],
              ["zoom"],
              7,
              20,
              10,
              35,
              13,
              50,
              16,
              65,
            ],
            "heatmap-opacity": [
              "interpolate",
              ["linear"],
              ["zoom"],
              7,
              0.45,
              11,
              0.6,
              15,
              0.72,
            ],
          },
        },
        firstSymbol
      );
    }

    if (!targetMap.getSource("venue-points")) {
      targetMap.addSource("venue-points", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: [],
        },
      });
    }

    const activeExpression: any = [">", ["get", "activeScore"], 0];
    const surgingExpression: any = ["==", ["get", "isSurging"], true];
    const heatingExpression: any = ["==", ["get", "isHeating"], true];
    const coolingExpression: any = ["==", ["get", "isCooling"], true];
    const aiWatchingExpression: any = ["==", ["get", "isAiWatching"], true];
    const upcomingEventExpression: any = ["==", ["get", "hasUpcomingEvent"], true];
    const hotColorExpression: any = [
      "case",
      surgingExpression,
      "#ef4444", // confirmed packed / live hot
      heatingExpression,
      "#fb923c", // confirmed active
      coolingExpression,
      "#60a5fa", // confirmed cooling
      aiWatchingExpression,
      "#facc15", // Watching only, no fake heat
      upcomingEventExpression,
      "#38bdf8", // upcoming event venue, not live heat
      effectiveMode === "day" ? "#334155" : "#6b7280", // quiet / monitored
    ];


      const spotlightExpression: any = ["==", ["get", "isSpotlight"], true];
      const topMoveExpression: any = ["==", ["get", "isTopMove"], true];
      const topMoveOneExpression: any = ["==", ["get", "isTopMoveOne"], true];
      const liveTargetExpression: any = ["any", spotlightExpression, topMoveOneExpression];

      if (!targetMap.getLayer("venue-pins-activity-spotlight")) {
        targetMap.addLayer({
          id: "venue-pins-activity-spotlight",
          type: "circle",
          source: "venue-points",
          paint: {
            "circle-radius": [
              "interpolate",
              ["linear"],
              ["zoom"],
              8,
              ["case", spotlightExpression, 34, 0],
              11,
              ["case", spotlightExpression, 52, 0],
              14,
              ["case", spotlightExpression, 82, 0]
            ],
            "circle-color": "#fb923c",
            "circle-blur": 0.74,
            "circle-opacity": ["case", spotlightExpression, 0.68, 0]
          }
        });
      }

      if (!targetMap.getLayer("venue-pins-activity-ring")) {
        targetMap.addLayer({
          id: "venue-pins-activity-ring",
          type: "circle",
          source: "venue-points",
          paint: {
            "circle-radius": [
              "interpolate",
              ["linear"],
              ["zoom"],
              8,
              ["case", spotlightExpression, 14, 0],
              11,
              ["case", spotlightExpression, 24, 0],
              14,
              ["case", spotlightExpression, 38, 0]
            ],
            "circle-color": "rgba(0,0,0,0)",
            "circle-stroke-color": "#fff7ed",
            "circle-stroke-width": ["case", spotlightExpression, 3.5, 0],
            "circle-stroke-opacity": ["case", spotlightExpression, 0.95, 0]
          }
        });
      }

      if (!targetMap.getLayer("venue-pins-live-radar-wave")) {
        targetMap.addLayer({
          id: "venue-pins-live-radar-wave",
          type: "circle",
          source: "venue-points",
          paint: {
            "circle-radius": [
              "interpolate",
              ["linear"],
              ["zoom"],
              8,
              ["case", liveTargetExpression, 42, topMoveExpression, 22, surgingExpression, 28, 0],
              11,
              ["case", liveTargetExpression, 70, topMoveExpression, 36, surgingExpression, 48, 0],
              14,
              ["case", liveTargetExpression, 108, topMoveExpression, 58, surgingExpression, 72, 0]
            ],
            "circle-color": [
              "case",
              spotlightExpression,
              "#fb923c",
              topMoveOneExpression,
              "#ff3b30",
              topMoveExpression,
              "#facc15",
              hotColorExpression
            ],
            "circle-blur": ["case", liveTargetExpression, 0.86, 0.92],
            "circle-opacity": [
              "interpolate",
              ["linear"],
              ["zoom"],
              8,
              ["case", liveTargetExpression, 0.34, topMoveExpression, 0.16, surgingExpression, 0.18, 0],
              12,
              ["case", liveTargetExpression, 0.46, topMoveExpression, 0.22, surgingExpression, 0.26, 0],
              15,
              ["case", liveTargetExpression, 0.56, topMoveExpression, 0.28, surgingExpression, 0.34, 0]
            ]
          }
        });
      }

    if (!targetMap.getLayer("venue-pins-mega-halo")) {
      targetMap.addLayer({
        id: "venue-pins-mega-halo",
        type: "circle",
        source: "venue-points",
        paint: {
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            8,
            ["case", liveTargetExpression, 34, topMoveExpression, 26, surgingExpression, 24, heatingExpression, 16, activeExpression, 10, 0],
            11,
            ["case", liveTargetExpression, 54, topMoveExpression, 42, surgingExpression, 38, heatingExpression, 26, activeExpression, 16, 0],
            14,
            ["case", liveTargetExpression, 86, topMoveExpression, 68, surgingExpression, 62, heatingExpression, 44, activeExpression, 26, 0],
          ],
          "circle-color": hotColorExpression,
          "circle-blur": ["case", surgingExpression, 0.9, 0.82],
          "circle-opacity": [
            "interpolate",
            ["linear"],
            ["zoom"],
            8,
            ["case", liveTargetExpression, 0.44, topMoveExpression, 0.34, surgingExpression, 0.3, heatingExpression, 0.18, activeExpression, 0.08, 0],
            12,
            ["case", liveTargetExpression, 0.58, topMoveExpression, 0.46, surgingExpression, 0.42, heatingExpression, 0.27, activeExpression, 0.12, 0],
            15,
            ["case", liveTargetExpression, 0.68, topMoveExpression, 0.54, surgingExpression, 0.52, heatingExpression, 0.34, activeExpression, 0.16, 0],
          ],
        },
      });
    }

    if (!targetMap.getLayer("venue-pins-ring")) {
      targetMap.addLayer({
        id: "venue-pins-ring",
        type: "circle",
        source: "venue-points",
        paint: {
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            9,
            ["case", liveTargetExpression, 14, topMoveExpression, 11, surgingExpression, 9, heatingExpression, 7, activeExpression, 5, 0],
            12,
            ["case", liveTargetExpression, 24, topMoveExpression, 19, surgingExpression, 16, heatingExpression, 12, activeExpression, 8, 0],
            15,
            ["case", liveTargetExpression, 36, topMoveExpression, 30, surgingExpression, 24, heatingExpression, 18, activeExpression, 12, 0],
          ],
          "circle-color": "rgba(0,0,0,0)",
          "circle-stroke-color": hotColorExpression,
          "circle-stroke-width": ["case", liveTargetExpression, 4, topMoveExpression, 3.2, surgingExpression, 3, heatingExpression, 2.2, activeExpression, 1.2, 0],
          "circle-stroke-opacity": ["case", surgingExpression, 0.95, heatingExpression, 0.72, activeExpression, 0.35, 0],
        },
      });
    }

    if (!targetMap.getLayer("venue-pins-glow")) {
      targetMap.addLayer({
        id: "venue-pins-glow",
        type: "circle",
        source: "venue-points",
        paint: {
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            8,
            ["case", liveTargetExpression, 26, topMoveExpression, 22, surgingExpression, 18, heatingExpression, 14, activeExpression, 10, 3],
            10,
            ["case", liveTargetExpression, 38, topMoveExpression, 32, surgingExpression, 26, heatingExpression, 20, activeExpression, 15, 5],
            12,
            ["case", liveTargetExpression, 54, topMoveExpression, 44, surgingExpression, 36, heatingExpression, 28, activeExpression, 22, 7],
            15,
            ["case", liveTargetExpression, 72, topMoveExpression, 60, surgingExpression, 50, heatingExpression, 38, activeExpression, 32, 10],
          ],
          "circle-color": hotColorExpression,
          "circle-blur": ["case", surgingExpression, 0.65, activeExpression, 0.78, 0.95],
          "circle-opacity": [
            "interpolate",
            ["linear"],
            ["zoom"],
            8,
            ["case", activeExpression, 0.28, 0.05],
            10,
            ["case", activeExpression, 0.38, 0.1],
            12,
            ["case", activeExpression, 0.48, 0.14],
            15,
            ["case", activeExpression, 0.58, 0.18],
          ],
        },
      });
    }

    if (!targetMap.getLayer("venue-pins-core")) {
      targetMap.addLayer({
        id: "venue-pins-core",
        type: "circle",
        source: "venue-points",
        paint: {
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            8,
            ["case", liveTargetExpression, 8, topMoveExpression, 7, surgingExpression, 6, heatingExpression, 5, activeExpression, 4, 2.2],
            10,
            ["case", liveTargetExpression, 12, topMoveExpression, 10, surgingExpression, 9, heatingExpression, 7, activeExpression, 6, 3.2],
            12,
            ["case", liveTargetExpression, 17, topMoveExpression, 15, surgingExpression, 13, heatingExpression, 10, activeExpression, 8, 4.2],
            15,
            ["case", liveTargetExpression, 24, topMoveExpression, 21, surgingExpression, 18, heatingExpression, 14, activeExpression, ["case", [">=", ["get", "activeScore"], 8], 12, 10], 4.5],
          ],
          "circle-color": hotColorExpression,
          "circle-opacity": [
            "interpolate",
            ["linear"],
            ["zoom"],
            8,
            ["case", activeExpression, 1, aiWatchingExpression, 0.95, 0.45],
            10,
            ["case", activeExpression, 1, aiWatchingExpression, 0.95, 0.52],
            12,
            ["case", activeExpression, 1, aiWatchingExpression, 0.95, 0.6],
            15,
            ["case", activeExpression, 1, aiWatchingExpression, 0.95, 0.68],
          ],
          "circle-stroke-color": effectiveMode === "day" ? "#0f172a" : "#ffffff",
          "circle-stroke-width": [
            "interpolate",
            ["linear"],
            ["zoom"],
            8,
            ["case", activeExpression, 1, 0.35],
            12,
            ["case", activeExpression, 2, 0.6],
            15,
            ["case", activeExpression, 2.5, 0.85],
          ],
          "circle-stroke-opacity": ["case", activeExpression, 0.9, 0.35],
        },
      });
    }

    const pointSource = targetMap.getSource("venue-points") as mapboxgl.GeoJSONSource | null;
    pointSource?.setData(buildVenuePointsGeoJSON(filteredVenuesRef.current, activePulseVenueId));

    const heatSource = targetMap.getSource("venue-heat") as mapboxgl.GeoJSONSource | null;
    heatSource?.setData(buildVenueHeatmapGeoJSON(filteredVenuesRef.current) as GeoJSON.FeatureCollection);

    if (targetMap.getLayer("venue-heat-layer")) {
      targetMap.setLayoutProperty(
        "venue-heat-layer",
        "visibility",
        heatmapEnabled ? "visible" : "none"
      );
    }

    // Mapbox setStyle clears custom sources/layers. Hydrate twice so day/night
    // switches never leave the map without pins while the new style settles.
    window.setTimeout(() => {
      const refreshedPointSource = targetMap.getSource("venue-points") as mapboxgl.GeoJSONSource | null;
      refreshedPointSource?.setData(buildVenuePointsGeoJSON(filteredVenuesRef.current, activePulseVenueId));

      const refreshedHeatSource = targetMap.getSource("venue-heat") as mapboxgl.GeoJSONSource | null;
      refreshedHeatSource?.setData(buildVenueHeatmapGeoJSON(filteredVenuesRef.current) as GeoJSON.FeatureCollection);
    }, 150);
  }

  function switchMapMode() {
    if (!map) return;

    const nextMode: MapMode = mapMode === "day" ? "night" : "day";
    setMapMode(nextMode);
    map.setStyle(MAPBOX_STYLES[nextMode]);

    const restoreCustomLayers = () => {
      addVenueSourcesAndLayers(map, nextMode);
      map.resize();
    };

    map.once("style.load", restoreCustomLayers);
    map.once("idle", restoreCustomLayers);
    window.setTimeout(restoreCustomLayers, 250);
  }

  function clearInAppNavigation() {
    if (!map) return;

    if (map.getLayer("active-route-line")) map.removeLayer("active-route-line");
    if (map.getLayer("active-route-glow")) map.removeLayer("active-route-glow");
    if (map.getSource("active-route")) map.removeSource("active-route");

    setNavigationActive(null);
    setNavigationError(null);
  }

  function drawRouteOnMap(
    routeGeometry: GeoJSON.LineString,
    userLng: number,
    userLat: number,
    venue: VenueWithEvent
  ) {
    if (!map) return;

    const routeData: GeoJSON.FeatureCollection<GeoJSON.LineString> = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: routeGeometry,
          properties: {},
        },
      ],
    };

    if (map.getSource("active-route")) {
      const source = map.getSource("active-route") as mapboxgl.GeoJSONSource;
      source.setData(routeData);
    } else {
      map.addSource("active-route", {
        type: "geojson",
        data: routeData,
      });
    }

    if (!map.getLayer("active-route-glow")) {
      map.addLayer({
        id: "active-route-glow",
        type: "line",
        source: "active-route",
        layout: {
          "line-cap": "round",
          "line-join": "round",
        },
        paint: {
          "line-color": "#fb923c",
          "line-width": 12,
          "line-opacity": 0.24,
          "line-blur": 4,
        },
      });
    }

    if (!map.getLayer("active-route-line")) {
      map.addLayer({
        id: "active-route-line",
        type: "line",
        source: "active-route",
        layout: {
          "line-cap": "round",
          "line-join": "round",
        },
        paint: {
          "line-color": "#f97316",
          "line-width": 5,
          "line-opacity": 0.95,
        },
      });
    }

    userLocationMarkerRef.current?.remove();

    const markerEl = document.createElement("div");
    markerEl.className = "user-location-marker";
    markerEl.style.pointerEvents = "none";
    markerEl.style.width = "42px";
    markerEl.style.height = "42px";

    const label = document.createElement("div");
    label.className = "user-location-label";
    label.textContent = "Start";

    const pulse = document.createElement("div");
    pulse.className = "user-location-pulse";

    const dot = document.createElement("div");
    dot.className = "user-location-dot";

    markerEl.appendChild(label);
    markerEl.appendChild(pulse);
    markerEl.appendChild(dot);

    userLocationMarkerRef.current = new mapboxgl.Marker({
      element: markerEl,
      anchor: "center",
    })
      .setLngLat([userLng, userLat])
      .addTo(map);

    const bounds = new mapboxgl.LngLatBounds();
    bounds.extend([userLng, userLat]);
    bounds.extend([venue.lng, venue.lat]);

    routeGeometry.coordinates.forEach((coord) => {
      bounds.extend(coord as [number, number]);
    });

    map.fitBounds(bounds, {
      padding: { top: 190, bottom: 260, left: 40, right: 80 },
      duration: 900,
      maxZoom: 15,
    });
  }

  async function startInAppNavigation() {
    if (!selected || !map) return;

    setNavigationLoading(true);
    setNavigationError(null);

    try {
      const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
      if (!token) throw new Error("Missing Mapbox token.");

      if (!navigator.geolocation) {
        throw new Error("Your browser does not support location services.");
      }

      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 12000,
          maximumAge: 0,
        });
      });

      const userLng = position.coords.longitude;
      const userLat = position.coords.latitude;

      const directionsUrl =
        `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/` +
        `${userLng},${userLat};${selected.lng},${selected.lat}` +
        `?geometries=geojson&overview=full&steps=true&alternatives=false&access_token=${token}`;

      const response = await fetch(directionsUrl);
      if (!response.ok) throw new Error("Could not get directions right now.");

      const data = await response.json();
      const route = data.routes?.[0];
      if (!route?.geometry) throw new Error("No route found for this venue.");

      const steps: NavigationStep[] =
        route.legs?.[0]?.steps?.map((step: any) => ({
          instruction: step.maneuver?.instruction || "Continue",
          distance: step.distance || 0,
          duration: step.duration || 0,
        })) || [];

      drawRouteOnMap(route.geometry, userLng, userLat, selected);

      setNavigationActive({
        venueName: selected.name,
        distanceMiles: route.distance / 1609.344,
        durationMinutes: Math.max(1, Math.round(route.duration / 60)),
        steps,
      });

      setSheetExpanded(false);
      setViewMode("map");
    } catch (error) {
      console.error("In-app navigation error:", error);
      setNavigationError(
        error instanceof Error
          ? error.message
          : "Could not start in-app navigation. Make sure location permission is allowed."
      );
    } finally {
      setNavigationLoading(false);
    }
  }

  function smoothZoom(direction: "in" | "out") {
    if (!map) return;

    const current = map.getZoom();
    const target = direction === "in"
      ? Math.min(16, current + 1)
      : Math.max(8, current - 1);

    map.easeTo({
      zoom: target,
      duration: 450,
      easing: (t) => t * (2 - t),
    });

    setCurrentZoom(Math.round(target * 10) / 10);
  }

  const topSpots = [...filteredVenues].sort((a, b) => {
    const rankVenue = (venue: VenueWithEvent) => {
      const signals = (venue.voteCount || 0) + (venue.updateCount || 0);
      const score = venue.vibeScore || venue.score || 0;
      const trend = venue.trendingScore || 0;
      const realSignalBoost = hasRealVenueSignals(venue) ? 75 : 0;
      const eventBoost = venue.tonightEvent ? 28 : 0;
      const photoBoost = (venue as any).photo_url ? 8 : 0;
      const heatBoost = venue.vibeTrend === "surging" ? 28 : venue.vibeTrend === "heating" ? 16 : 0;

      return realSignalBoost + score + trend * 0.45 + signals * 11 + eventBoost + photoBoost + heatBoost;
    };

    return rankVenue(b) - rankVenue(a);
  });

  const eventSpots = useMemo(() => {
    const seen = new Set<string>();

    return filteredVenues
      .filter((venue) => venue.tonightEvent)
      .filter((venue) => {
        const key = getEventDedupeKey(venue.tonightEvent);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }, [filteredVenues]);

  const eventTabItems = useMemo(() => {
    const cleanEvents = dedupeEvents(upcomingEvents);

    return cleanEvents
      .map((event) => {
        const matchedVenue = venues.find((venue) => eventMatchesVenue(event, venue));
        return { event, venue: matchedVenue || null };
      })
      .filter(({ event, venue }) => {
        if (city !== "All 757" && venue?.city !== city && !String(event.venue_name || "").toLowerCase().includes(city.toLowerCase())) {
          return false;
        }

        if (!query.trim()) return true;

        const q = query.toLowerCase();
        return [
          event.title,
          event.name,
          event.venue_name,
          event.source,
          event.ticket_status,
          venue?.name,
          venue?.city,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(q);
      });
  }, [upcomingEvents, venues, city, query]);
  const visibleTopSpots = sheetExpanded ? topSpots : topSpots.slice(0, 3);

  const trending = [...filteredVenues]
    .sort((a, b) => (b.trendingScore || 0) - (a.trendingScore || 0))
    .slice(0, 5);

  const trendingLabelText = trendingLabel(trending[0]?.trendingScore);
  const heroSpot = trending[0] || topSpots[0];

  const activeCount = filteredVenues.reduce(
    (sum, venue) => sum + (venue.voteCount || 0),
    0
  );

  const cityPulseItems = cityFeed.slice(0, 3);
  const fallbackPulseItems: CityPulseItem[] = trending.slice(0, 3).map((venue) => ({
    id: `fallback-${venue.id}`,
    venue_name: venue.name,
    venue_id: venue.id,
    update_type: venue.energyLevel === "high" ? "Vibe" : "Event",
    message:
      venue.energyLevel === "high"
        ? "is heating up right now"
        : venue.tonightEvent
        ? `has ${venue.tonightEvent.title} tonight`
        : energyLabel(venue.energyLevel),
    created_at: venue.lastUpdated || null,
  }));
  const visiblePulseItems = cityPulseItems.length > 0 ? cityPulseItems : fallbackPulseItems;

  const hotRightNowSpots = (topSpots.filter((venue) => hasRealVenueSignals(venue)).length > 0
    ? topSpots.filter((venue) => hasRealVenueSignals(venue))
    : topSpots
  ).slice(0, 3);

  const liveActivityTickerItems = useMemo<LiveTickerItem[]>(() => {
    const items: LiveTickerItem[] = [];
    const seen = new Set<string>();

    const addItem = (item: LiveTickerItem) => {
      const key = item.venue?.id || item.id || item.title;
      if (seen.has(key)) return;
      seen.add(key);
      items.push(item);
    };

    cityFeed.slice(0, 5).forEach((item) => {
      const matchedVenue = venues.find(
        (venue) => venue.id === item.venue_id || venue.name === item.venue_name
      );

      addItem({
        id: `feed-${item.id}`,
        venue: matchedVenue || null,
        title: item.venue_name || matchedVenue?.name || "Tonight",
        detail:
          item.message ||
          (item.update_type ? `${item.update_type} update just came in` : "Something new just came in"),
        tone: "active",
      });
    });

    hotRightNowSpots.forEach((venue, index) => {
      const score = getVibeIntensity(venue);
      const eventTitle = venue.tonightEvent?.title || venue.upcomingEvents?.[0]?.title;
      const title = venue.name;
      const detail = eventTitle
        ? `${eventTitle} tonight`
        : venue.vibeTrend && venue.vibeTrend !== "quiet"
        ? vibeTrendLabel(venue.vibeTrend)
        : venue.aiSummary || energyLabel(venue.energyLevel);

      addItem({
        id: `venue-${venue.id}`,
        venue,
        title,
        detail,
        tone: score >= 75 ? "hot" : score >= 55 ? "active" : index === 0 ? "watch" : "calm",
      });
    });

    eventSpots.slice(0, 5).forEach((venue) => {
      const eventTitle = venue.tonightEvent?.title || "Event tonight";

      addItem({
        id: `event-${venue.id}`,
        venue,
        title: venue.name,
        detail: eventTitle,
        tone: "watch",
      });
    });

    return items.slice(0, 12);
  }, [cityFeed, venues, hotRightNowSpots, eventSpots]);

  const todayMoves = useMemo<TodayMoveItem[]>(() => {
    const pickBest = (
      label: string,
      candidates: VenueWithEvent[],
      fallbackDetail?: string
    ): TodayMoveItem | null => {
      const ranked = [...candidates]
        .filter((venue) => venue.lng && venue.lat)
        .sort((a, b) => todayMoveScore(b) - todayMoveScore(a));

      const venue = ranked[0];
      if (!venue) return null;

      const score = todayMoveScore(venue);

      return {
        id: `${label}-${venue.id}`,
        label,
        venue,
        detail: fallbackDetail || todayMoveDetail(venue),
        score,
        tone: todayMoveTone(score),
      };
    };

    const food = filteredVenues.filter((venue) => getBehaviorCategory(venue) === "restaurant");
    const nightlife = filteredVenues.filter((venue) => getBehaviorCategory(venue) === "nightlife");
    const events = filteredVenues.filter((venue) => !!venue.tonightEvent || getBehaviorCategory(venue) === "event");
    const lowKey = filteredVenues.filter((venue) => {
      const score = venue.vibeScore || venue.score || venue.aiScore || 0;
      return score >= 30 && score <= 62 && getBehaviorCategory(venue) !== "event";
    });

    const moves = [
      pickBest("Best overall", filteredVenues),
      pickBest("Food move", food),
      pickBest("Nightlife", nightlife),
      pickBest("Event pick", events),
      pickBest("Low-key", lowKey, "Easy option if you do not want too much chaos"),
    ].filter(Boolean) as TodayMoveItem[];

    const seen = new Set<string>();
    return moves.filter((move) => {
      const key = `${move.label}-${move.venue.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [filteredVenues]);


  useEffect(() => {
    if (selected || viewMode !== "map" || trending.length <= 1) return;

    const interval = window.setInterval(() => {
      setActiveSlideIndex((prev) => {
        const next = (prev + 1) % Math.min(trending.length, 5);

        activeStripRef.current?.scrollTo({
          left: next * 184,
          behavior: "smooth",
        });

        return next;
      });
    }, 3200);

    return () => window.clearInterval(interval);
  }, [selected, viewMode, trending.length]);

  const primaryChips = CHIP_CONFIGS.slice(0, 17);
  const moreChips = CHIP_CONFIGS.slice(17);
  const chips = CHIP_CONFIGS.map((chip) => chip.label);

  function handleChipClick(chip: (typeof CHIP_CONFIGS)[number]) {
    const nextPreference = chip.preference;

    // All is the venue-directory trigger. Pressing it again should close the list.
    if (chip.label === "All" && activeChip === "All" && venueDirectoryOpen) {
      setVenueDirectoryOpen(false);
      setViewMode("map");
      setSelected(null);
      return;
    }

    setActiveChip(chip.label);
    setSelectedPreference(nextPreference);
    setSelected(null);
    setSheetExpanded(true);

    if (chip.label === "Events") {
      setViewMode("events");
      setVenueDirectoryOpen(false);
    } else if (chip.label === "All") {
      setViewMode("map");
      setVenueDirectoryOpen(true);
    } else {
      setViewMode("map");
      setVenueDirectoryOpen(false);
    }

    if (recommendation || recommendationLoading) {
      fetchRecommendation(undefined, nextPreference);
    }
  }

  const vibeGlowClass = selected?.status === "lit"
    ? "border-red-400/20 bg-red-500/10 shadow-[0_0_30px_rgba(239,68,68,0.22)]"
    : selected?.status === "decent"
    ? "border-yellow-300/20 bg-yellow-400/10 shadow-[0_0_30px_rgba(245,179,1,0.22)]"
    : "border-slate-400/20 bg-slate-500/10 shadow-[0_0_30px_rgba(148,163,184,0.22)]";
  const selectedEnergyGlowClass = energyGlow(selected?.energyLevel);
  const selectedVibeIntensity = getVibeIntensity(selected);
  const selectedVibeMeterLabel = vibeMeterLabel(selected);
  const selectedVenuePhotoFields = selected
    ? [
        (selected as any).photo_url,
        (selected as any).venue_photo_url,
        (selected as any).building_photo_url,
        (selected as any).exterior_photo_url,
        (selected as any).image_url,
        (selected as any).cover_image_url,
        (selected as any).hero_image_url,
      ].filter(Boolean)
    : [];
  const selectedVenuePhotoArray = selected
    ? Array.isArray((selected as any).photos)
      ? (selected as any).photos.filter(Boolean)
      : []
    : [];
  const selectedOfficialVenuePhotos = [
    ...selectedVenuePhotoFields.map((url, index) => ({
      id: `official-venue-photo-${index}`,
      url: String(url),
      type: "image",
      label: "Venue photo",
      created_at: null,
    })),
    ...selectedVenuePhotoArray.map((url: string, index: number) => ({
      id: `official-venue-gallery-${index}`,
      url: String(url),
      type: "image",
      label: "Venue photo",
      created_at: null,
    })),
  ].slice(0, 6);
  const selectedVenueHeroPhoto = selectedOfficialVenuePhotos[0] || null;
  const selectedUpdateMedia = recentUpdates
    .filter((update) => update.media_url)
    .map((update) => ({
      id: update.id,
      url: update.media_url as string,
      type: update.media_type || "image",
      label: update.update_type || "Live update",
      created_at: update.created_at,
    }))
    .slice(0, 6);

  const selectedUpcomingEvents = selected
    ? dedupeEvents((selected.upcomingEvents || []).filter(Boolean))
    : [];
  const selectedPrimaryEvent = selected?.tonightEvent || selectedUpcomingEvents[0] || null;
  const selectedPrimaryEventIsLive = !!selected?.tonightEvent;
  const selectedPrimaryEventUrl = selectedPrimaryEvent?.source_url || null;
  const isDay = mapMode === "day";

  return (
    <main className={`relative h-screen w-full max-w-full overflow-hidden ${isDay ? "bg-slate-100 text-slate-950" : "bg-black text-white"}`}>
      <style jsx global>{`
        @keyframes litPulse {
          0% {
            transform: scale(1);
            filter: brightness(1);
          }
          50% {
            transform: scale(1.16);
            filter: brightness(1.25);
          }
          100% {
            transform: scale(1);
            filter: brightness(1);
          }
        }


        @keyframes radarBreathe {
          0%, 100% {
            filter: drop-shadow(0 0 8px rgba(251, 146, 60, 0.28));
          }
          50% {
            filter: drop-shadow(0 0 18px rgba(251, 146, 60, 0.48));
          }
        }

        @keyframes livePulse {
          0%, 100% {
            opacity: 1;
            transform: scale(1);
          }
          50% {
            opacity: 0.7;
            transform: scale(1.1);
          }
        }

        @keyframes cardGlow {
          0%, 100% {
            box-shadow: 0 10px 30px rgba(239, 68, 68, 0.22);
          }
          50% {
            box-shadow: 0 10px 35px rgba(239, 68, 68, 0.28);
          }
        }

        @keyframes fadeIn {
          from {
            opacity: 0;
            transform: translateY(6px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes skeletonShimmer {
          0% { transform: translateX(-120%); }
          100% { transform: translateX(120%); }
        }

        .skeleton-shimmer::after {
          content: "";
          position: absolute;
          inset: 0;
          transform: translateX(-120%);
          background: linear-gradient(90deg, transparent, rgba(255,255,255,0.12), transparent);
          animation: skeletonShimmer 1.6s ease-in-out infinite;
        }

        @keyframes liveRadarTicker {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }

        .lit-mobile-ticker-track,
        .lit-desktop-ticker-track {
          animation: liveRadarTicker 38s linear infinite;
        }

        .lit-mobile-ticker:hover .lit-mobile-ticker-track,
        .lit-desktop-ticker:hover .lit-desktop-ticker-track {
          animation-play-state: paused;
        }

        @media (prefers-reduced-motion: reduce) {
          .live-pulse,
          .card-glow {
            animation: none !important;
          }
        }

        .lit-marker-core {
          transition: box-shadow 0.25s ease, filter 0.25s ease;
        }

        .live-pulse {
          animation: livePulse 1.5s ease-in-out infinite;
        }

        .card-glow {
          animation: cardGlow 3s ease-in-out infinite;
        }

        .user-location-marker {
          position: relative;
          width: 72px;
          height: 72px;
          display: flex;
          align-items: center;
          justify-content: center;
          pointer-events: none;
        }

        .user-location-pulse {
          position: absolute;
          width: 54px;
          height: 54px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(59, 130, 246, 0.32) 0%, rgba(59, 130, 246, 0.16) 45%, transparent 72%);
          border: 1px solid rgba(96, 165, 250, 0.45);
          animation: locationPulse 2s ease-in-out infinite;
        }

        .user-location-dot {
          position: relative;
          width: 18px;
          height: 18px;
          border-radius: 9999px;
          background: #3b82f6;
          border: 3px solid white;
          box-shadow: 0 0 22px rgba(59, 130, 246, 0.9);
        }

        .user-location-label {
          position: absolute;
          top: -8px;
          left: 50%;
          transform: translateX(-50%);
          white-space: nowrap;
          border-radius: 9999px;
          background: rgba(0, 0, 0, 0.78);
          border: 1px solid rgba(255, 255, 255, 0.16);
          color: white;
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          padding: 3px 8px;
          backdrop-filter: blur(12px);
        }

        @keyframes locationPulse {
          0% {
            transform: scale(1);
            opacity: 1;
          }
          50% {
            transform: scale(1.5);
            opacity: 0.7;
          }
          100% {
            transform: scale(1);
            opacity: 1;
          }
        }

        @keyframes premiumToastIn {
          from {
            opacity: 0;
            transform: translateX(18px) translateY(-8px) scale(0.96);
            filter: blur(8px);
          }
          to {
            opacity: 1;
            transform: translateX(0) translateY(0) scale(1);
            filter: blur(0);
          }
        }

        @keyframes premiumToastShine {
          0% { transform: translateX(-120%); opacity: 0; }
          25% { opacity: 0.75; }
          100% { transform: translateX(140%); opacity: 0; }
        }

        @keyframes premiumToastProgress {
          from { transform: scaleX(1); }
          to { transform: scaleX(0); }
        }

        .premium-toast {
          animation: premiumToastIn 0.38s cubic-bezier(0.16, 1, 0.3, 1) both;
        }

        .premium-toast-shine {
          animation: premiumToastShine 2.8s ease-in-out infinite;
        }

        .premium-toast-progress {
          transform-origin: left center;
          animation: premiumToastProgress 6.5s linear forwards;
        }


        .no-scrollbar::-webkit-scrollbar {
          display: none;
        }

        .no-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }

        select option {
          background: #111827;
          color: white;
        }
      `}</style>

      <div ref={mapContainerRef} className="absolute inset-0 h-full w-full" />

      {venuesLoading && venues.length === 0 && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-black/20 backdrop-blur-[1px]">
          <div className="overflow-hidden rounded-[2rem] border border-white/10 bg-black/75 p-4 shadow-2xl backdrop-blur-2xl">
            <div className="flex items-center gap-3">
              <div className="relative h-12 w-12 overflow-hidden rounded-2xl bg-white/10 skeleton-shimmer" />
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.28em] text-orange-300">Loading Lit757</p>
                <p className="mt-1 text-sm font-semibold text-white/75">Finding tonight’s best moves...</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {activityToasts.length > 0 && (
        <div className="pointer-events-none fixed right-3 top-[188px] z-[60] flex w-[calc(100vw-1.5rem)] max-w-sm flex-col gap-2 sm:right-5 sm:top-[196px]">
          {activityToasts.map((toast, index) => (
            <button
              key={toast.id}
              type="button"
              onClick={() => openToastVenue(toast)}
              className={`premium-toast pointer-events-auto group relative w-full overflow-hidden rounded-[1.35rem] border text-left backdrop-blur-2xl cursor-pointer transition-all duration-300 hover:-translate-y-0.5 hover:scale-[1.015] active:scale-[0.985] ${
                isDay
                  ? "border-white/80 bg-white/90 text-slate-950 shadow-[0_24px_70px_rgba(15,23,42,0.22)]"
                  : "border-white/15 bg-[linear-gradient(135deg,rgba(12,12,18,0.94),rgba(28,14,10,0.88),rgba(8,8,12,0.92))] text-white shadow-[0_24px_80px_rgba(251,113,33,0.22)]"
              } ${index > 0 ? "opacity-90" : ""} ${index > 1 ? "opacity-80" : ""}`}
              style={{
                transform: `translateY(${index * 3}px) scale(${index === 0 ? 1 : index === 1 ? 0.982 : 0.965})`,
                animationDelay: `${index * 70}ms`,
              }}
            >
              <div className="absolute inset-0 opacity-80">
                <div className={`absolute -left-16 top-0 h-full w-20 rotate-12 premium-toast-shine ${isDay ? "bg-white/55" : "bg-white/15"}`} />
                <div className={`absolute inset-x-0 top-0 h-px ${isDay ? "bg-gradient-to-r from-transparent via-slate-300 to-transparent" : "bg-gradient-to-r from-transparent via-white/35 to-transparent"}`} />
              </div>

              <div className="h-1 w-full overflow-hidden bg-black/10">
                <div className="premium-toast-progress h-full w-full bg-gradient-to-r from-amber-400 via-orange-500 via-rose-500 to-fuchsia-500" />
              </div>

              <div className="relative flex items-start gap-3 p-3.5">
                <div className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-xl ring-1 ${
                  isDay
                    ? "bg-gradient-to-br from-orange-100 via-rose-50 to-fuchsia-100 ring-orange-200 shadow-[0_10px_24px_rgba(251,146,60,0.22)]"
                    : "bg-gradient-to-br from-orange-500/30 via-rose-500/20 to-fuchsia-500/25 ring-white/15 shadow-[0_0_32px_rgba(251,146,60,0.28)]"
                }`}>
                  <span className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/35 to-transparent opacity-60" />
                  <span className="relative drop-shadow-sm">{toast.icon}</span>
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.2em] ${
                        isDay
                          ? "bg-orange-100 text-orange-700 ring-1 ring-orange-200"
                          : "bg-orange-500/15 text-orange-100 ring-1 ring-orange-400/20"
                      }`}
                    >
                      <span className="h-1.5 w-1.5 rounded-full bg-orange-500 live-pulse" />
                      Live
                    </span>

                    <span
                      className={`rounded-full px-2 py-1 text-[9px] font-black uppercase tracking-[0.18em] ${
                        isDay
                          ? "bg-slate-100 text-slate-500 ring-1 ring-slate-200"
                          : "bg-white/10 text-white/55 ring-1 ring-white/10"
                      }`}
                    >
                      {toast.createdAt ? minutesAgo(toast.createdAt).replace("Updated ", "") : "now"}
                    </span>

                    {index === 0 && activityToasts.length > 1 && (
                      <span
                        className={`rounded-full px-2 py-1 text-[9px] font-black uppercase tracking-[0.18em] ${
                          isDay
                            ? "bg-fuchsia-100 text-fuchsia-700 ring-1 ring-fuchsia-200"
                            : "bg-fuchsia-500/15 text-fuchsia-100 ring-1 ring-fuchsia-400/20"
                        }`}
                      >
                        +{activityToasts.length - 1} more
                      </span>
                    )}
                  </div>

                  <p className="mt-2 line-clamp-1 text-[15px] font-black leading-tight tracking-tight">
                    {toast.title}
                  </p>
                  <p className={`mt-1 line-clamp-2 text-[12px] leading-snug ${isDay ? "text-slate-600" : "text-white/68"}`}>
                    {toast.message}
                  </p>

                  <div className={`mt-3 flex items-center justify-between gap-3 text-[10px] font-black uppercase tracking-[0.18em] ${isDay ? "text-slate-500" : "text-white/42"}`}>
                    <span>Tap to open spot</span>
                    <span className="transition-transform duration-300 group-hover:translate-x-0.5">→</span>
                  </div>
                </div>

                <span
                  onClick={(event) => {
                    event.stopPropagation();
                    dismissActivityToast(toast.id);
                  }}
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition ${
                    isDay
                      ? "bg-slate-950/5 text-slate-500 hover:bg-slate-950/10 hover:text-slate-950"
                      : "bg-white/10 text-white/55 hover:bg-white/15 hover:text-white"
                  }`}
                  aria-label="Close live activity alert"
                >
                  <X size={14} />
                </span>
              </div>
            </button>
          ))}
        </div>
      )}

      <div className="absolute inset-x-0 top-2 z-50 px-3 sm:left-3 sm:right-3 sm:px-0">
        <div className={`rounded-[1.35rem] border p-3 sm:rounded-2xl sm:p-3 shadow-2xl backdrop-blur-2xl ${
          isDay
            ? "border-white/70 bg-white/90 text-slate-950 shadow-slate-900/10"
            : "border-white/10 bg-black/75 text-white"
        }`}>
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className={`text-[10px] font-bold uppercase tracking-wide ${isDay ? "text-red-600" : "text-red-400"}`}>
                  Live in the 757
                </p>
                <h1 className={`text-[22px] font-black leading-tight tracking-tight sm:text-xl truncate ${isDay ? "text-slate-950" : "text-white"}`}>
                  Find what’s happening tonight
                </h1>
                <div className={`mt-1 flex items-center gap-2 text-xs ${isDay ? "text-slate-600" : "text-white/50"}`}>
                  <p className="truncate">
                    {heroSpot
                      ? `Tonight: ${heroSpot.name}`
                      : "Food, music, events, bars, and more around Hampton Roads"}
                  </p>
                  <span className={`shrink-0 inline-flex items-center gap-2 rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.22em] shadow-[0_0_12px_rgba(251,146,60,0.12)] ${isDay ? "border-red-500/30 bg-red-500/10 text-red-700" : "border-red-500/20 bg-red-500/10 text-red-100"}`}>
                    <span className="h-2 w-2 rounded-full bg-red-400 live-pulse" />
                    Live
                  </span>
                </div>
              </div>

              <select
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="shrink-0 w-24 rounded-full bg-zinc-900 px-2 py-1 text-xs font-semibold text-white outline-none sm:w-28"
              >
                <option>All 757</option>
                <option>Norfolk</option>
                <option>Virginia Beach</option>
                <option>Chesapeake</option>
                <option>Portsmouth</option>
                <option>Suffolk</option>
                <option>Hampton</option>
                <option>Newport News</option>
              </select>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                const question = askText.trim();
                if (!question) return;
                setVoiceBubbleOpen(true);
                setVoiceTranscript(question);
                setVoiceStatus("thinking");
                fetchRecommendation(question).then((responseText) => {
                  if (responseText) {
                    speakRecommendation(responseText);
                  } else {
                    setVoiceStatus("idle");
                  }
                });
              }}
              className={`flex items-center gap-2 rounded-2xl border px-3 py-2 shadow-2xl transition ${isDay ? "border-slate-300/80 bg-white/90 shadow-slate-900/10" : "border-white/10 bg-white/[0.08] shadow-black/20"}`}
            >
              <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${isDay ? "bg-slate-950 text-white" : "bg-white text-black"}`}>
                <Search size={15} />
              </div>
              <input
                value={askText}
                onChange={(e) => setAskText(e.target.value)}
                placeholder="Ask anything: “What’s packed?”, “18+ clubs”, “hookah tonight”, “cheap drinks”..."
                className={`min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none ${isDay ? "text-slate-950 placeholder:text-slate-500" : "text-white placeholder:text-white/40"}`}
              />
              <button
                type="submit"
                disabled={recommendationLoading || !askText.trim()}
                className={`shrink-0 rounded-full px-4 py-2 text-xs font-black transition disabled:cursor-not-allowed disabled:opacity-50 ${isDay ? "bg-slate-950 text-white hover:bg-slate-800" : "bg-white text-black hover:bg-white/90"}`}
              >
                {recommendationLoading ? "Thinking" : "Ask"}
              </button>
            </form>

            <div className="space-y-1.5">
              <p className={`px-1 text-[10px] font-black uppercase tracking-[0.22em] ${isDay ? "text-slate-500" : "text-white/45"}`}>
                Try asking:
              </p>
              <div className="flex gap-1.5 overflow-x-auto pb-1 no-scrollbar">
                {[
                  "Where should I go?",
                  "What’s active now?",
                  "18+ spots",
                  "Cheap drinks",
                ].map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => {
                    setAskText(prompt);
                    const preference =
                      prompt === "18+ spots"
                        ? "18+"
                        : prompt === "Cheap drinks"
                        ? "cheap"
                        : prompt === "Hookah tonight"
                        ? "hookah"
                        : prompt === "Afrobeats"
                        ? "afrobeats"
                        : prompt.includes("packed") || prompt.includes("lit")
                        ? "turn up"
                        : null;

                    setSelectedPreference(preference);
                    fetchRecommendation(prompt, preference);
                  }}
                  className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-bold transition ${isDay ? "border-slate-300/80 bg-white/80 text-slate-700 hover:bg-slate-100" : "border-white/10 bg-white/10 text-white/75 hover:bg-white/15 hover:text-white"}`}
                >
                  {prompt}
                  </button>
                ))}
              </div>
            </div>

            {(cityPulseLoading || cityPulseSummary || cityPulseTopVenues.length > 0) && (
              <div
                className={`relative overflow-hidden rounded-[1.35rem] border p-4 shadow-2xl backdrop-blur-2xl ${
                  isDay
                    ? "border-white/80 bg-white/85 text-slate-950 shadow-slate-900/10"
                    : "border-white/10 bg-white/[0.055] text-white shadow-black/25"
                }`}
              >
                <div className={`pointer-events-none absolute inset-0 ${isDay ? "bg-gradient-to-br from-orange-100/70 via-white/20 to-red-100/60" : "bg-gradient-to-br from-orange-500/12 via-transparent to-red-500/10"}`} />

                <div className="relative z-10 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-orange-400 live-pulse" />
                    <p className={`text-[9px] font-black uppercase tracking-[0.24em] ${isDay ? "text-slate-500" : "text-white/50"}`}>
                      {city === "All 757" ? "Tonight in the 757" : `Tonight in ${city}`}
                    </p>
                  </div>

                  <span className={`rounded-full border px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.18em] ${isDay ? "border-orange-200 bg-orange-50 text-orange-700" : "border-orange-300/20 bg-orange-500/10 text-orange-100"}`}>
                    Live pulse
                  </span>
                </div>

                <div className="relative z-10 mt-3">
                  {cityPulseLoading ? (
                    <div className="space-y-2.5">
                      <div className={`h-3.5 w-11/12 rounded-full ${isDay ? "bg-slate-200" : "bg-white/10"} animate-pulse`} />
                      <div className={`h-3.5 w-2/3 rounded-full ${isDay ? "bg-slate-200" : "bg-white/10"} animate-pulse`} />
                    </div>
                  ) : (
                    <>
                      <p className={`text-[13px] leading-5 sm:text-sm ${isDay ? "text-slate-700" : "text-white/78"}`}>
                        {cityPulseSummary || "The city is still warming up. Check back as tonight starts moving."}
                      </p>

                      {cityPulseTopVenues.length > 0 && (
                        <div className="mt-3 flex gap-2 overflow-x-auto pb-1 no-scrollbar">
                          {cityPulseTopVenues.slice(0, 5).map((venue) => (
                            <button
                              key={venue.id}
                              type="button"
                              onClick={() => {
                                const found = venues.find((item) => item.id === venue.id);
                                if (!found) return;

                                setSelected(found);
                                setSheetExpanded(true);
                                setViewMode("map");
                                spotlightActivityVenue(found.id);

                                if (map && found.lng && found.lat) {
                                  map.flyTo({
                                    center: [found.lng, found.lat],
                                    zoom: Math.max(map.getZoom(), 14.5),
                                    duration: 850,
                                  });
                                }
                              }}
                              className={`shrink-0 rounded-full border px-3 py-1.5 text-[11px] font-black transition active:scale-95 ${
                                isDay
                                  ? "border-slate-300/80 bg-white/80 text-slate-700 hover:bg-slate-100"
                                  : "border-white/10 bg-white/10 text-white/75 hover:bg-white/15 hover:text-white"
                              }`}
                            >
                              {venue.name}
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          {(recommendationLoading || recommendation) && (
            <div className={`relative mt-2 rounded-2xl border px-3 py-2 pr-10 text-xs shadow-xl backdrop-blur-xl ${isDay ? "border-slate-200/80 bg-white/75 text-slate-900 shadow-slate-900/10" : "border-white/10 bg-white/10 text-white shadow-black/20"}`}>
              <button
                onClick={closeRecommendationPanel}
                className={`absolute right-2 top-2 z-20 inline-flex h-7 w-7 items-center justify-center rounded-full border transition ${isDay ? "border-slate-300/80 bg-white/80 text-slate-700 hover:bg-slate-100" : "border-white/10 bg-black/30 text-white/70 hover:bg-white/10 hover:text-white"}`}
                aria-label="Close recommendation"
              >
                <X size={14} />
              </button>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.22em] ${isDay ? "bg-slate-900/10 text-slate-700" : "bg-white/10 text-white/75"}`}>
                  Best Move
                </span>
                {selectedPreference && (
                  <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.18em] text-emerald-100 border border-emerald-400/30">
                    {selectedPreference}
                  </span>
                )}
                <p className={`text-[9px] uppercase tracking-[0.25em] ${isDay ? "text-slate-500" : "text-white/45"}`}>
                  {recommendationLoading ? "Reading tonight" : "Tonight’s best move"}
                </p>
              </div>
              <p className={`mt-1 text-xs leading-4 ${isDay ? "text-slate-700" : "text-white/90"}`}>
                {recommendationLoading
                  ? "Reading tonight’s best moves."
                  : recommendationVenue ? (
                      <>
                        <span className={isDay ? "font-semibold text-slate-950" : "font-semibold text-white"}>
                          {recommendationVenue}
                        </span>
                        {" — "}
                        {recommendation}
                      </>
                    ) : (
                      recommendation
                    )}
              </p>

              {!recommendationLoading && recommendationReasons.length > 0 && (
                <div className={`mt-2 rounded-2xl border px-3 py-2 ${isDay ? "border-slate-200 bg-slate-50/90" : "border-white/10 bg-black/20"}`}>
                  <p className={`text-[9px] font-black uppercase tracking-[0.22em] ${isDay ? "text-slate-500" : "text-white/45"}`}>
                    Why this recommendation
                  </p>
                  <div className="mt-2 grid gap-1.5">
                    {recommendationReasons.map((reason, index) => (
                      <div key={`${reason}-${index}`} className="flex items-start gap-2">
                        <span className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-[9px] font-black text-emerald-300 ring-1 ring-emerald-300/20">
                          {index + 1}
                        </span>
                        <p className={`text-[11px] leading-4 ${isDay ? "text-slate-600" : "text-white/70"}`}>
                          {reason}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className={`mt-2 flex items-center gap-2 rounded-xl border px-2 py-1.5 ${isDay ? "border-slate-300/70 bg-white/80" : "border-white/10 bg-white/[0.08]"}`}>
            <Search size={14} className={isDay ? "text-slate-500" : "text-white/50"} />
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSelected(null);
                setSheetExpanded(true);
              }}
              placeholder="Search DJ, genre, event, age..."
              className={`w-full bg-transparent text-xs outline-none ${isDay ? "text-slate-950 placeholder:text-slate-500" : "text-white placeholder:text-white/35"}`}
            />
          </div>

          <div className="relative z-50 mt-2 space-y-2">
            <div className="relative">
              <div className={`pointer-events-none absolute left-0 top-0 z-10 h-full w-8 rounded-l-xl bg-gradient-to-r ${isDay ? "from-white/95 to-transparent" : "from-black/85 to-transparent"}`} />
              <div className={`pointer-events-none absolute right-0 top-0 z-10 h-full w-10 rounded-r-xl bg-gradient-to-l ${isDay ? "from-white/95 to-transparent" : "from-black/85 to-transparent"}`} />

              <div className="flex gap-1.5 overflow-x-auto scroll-smooth pb-1 pl-1 pr-10 no-scrollbar snap-x snap-mandatory">
                {primaryChips.map((chip) => (
                  <button
                    key={chip.label}
                    onClick={() => handleChipClick(chip)}
                    className={`${chip.label === "All" ? "all-chip-button " : ""}snap-start shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-sm font-black transition active:scale-95 sm:px-3 sm:py-1.5 sm:text-xs ${
                      activeChip === chip.label
                        ? isDay
                          ? "border-slate-950 bg-slate-950 text-white shadow-sm"
                          : "border-white bg-white text-black shadow-[0_0_18px_rgba(255,255,255,0.18)]"
                        : isDay
                          ? "border-slate-300/70 bg-slate-900/5 text-slate-700 hover:bg-slate-900/10"
                          : "border-white/10 bg-white/10 text-white/75 hover:bg-white/15"
                    }`}
                  >
                    {chip.label}
                  </button>
                ))}

                <button
                  onClick={() => setChipsExpanded((current) => !current)}
                  className={`snap-start shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-sm font-black transition active:scale-95 sm:px-3 sm:py-1.5 sm:text-xs ${
                    chipsExpanded
                      ? isDay
                        ? "border-orange-500/40 bg-orange-500/15 text-orange-700"
                        : "border-orange-400/30 bg-orange-500/20 text-orange-100"
                      : isDay
                        ? "border-slate-300/70 bg-white/70 text-slate-700 hover:bg-slate-100"
                        : "border-white/10 bg-white/10 text-white/75 hover:bg-white/15"
                  }`}
                >
                  {chipsExpanded ? "Less" : "More"}
                  <span className="ml-1">{chipsExpanded ? "−" : "+"}</span>
                </button>
              </div>
            </div>

            {chipsExpanded && (
              <div className="relative z-50 grid grid-cols-2 gap-1.5 rounded-2xl pb-1 backdrop-blur-xl sm:grid-cols-4 lg:grid-cols-6">
                {moreChips.map((chip) => (
                  <button
                    key={chip.label}
                    onClick={() => handleChipClick(chip)}
                    className={`whitespace-nowrap rounded-2xl border px-3 py-2 text-left text-xs font-black transition active:scale-[0.98] ${
                      activeChip === chip.label
                        ? isDay
                          ? "border-slate-950 bg-slate-950 text-white"
                          : "border-white bg-white text-black"
                        : isDay
                          ? "border-slate-300/70 bg-white/70 text-slate-700 hover:bg-slate-100"
                          : "border-white/10 bg-white/10 text-white/75 hover:bg-white/15"
                    }`}
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className={`mt-2 grid grid-cols-2 gap-1 rounded-xl p-0.5 ${isDay ? "bg-slate-200/80" : "bg-white/[0.08]"}`}>
            <button
              onClick={() => {
                setViewMode("map");
                setSelected(null);
              }}
              className={`rounded-lg py-1.5 text-xs font-black transition ${
                viewMode === "map"
                  ? isDay
                    ? "bg-white text-slate-950 shadow-sm"
                    : "bg-white text-black"
                  : isDay
                    ? "text-slate-600 hover:text-slate-950"
                    : "text-white/60"
              }`}
            >
              Map
            </button>

            <button
              onClick={() => {
                setViewMode("events");
                setSelected(null);
                setSheetExpanded(true);
              }}
              className={`rounded-lg py-1.5 text-xs font-black transition ${
                viewMode === "events"
                  ? isDay
                    ? "bg-white text-slate-950 shadow-sm"
                    : "bg-white text-black"
                  : isDay
                    ? "text-slate-600 hover:text-slate-950"
                    : "text-white/60"
              }`}
            >
              Events
            </button>
          </div>
        </div>
      </div>

      {liveActivityTickerItems.length > 0 && !selected && viewMode === "map" && (
        <div className="pointer-events-none absolute inset-x-0 top-[478px] z-40 px-3 sm:top-[478px] sm:px-4 lg:left-[300px] lg:right-[240px]">
          <div
            className={`lit-desktop-ticker lit-mobile-ticker pointer-events-auto overflow-hidden rounded-full border shadow-2xl backdrop-blur-2xl ${
              isDay
                ? "border-white/75 bg-white/90 text-slate-950 shadow-slate-900/10"
                : "border-orange-300/15 bg-black/75 text-white shadow-orange-500/10"
            }`}
          >
            <div className="flex items-center overflow-hidden">
              <div className={`z-10 flex shrink-0 items-center gap-2 self-stretch border-r px-3 py-2 ${isDay ? "border-slate-200/70 bg-white/95" : "border-white/10 bg-black/85"}`}>
                <span className="h-1.5 w-1.5 rounded-full bg-orange-400 live-pulse" />
                <span className={`text-[9px] font-black uppercase tracking-[0.24em] ${isDay ? "text-orange-700" : "text-orange-200"}`}>
                  Tonight
                </span>
              </div>

              <div className="relative min-w-0 flex-1 overflow-hidden py-2">
                <div className={`pointer-events-none absolute left-0 top-0 z-10 h-full w-8 bg-gradient-to-r ${isDay ? "from-white/95" : "from-black/90"} to-transparent`} />
                <div className={`pointer-events-none absolute right-0 top-0 z-10 h-full w-8 bg-gradient-to-l ${isDay ? "from-white/95" : "from-black/90"} to-transparent`} />

                <div className="lit-desktop-ticker-track lit-mobile-ticker-track flex w-max items-center gap-5 px-4">
                  {[...liveActivityTickerItems, ...liveActivityTickerItems, ...liveActivityTickerItems, ...liveActivityTickerItems].map((item, index) => {
                    const venue = item.venue || null;

                    return (
                      <button
                        key={`live-activity-ticker-${item.id}-${index}`}
                        type="button"
                        disabled={!venue}
                        onClick={() => {
                          if (!venue) return;
                          setSelected(venue);
                          setSheetExpanded(true);
                          setViewMode("map");
                          spotlightActivityVenue(venue.id);
                          if (map && venue.lng && venue.lat) {
                            map.flyTo({ center: [venue.lng, venue.lat], zoom: Math.max(map.getZoom(), 14), duration: 850 });
                          }
                        }}
                        className="flex shrink-0 items-center gap-2 whitespace-nowrap text-left transition active:scale-[0.98] disabled:cursor-default"
                      >
                        <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-black ${tickerToneClasses(item.tone, isDay)}`}>
                          {tickerInitial(item.title)}
                        </span>
                        <span className="max-w-[150px] truncate text-[12px] font-black sm:max-w-[210px] sm:text-[13px]">
                          {item.title}
                        </span>
                        <span className={`${isDay ? "text-slate-500" : "text-white/45"}`}>·</span>
                        <span className={`max-w-[220px] truncate text-[11px] font-bold sm:max-w-[320px] ${isDay ? "text-slate-600" : "text-white/65"}`}>
                          {item.detail}
                        </span>
                        <span className="text-orange-300/70">•</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {todayMoves.length > 0 && !selected && viewMode === "map" && (
        <div className="pointer-events-none absolute inset-x-0 top-[390px] z-30 px-3 sm:top-[390px] sm:px-4 lg:left-[300px] lg:right-[240px]">
          <div className="pointer-events-auto overflow-x-auto rounded-[28px]">
            <div className="flex w-max min-w-full gap-2 pb-1">
              {todayMoves.map((move) => (
                <button
                  key={move.id}
                  type="button"
                  onClick={() => {
                    setSelected(move.venue);
                    setSheetExpanded(true);
                    setViewMode("map");
                    spotlightActivityVenue(move.venue.id);
                    if (map && move.venue.lng && move.venue.lat) {
                      map.flyTo({
                        center: [move.venue.lng, move.venue.lat],
                        zoom: Math.max(map.getZoom(), 14),
                        duration: 850,
                      });
                    }
                  }}
                  className={`group min-w-[186px] max-w-[220px] rounded-[24px] border p-3 text-left shadow-2xl backdrop-blur-2xl transition hover:-translate-y-0.5 active:scale-[0.98] ${
                    isDay
                      ? "border-white/75 bg-white/88 text-slate-950 shadow-slate-900/10"
                      : "border-white/10 bg-black/62 text-white shadow-black/30"
                  }`}
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className={`rounded-full px-2 py-1 text-[9px] font-black uppercase tracking-[0.18em] ${tickerToneClasses(move.tone, isDay)}`}>
                      {move.label}
                    </span>
                    <span className={`text-[11px] font-black ${isDay ? "text-slate-500" : "text-white/45"}`}>
                      {move.score}
                    </span>
                  </div>

                  <div className="truncate text-sm font-black tracking-tight">
                    {move.venue.name}
                  </div>

                  <div className={`mt-1 line-clamp-2 text-[11px] font-semibold leading-snug ${isDay ? "text-slate-600" : "text-white/58"}`}>
                    {move.detail}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="fixed bottom-12 right-4 z-[99999] flex flex-col items-end gap-1.5 sm:bottom-14 sm:right-5 sm:gap-2">
        <button
          onClick={() => {
            if (!map) return;

            if (!navigator.geolocation) {
              console.error("Geolocation unavailable");
              map.flyTo({ center: [-76.2859, 36.8508], zoom: 10 });
              return;
            }

            navigator.geolocation.getCurrentPosition(
              (position) => {
                const { longitude, latitude, accuracy } = position.coords;
                if (!map) return;

                map.flyTo({
                  center: [longitude, latitude],
                  zoom: 15,
                  duration: 900,
                  essential: true,
                });

                userLocationMarkerRef.current?.remove();

                const markerEl = document.createElement("div");
                markerEl.className = "user-location-marker";
                markerEl.style.pointerEvents = "none";
                markerEl.style.width = "42px";
                markerEl.style.height = "42px";

                const label = document.createElement("div");
                label.className = "user-location-label";
                label.textContent = accuracy && accuracy > 100 ? "Approx" : "You";

                const pulse = document.createElement("div");
                pulse.className = "user-location-pulse";

                const dot = document.createElement("div");
                dot.className = "user-location-dot";

                markerEl.appendChild(label);
                markerEl.appendChild(pulse);
                markerEl.appendChild(dot);

                userLocationMarkerRef.current = new mapboxgl.Marker({
                  element: markerEl,
                  anchor: "center",
                })
                  .setLngLat([longitude, latitude])
                  .addTo(map);
              },
              (error) => {
                console.error("Geolocation error:", error);
                map.flyTo({ center: [-76.2859, 36.8508], zoom: 10 });
              },
              { enableHighAccuracy: true, timeout: 12000, maximumAge: 15000 }
            );
          }}
          className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-black/55 text-white shadow-[0_8px_30px_rgba(0,0,0,0.45)] backdrop-blur-2xl transition hover:bg-black/70 active:scale-95"
          aria-label="Use my location"
          title="Use my location"
        >
          <LocateFixed size={18} />
        </button>

        <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/55 shadow-[0_8px_30px_rgba(0,0,0,0.45)] backdrop-blur-2xl">
          <button
            onClick={() => smoothZoom("in")}
            className="flex h-10 w-11 items-center justify-center border-b border-white/10 text-lg font-black text-white transition hover:bg-white/10 active:scale-95"
            aria-label="Zoom in"
          >
            +
          </button>
          <div className="flex h-6 w-11 items-center justify-center border-b border-white/10 bg-white/5 text-[9px] font-bold text-white/50">
            {currentZoom.toFixed(1)}
          </div>
          <button
            onClick={() => smoothZoom("out")}
            className="flex h-10 w-11 items-center justify-center text-xl font-black text-white transition hover:bg-white/10 active:scale-95"
            aria-label="Zoom out"
          >
            −
          </button>
        </div>

        <button
          onClick={switchMapMode}
          className={`flex min-w-[88px] items-center justify-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold shadow-[0_8px_30px_rgba(0,0,0,0.38)] backdrop-blur-2xl transition ${
            mapMode === "day"
              ? "border-sky-300/40 bg-white/75 text-slate-950"
              : "border-violet-300/20 bg-black/55 text-white"
          }`}
          aria-label="Toggle day night map mode"
        >
          <span>{mapMode === "day" ? "" : ""}</span>
          <span>{mapMode === "day" ? "Day" : "Night"}</span>
        </button>

        <button
          onClick={() => {
            const nextValue = !heatmapEnabled;
            setHeatmapEnabled(nextValue);
            if (map?.getLayer("venue-heat-layer")) {
              map.setLayoutProperty(
                "venue-heat-layer",
                "visibility",
                nextValue ? "visible" : "none"
              );
              console.log(
                "heatmap control clicked: visibility",
                nextValue ? "visible" : "none"
              );
            }
          }}
          className={`flex min-w-[88px] items-center justify-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold shadow-[0_8px_30px_rgba(0,0,0,0.38)] backdrop-blur-2xl transition ${
            heatmapEnabled
              ? "border-orange-400 bg-orange-500/15 text-orange-100"
              : "border-white/10 bg-white/5 text-white/65"
          }`}
          aria-pressed={heatmapEnabled}
        >
          <span>Heat</span>
          <span className="inline-flex h-6 min-w-[32px] items-center justify-center rounded-full bg-white/10 text-[10px] uppercase tracking-[0.24em]">
            {heatmapEnabled ? "On" : "Off"}
          </span>
        </button>

        <button
          onClick={handleAskVoice}
          className={`flex h-11 min-w-[88px] items-center justify-center rounded-full border px-3 py-2 text-sm font-semibold text-white shadow-[0_8px_30px_rgba(0,0,0,0.38)] backdrop-blur-2xl transition hover:bg-white/10 ${
            voiceStatus !== "idle"
              ? "border-emerald-300/40 bg-emerald-500/15 shadow-[0_0_24px_rgba(16,185,129,0.18)]"
              : "border-white/10 bg-white/5"
          }`}
          aria-label="Ask voice concierge"
        >
          {voiceStatus === "listening"
            ? " Listening"
            : voiceStatus === "thinking"
            ? " Thinking"
            : voiceStatus === "speaking"
            ? " Speaking"
            : " Ask"}
        </button>

        {voiceBubbleOpen && (
          <div className="w-64 rounded-3xl border border-white/10 bg-black/80 p-3 text-left shadow-2xl backdrop-blur-2xl">
            <div className="mb-2 flex items-start justify-between gap-3">
              <div>
                <p className="text-[9px] font-bold uppercase tracking-[0.24em] text-emerald-300/80">
                  Lit757 Concierge
                </p>
                <p className="mt-1 text-xs font-black text-white">
                  {voiceStatus === "listening"
                    ? "Listening..."
                    : voiceStatus === "thinking"
                    ? "Finding your best move..."
                    : voiceStatus === "speaking"
                    ? "Speaking..."
                    : "Ready"}
                </p>
              </div>
              <button
                onClick={() => {
                  setVoiceBubbleOpen(false);
                  setVoiceStatus("idle");
                  if (typeof window !== "undefined") window.speechSynthesis?.cancel();
                }}
                className="rounded-full bg-white/10 p-1.5 text-white/70 transition hover:bg-white/15"
                aria-label="Close voice concierge"
              >
                <X size={14} />
              </button>
            </div>

            {voiceTranscript && (
              <div className="mb-2 rounded-2xl bg-white/5 p-2">
                <p className="text-[9px] uppercase tracking-[0.2em] text-white/35">You asked</p>
                <p className="mt-1 text-xs text-white/80">{voiceTranscript}</p>
              </div>
            )}

            {recommendation && (
              <div className="rounded-2xl bg-emerald-500/10 p-2 ring-1 ring-emerald-300/10">
                <p className="text-[9px] uppercase tracking-[0.2em] text-emerald-200/60">The move</p>
                <p className="mt-1 text-xs leading-4 text-white/85">
                  {recommendationVenue ? `${recommendationVenue} — ` : ""}
                  {recommendation}
                </p>
                {recommendationReasons.length > 0 && (
                  <div className="mt-2 rounded-xl bg-black/20 p-2 ring-1 ring-white/10">
                    <p className="text-[9px] font-black uppercase tracking-[0.2em] text-emerald-200/60">
                      Why
                    </p>
                    <ul className="mt-1 space-y-1 text-[11px] leading-4 text-white/70">
                      {recommendationReasons.slice(0, 3).map((reason, index) => (
                        <li key={`${reason}-${index}`}>• {reason}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {navigationActive && viewMode === "map" && (
        <div className="absolute bottom-20 left-3 right-3 z-30 sm:bottom-24 sm:left-3 sm:right-auto sm:max-w-md">
          <div className="overflow-hidden rounded-[2rem] border border-orange-300/20 bg-black/85 shadow-2xl shadow-orange-500/20 backdrop-blur-3xl">
            <div className="border-b border-white/10 bg-gradient-to-r from-orange-500/20 via-red-500/10 to-fuchsia-500/10 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.28em] text-orange-300">
                    Live route
                  </p>
                  <h3 className="mt-1 text-lg font-black text-white">
                    {navigationActive.venueName}
                  </h3>
                  <p className="mt-1 text-xs font-semibold text-white/65">
                    {navigationActive.distanceMiles.toFixed(1)} mi • about {navigationActive.durationMinutes} min
                  </p>
                </div>
                <button
                  onClick={clearInAppNavigation}
                  className="rounded-full border border-white/10 bg-white/10 p-2 text-white/70 transition hover:bg-white/15"
                  aria-label="End navigation"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            <div className="max-h-44 overflow-y-auto p-3">
              {navigationActive.steps.slice(0, 4).map((step, index) => (
                <div
                  key={`${step.instruction}-${index}`}
                  className="mb-2 rounded-2xl border border-white/10 bg-white/[0.06] px-3 py-2 last:mb-0"
                >
                  <p className="text-xs font-bold leading-4 text-white">
                    {index + 1}. {step.instruction}
                  </p>
                  <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/40">
                    {(step.distance / 1609.344).toFixed(1)} mi
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div
        className={`absolute inset-x-0 bottom-0 z-30 px-3 sm:left-3 sm:right-3 sm:px-0 ${!selected && viewMode === "map" && activeChip === "All" && !query.trim() ? "hidden" : ""}`}
        onTouchStart={(e) => {
          touchStartY.current = e.touches[0].clientY;
        }}
        onTouchEnd={handleTouchEnd}
      >
        <div
          className={`transition-all duration-300 select-none ${
            selected
              ? "max-h-[84vh] overflow-visible rounded-t-[2rem] border border-white/5 bg-black/35 p-4 shadow-[0_-18px_90px_rgba(0,0,0,0.45)] backdrop-blur-xl sm:max-h-[82vh] sm:p-5 lg:px-8 lg:pb-6"
              : sheetExpanded
              ? "max-h-[45vh] overflow-y-auto rounded-t-[1.65rem] border border-white/10 bg-zinc-950/95 p-3 shadow-[0_-18px_80px_rgba(0,0,0,0.55)] backdrop-blur-3xl sm:max-h-[48vh] sm:rounded-t-[2rem]"
              : "max-h-[12vh] overflow-y-auto rounded-t-[1.65rem] border border-white/10 bg-zinc-950/95 p-3 shadow-[0_-18px_80px_rgba(0,0,0,0.55)] backdrop-blur-3xl sm:max-h-[14vh] sm:rounded-t-[2rem]"
          }`}
        >
          <button
            onClick={() => setSheetExpanded((prev) => !prev)}
            className={selected ? "mx-auto mb-4 flex h-6 w-24 items-center justify-center rounded-full text-white/50" : "mx-auto mb-3 flex h-6 w-20 items-center justify-center rounded-full text-white/50"}
          >
            <div className="h-1 w-12 rounded-full bg-white/20" />
          </button>

          {!selected ? (
            <>
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-black">
                    {viewMode === "events"
                      ? "Events Tonight"
                      : query || activeChip !== "All"
                      ? "Matching Spots"
                      : "Live Spots"}
                  </h2>
                  <p className="text-xs text-white/45">
                    {venuesLoading
                      ? "Loading live spots..."
                      : viewMode === "events"
                      ? `${eventTabItems.length} events found`
                      : `${filteredVenues.length} spots found`}
                  </p>
                </div>

                <button
                  onClick={() => setSheetExpanded((prev) => !prev)}
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10"
                >
                  {sheetExpanded ? <X size={18} /> : <ChevronUp size={20} />}
                </button>
              </div>

              {venuesLoading && venues.length === 0 ? (
                <div className="space-y-3">
                  {[0, 1, 2].map((item) => (
                    <div
                      key={`spot-skeleton-${item}`}
                      className="relative overflow-hidden rounded-[1.75rem] border border-white/10 bg-white/[0.055] p-3 skeleton-shimmer"
                    >
                      <div className="flex gap-3">
                        <div className="h-24 w-24 shrink-0 rounded-[1.35rem] bg-white/10 sm:h-28 sm:w-32" />
                        <div className="min-w-0 flex-1 py-1">
                          <div className="h-4 w-2/3 rounded-full bg-white/10" />
                          <div className="mt-2 h-3 w-1/2 rounded-full bg-white/10" />
                          <div className="mt-4 h-2 w-full rounded-full bg-white/10" />
                          <div className="mt-4 flex gap-2">
                            <div className="h-6 w-20 rounded-full bg-white/10" />
                            <div className="h-6 w-24 rounded-full bg-white/10" />
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : viewMode === "events" ? (
                <div className="space-y-2">
                  {eventTabItems.map(({ event, venue }) => (
                    <button
                      key={event.id || event.source_event_id || `${event.title}-${event.venue_name}`}
                      onClick={() => {
                        if (!venue) return;
                        setSelected(venue);
                        setSheetExpanded(true);
                        setViewMode("map");
                        if (venue.lng && venue.lat) {
                          map?.flyTo({
                            center: [venue.lng, venue.lat],
                            zoom: 14,
                          });
                        }
                      }}
                      className="w-full rounded-2xl bg-white/[0.07] p-4 text-left active:scale-[0.99]"
                    >
                      <div className="mb-2 flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-black">
                            {event.title || event.name}
                          </p>
                          <p className="text-xs text-white/45">
                            {venue ? `${venue.name} • ${venue.city}` : event.venue_name || "Event venue TBA"}
                          </p>
                        </div>

                        <p className="shrink-0 text-xs font-black uppercase tracking-[0.18em] text-cyan-200">
                          {event.source || "event"}
                        </p>
                      </div>

                      <div className="rounded-xl bg-black/30 p-3 text-xs text-white/55">
                        <p>
                          {event.starts_at_label || "Time TBA"}
                          {event.ticket_status ? ` • ${event.ticket_status}` : ""}
                        </p>

                        <p className="mt-1">
                          {event.genre || "Event"}
                          {event.source_url ? " • Source link saved" : ""}
                        </p>

                        <p className="mt-1 text-white/40">
                          {venue
                            ? "Tap to view the venue pin on the map."
                            : "This event is listed, but it has not matched a venue pin yet."}
                        </p>
                      </div>
                    </button>
                  ))}

                  {eventTabItems.length === 0 && (
                    <div className="rounded-2xl bg-white/[0.07] p-4 text-sm text-white/50">
                      No events match this filter yet.
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  {visibleTopSpots.map((venue, index) => {
                    const photoUrl = (venue as any).photo_url as string | undefined;
                    const signalCount = (venue.voteCount || 0) + (venue.updateCount || 0) + (venue.liveReportCount || 0);
                    const vibeIntensity = getVibeIntensity(venue);
                    const cardReason = venue.vibeReason || venue.momentumLabel || energyLabel(venue.energyLevel);
                    const eventLine = venue.tonightEvent
                      ? `${venue.tonightEvent.title}${venue.tonightEvent.dj ? ` • ${venue.tonightEvent.dj}` : ""}`
                      : `${venue.music_genre || "Mixed music"} • ${venue.age_limit || "21+"}`;

                    return (
                      <button
                        key={venue.id}
                        onClick={() => {
                          setSelected(venue);
                          setSheetExpanded(true);
                          spotlightActivityVenue(venue.id);
                          map?.flyTo({
                            center: [venue.lng, venue.lat],
                            zoom: 14,
                          });
                        }}
                        className="group relative w-full overflow-hidden rounded-[1.75rem] border border-white/10 bg-white/[0.055] text-left shadow-2xl shadow-black/30 transition duration-300 hover:-translate-y-0.5 hover:border-orange-300/40 hover:bg-white/[0.075] active:scale-[0.99]"
                      >
                        <div
                          className="absolute inset-0 opacity-80"
                          style={{
                            background: `radial-gradient(circle at 18% 0%, ${energyColor(venue.energyLevel)}2f, transparent 32%), linear-gradient(135deg, rgba(255,255,255,0.09), rgba(255,255,255,0.015))`,
                          }}
                        />

                        <div className="relative flex gap-3 p-3">
                          <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-[1.35rem] bg-white/10 sm:h-28 sm:w-32">
                            {photoUrl ? (
                              <img
                                src={photoUrl}
                                alt={venue.name}
                                className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                              />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-zinc-800 via-zinc-900 to-black text-2xl">
                                
                              </div>
                            )}
                            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
                            <div className="absolute left-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-black text-white backdrop-blur-xl">
                              #{index + 1}
                            </div>
                          </div>

                          <div className="min-w-0 flex-1 py-0.5">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="truncate text-base font-black leading-tight text-white sm:text-lg">
                                  {venue.name}
                                </p>
                                <p className="mt-1 truncate text-[11px] font-medium text-white/55">
                                  {eventLine}
                                </p>
                              </div>

                              <div className="shrink-0 text-right">
                                <p className="text-lg font-black leading-none text-white">
                                  {vibeIntensity}
                                </p>
                                <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-white/40">
                                  vibe
                                </p>
                              </div>
                            </div>

                            <div className="mt-3 h-2 overflow-hidden rounded-full bg-black/35 ring-1 ring-white/10">
                              <div
                                className="h-full rounded-full bg-gradient-to-r from-orange-500 via-amber-300 to-red-500 shadow-[0_0_18px_rgba(251,146,60,0.45)] transition-all"
                                style={{ width: `${vibeIntensity}%` }}
                              />
                            </div>

                            <div className="mt-3 flex flex-wrap items-center gap-1.5">
                              <span
                                className="rounded-full border px-2 py-1 text-[9px] font-black uppercase tracking-[0.14em] text-white"
                                style={{
                                  backgroundColor: `${energyColor(venue.energyLevel)}20`,
                                  borderColor: `${energyColor(venue.energyLevel)}80`,
                                }}
                              >
                                {statusLabel(venue.status)}
                              </span>
                              <span className="rounded-full bg-white/10 px-2 py-1 text-[9px] font-bold uppercase tracking-[0.14em] text-white/70">
                                {activityPhrase(venue)}
                              </span>
                              <span className="rounded-full bg-white/10 px-2 py-1 text-[9px] font-bold uppercase tracking-[0.14em] text-white/70">
                                {vibeTrendLabel(venue.vibeTrend)}
                              </span>
                            </div>

                            <p className="mt-2 line-clamp-2 text-[11px] leading-4 text-white/50">
                              {cardReason}
                            </p>
                          </div>
                        </div>
                      </button>
                    );
                  })}

                  {visibleTopSpots.length === 0 && (
                    <div className="rounded-2xl bg-white/[0.07] p-4 text-sm text-white/50">
                      No spots match that yet.
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <>
              {(() => {
                const liveSignalCount =
                  (selected.voteCount || 0) +
                  (selected.updateCount || 0) +
                  (selected.liveReportCount || 0);
                const heroUrl =
                  selectedVenueHeroPhoto?.url ||
                  ((selected as any).photo_url as string | undefined) ||
                  ((selected as any).venue_photo_url as string | undefined) ||
                  ((selected as any).image_url as string | undefined) ||
                  null;
                const phoneNumber =
                  (selected as any).phone ||
                  (selected as any).phone_number ||
                  (selected as any).formatted_phone_number ||
                  null;
                const phoneHref = phoneNumber
                  ? `tel:${String(phoneNumber).replace(/[^+0-9]/g, "")}`
                  : undefined;
                const score = clampScore(selected.vibeScore ?? selected.score ?? selected.aiScore ?? 0);
                const websiteUrl = (selected as any).website || (selected as any).url || selectedPrimaryEventUrl || null;
                const hoursText =
                  (selected as any).hours ||
                  (selected as any).opening_hours ||
                  (selected as any).hours_text ||
                  null;
                const addressText = selected.address || selected.city || "757";
                const rawAiLine =
                  selected.aiSummary ||
                  selected.vibeReason ||
                  getPrimaryLitReason(selected) ||
                  "Still early here tonight.";
                const aiLine = /local signal|confirmed crowd activity|unless votes|event energy/i.test(rawAiLine)
                  ? score >= 70
                    ? `${selected.name} looks active tonight. This could be one of the better moves tonight.`
                    : score >= 40
                    ? `${selected.name} has some momentum, and could keep building as the night moves.`
                    : `${selected.name} looks quiet right now. Could pick up later if the night shifts.`
                  : rawAiLine;
                const activeLabel =
                  selected.status === "lit"
                    ? "Active right now"
                    : selected.status === "decent"
                    ? "Warming up"
                    : "Quiet right now";
                const actionReport = () => {
                  setSuggestionType("Vibe");
                  setSuggestionOpen(true);
                  setSuggestionStatus(null);
                  setSuggestionFeedback("");
                };
                const quickOptions: LiveReportOption[] = [
                  { label: "🔥 Active", type: "crowd", value: "packed", tone: "hot" },
                  { label: "✨ Good Energy", type: "vibe", value: "decent", tone: "watch" },
                  { label: "😴 Slow", type: "vibe", value: "dead", tone: "quiet" },
                ];
                const readConfidence =
                  selected.confidence === "high"
                    ? "Strong read"
                    : selected.confidence === "medium"
                    ? "Good read"
                    : liveSignalCount > 0 || selected.tonightEvent
                    ? "Warming up"
                    : "Still early";
                const liveActivityItems = [
                  selected.tonightEvent
                    ? `${selected.tonightEvent.title || selected.tonightEvent.name || "Event tonight"} · ${selected.tonightEvent.starts_at_label || "Time TBA"}`
                    : null,
                  selected.reportSummary || null,
                  liveSignalCount > 0
                    ? "The spot is starting to move"
                    : "Be first to call the vibe",
                ].filter(Boolean) as string[];

                return (
                  <div className="mx-auto w-full max-w-[390px] overflow-hidden rounded-[2.75rem] border border-white/10 bg-[#0b0b0c]/95 text-white shadow-[0_30px_120px_rgba(0,0,0,0.85)] backdrop-blur-3xl min-[560px]:max-w-[92vw] xl:max-w-[1480px] min-[560px]:rounded-[2.25rem] min-[560px]:border-white/12">
                    {(suggestionStatus && suggestionFeedback) || (eventStatus && eventFeedback) || shareFeedback || liveReportFeedback || navigationError ? (
                      <div className="space-y-2 border-b border-white/10 bg-black/40 px-5 py-3 lg:px-6">
                        {suggestionStatus && suggestionFeedback && (
                          <div
                            className={`rounded-2xl border px-3 py-2 text-xs font-semibold ${
                              suggestionStatus === "success"
                                ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-100"
                                : "border-rose-400/20 bg-rose-500/10 text-rose-100"
                            }`}
                          >
                            {suggestionFeedback}
                          </div>
                        )}
                        {eventStatus && eventFeedback && (
                          <div
                            className={`rounded-2xl border px-3 py-2 text-xs font-semibold ${
                              eventStatus === "success"
                                ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-100"
                                : "border-rose-400/20 bg-rose-500/10 text-rose-100"
                            }`}
                          >
                            {eventFeedback}
                          </div>
                        )}
                        {shareFeedback && (
                          <div className="rounded-2xl border border-sky-300/20 bg-sky-500/10 px-3 py-2 text-xs font-semibold text-sky-100">
                            {shareFeedback}
                          </div>
                        )}
                        {liveReportFeedback && (
                          <div className="rounded-2xl border border-emerald-300/20 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-100">
                            {liveReportFeedback}
                          </div>
                        )}
                        {navigationError && (
                          <div className="rounded-2xl border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-100">
                            {navigationError}
                          </div>
                        )}
                      </div>
                    ) : null}

                    <div className="min-[560px]:grid min-[560px]:min-h-[420px] min-[560px]:grid-cols-[minmax(280px,0.92fr)_1fr] lg:min-h-[560px] lg:grid-cols-[minmax(540px,680px)_1fr] xl:min-h-[610px] xl:grid-cols-[minmax(620px,760px)_1fr]">
                      <div className="relative flex h-[200px] flex-col justify-end overflow-hidden bg-[linear-gradient(135deg,#1a0a0a_0%,#060606_100%)] px-5 pb-4 min-[560px]:h-auto min-[560px]:min-h-[420px] min-[560px]:px-7 min-[560px]:pb-7 lg:min-h-[560px] lg:px-10 lg:pb-10 xl:min-h-[610px] xl:px-12 xl:pb-12">
                        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_30%_60%,rgba(239,68,68,0.28)_0%,transparent_62%),radial-gradient(ellipse_at_80%_20%,rgba(251,146,60,0.12)_0%,transparent_55%)]" />
                        {heroUrl && (
                          <img
                            src={heroUrl}
                            alt=""
                            className="absolute inset-0 h-full w-full object-cover opacity-[0.34] mix-blend-screen lg:opacity-[0.46]"
                            aria-hidden="true"
                          />
                        )}
                        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/45 to-black/10" />
                        <button
                          onClick={() => {
                            setSelected(null);
                            setSheetExpanded(false);
                          }}
                          className="absolute right-4 top-4 z-20 flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/10 text-white/70 backdrop-blur-xl transition hover:bg-white/15 hover:text-white min-[560px]:h-9 min-[560px]:w-9 lg:h-10 lg:w-10"
                          aria-label="Close venue"
                        >
                          <X size={16} />
                        </button>

                        <div className="relative z-10">
                          <div className="mb-1.5 flex items-baseline gap-1 min-[560px]:mb-2 lg:mb-3">
                            <span className="text-[42px] font-semibold leading-none text-white min-[560px]:text-[64px] lg:text-[86px]">
                              {score}
                            </span>
                            <span className="text-xs uppercase tracking-[0.12em] text-white/45 min-[560px]:text-xs lg:text-sm">
                              / 100 vibe
                            </span>
                          </div>

                          <h2 className="text-[24px] font-semibold leading-[1.05] tracking-tight text-white min-[560px]:text-4xl min-[560px]:font-bold lg:text-6xl lg:font-bold">
                            {selected.name}
                          </h2>
                          <p className="mt-1 text-[13px] text-white/45 lg:mt-3 min-[560px]:text-xs lg:text-sm">
                            {selected.city || "757"} · {venueType(selected)}
                          </p>

                          <div className="mt-4 hidden max-w-sm rounded-2xl border border-white/10 bg-black/25 px-4 py-3 backdrop-blur-xl min-[560px]:block lg:block">
                            <p className="text-[10px] uppercase tracking-[0.18em] text-white/35">Tonight</p>
                            <p className="mt-1 text-lg font-semibold text-white">{activeLabel}</p>
                            <p className="mt-1 text-sm leading-5 text-white/55">Tonight · {selected.city || "757"}</p>
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-col min-[560px]:p-5 lg:p-7 xl:p-8">
                        <div className="mx-5 pt-3.5 min-[560px]:mx-0 min-[560px]:pt-0">
                          <div className="h-1 overflow-hidden rounded-full bg-white/[0.08]">
                            <div
                              className="h-full rounded-full bg-red-500 transition-all"
                              style={{ width: `${Math.max(5, score)}%` }}
                            />
                          </div>
                          <div className="mt-1.5 flex justify-between text-[11px] text-white/30">
                            <span className={score < 36 ? "text-red-400" : ""}>Dead</span>
                            <span className={score >= 36 && score < 75 ? "text-red-400" : ""}>Heating up</span>
                            <span className={score >= 75 ? "text-red-400" : ""}>Surging</span>
                          </div>
                        </div>

                        <div className="mx-5 mt-3.5 rounded-xl border border-red-500/20 bg-[linear-gradient(135deg,rgba(239,68,68,0.13),rgba(239,68,68,0.05))] px-3.5 py-3 shadow-[0_0_50px_rgba(239,68,68,0.08)] min-[560px]:mx-0 min-[560px]:mt-4 min-[560px]:rounded-2xl min-[560px]:px-4 min-[560px]:py-4 lg:mt-5 lg:rounded-3xl lg:px-6 lg:py-6">
                          <p className="mb-1.5 text-[10px] uppercase tracking-[0.16em] text-red-400/80 min-[560px]:text-[10px] lg:text-xs">
                            Tonight · {readConfidence}
                          </p>
                          <p className="text-[13px] leading-5 text-white/80 min-[560px]:text-sm min-[560px]:leading-6 min-[560px]:text-sm lg:text-base lg:leading-7">
                            {aiLine}
                          </p>
                        </div>

                        <div className="mx-5 mt-3 rounded-2xl border border-white/[0.07] bg-white/[0.035] px-3.5 py-3 min-[560px]:mx-0 min-[560px]:mt-4 lg:rounded-3xl lg:px-5 lg:py-4">
                          <div className="mb-2 flex items-center justify-between gap-3">
                            <p className="text-[10px] uppercase tracking-[0.16em] text-white/30">Tonight</p>
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-red-300">
                              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-400" />
                              live
                            </span>
                          </div>
                          <div className="space-y-1.5">
                            {liveActivityItems.slice(0, 3).map((item, index) => (
                              <div key={`${item}-${index}`} className="flex items-center gap-2 text-xs text-white/55 lg:text-sm">
                                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-white/25" />
                                <span className="truncate">{item}</span>
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="mx-5 mt-3.5 grid grid-cols-[1.35fr_1fr_1fr] gap-2 min-[560px]:mx-0 min-[560px]:mt-4 min-[560px]:gap-3 lg:mt-5">
                          <button
                            type="button"
                            onClick={startInAppNavigation}
                            disabled={navigationLoading}
                            className="flex flex-col items-center gap-1.5 rounded-[14px] border border-red-400/35 bg-[linear-gradient(135deg,rgba(239,68,68,0.28),rgba(249,115,22,0.18))] px-2 py-3 text-white shadow-[0_0_45px_rgba(239,68,68,0.16)] transition hover:scale-[1.01] hover:bg-red-500/25 disabled:cursor-not-allowed disabled:opacity-60 min-[560px]:rounded-2xl min-[560px]:py-5 lg:py-6"
                          >
                            <Navigation size={22} className="text-red-200" />
                            <span className="text-[11px] font-semibold text-red-50 min-[560px]:text-xs lg:text-sm">
                              {navigationLoading ? "Loading" : "Directions"}
                            </span>
                          </button>

                          <button
                            type="button"
                            onClick={shareSelectedVenue}
                            className="flex flex-col items-center gap-1.5 rounded-[14px] border border-white/10 bg-white/[0.05] px-2 py-3 text-white transition hover:bg-white/[0.08] min-[560px]:rounded-2xl min-[560px]:py-4 lg:py-5"
                          >
                            <Share2 size={20} className="text-white/70" />
                            <span className="text-[11px] text-white/55 min-[560px]:text-xs lg:text-sm">Share</span>
                          </button>

                          <button
                            type="button"
                            onClick={actionReport}
                            className="flex flex-col items-center gap-1.5 rounded-[14px] border border-white/10 bg-white/[0.05] px-2 py-3 text-white transition hover:bg-white/[0.08] min-[560px]:rounded-2xl min-[560px]:py-4 lg:py-5"
                          >
                            <span className="text-xl leading-none text-white/70">✦</span>
                            <span className="text-[11px] text-white/55 min-[560px]:text-xs lg:text-sm">Comment</span>
                          </button>
                        </div>

                        <div className="min-[560px]:grid min-[560px]:flex-1 min-[560px]:grid-cols-2 min-[560px]:gap-4">
                          {selected.tonightEvent && (
                            <div>
                              <div className="mx-5 mt-4 h-px bg-white/[0.06] min-[560px]:mx-0 min-[560px]:mt-4 lg:mt-5" />
                              <p className="mx-5 mb-2 mt-3.5 text-[10px] uppercase tracking-[0.16em] text-white/30 min-[560px]:mx-0 lg:mx-0">
                                Tonight&apos;s event
                              </p>
                              <div className="mx-5 flex items-center justify-between gap-2.5 rounded-[14px] border border-white/[0.08] bg-white/[0.04] px-3.5 py-3 min-[560px]:mx-0 lg:mx-0 min-[560px]:min-h-[86px] min-[560px]:rounded-2xl min-[560px]:px-4 min-[560px]:py-4 lg:min-h-[96px]">
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium text-white min-[560px]:text-sm lg:text-base">
                                    {selected.tonightEvent.title || selected.tonightEvent.name || "Tonight event"}
                                  </p>
                                  <p className="mt-1 truncate text-xs text-white/40 min-[560px]:text-xs lg:text-sm">
                                    {selected.tonightEvent.starts_at_label || "Time TBA"}
                                    {selected.tonightEvent.ticket_status ? ` · ${selected.tonightEvent.ticket_status}` : ""}
                                  </p>
                                </div>
                                {selectedPrimaryEventUrl && (
                                  <button
                                    type="button"
                                    onClick={() => window.open(selectedPrimaryEventUrl, "_blank")}
                                    className="shrink-0 rounded-full border border-orange-400/30 bg-orange-500/12 px-3.5 py-1.5 text-[11px] uppercase tracking-[0.1em] text-orange-300 transition hover:bg-orange-500/20"
                                  >
                                    Tickets
                                  </button>
                                )}
                              </div>
                            </div>
                          )}

                          <div className={selected.tonightEvent ? "" : "min-[560px]:col-span-2 lg:col-span-2"}>
                            <div className="mx-5 mt-4 h-px bg-white/[0.06] min-[560px]:mx-0 min-[560px]:mt-4 lg:mt-5" />
                            <div className="mx-5 mb-2 mt-3.5 flex items-center justify-between gap-3 min-[560px]:mx-0 lg:mx-0">
                              <p className="text-[10px] uppercase tracking-[0.16em] text-white/30">
                                What’s the vibe?
                              </p>
                              <p className="hidden text-xs text-white/30 min-[560px]:block lg:block">tap in</p>
                            </div>
                            <div className="mx-5 grid grid-cols-3 gap-2 min-[560px]:mx-0 lg:mx-0 min-[560px]:gap-3 lg:gap-3">
                              {quickOptions.map((option) => {
                                const optionClass =
                                  option.value === "packed"
                                    ? "bg-red-500/15 text-red-300 hover:bg-red-500/20"
                                    : option.value === "decent"
                                    ? "bg-orange-500/12 text-orange-300 hover:bg-orange-500/20"
                                    : "bg-slate-400/10 text-slate-300/80 hover:bg-slate-400/15";

                                return (
                                  <button
                                    key={`${option.type}-${option.value}`}
                                    type="button"
                                    onClick={() => submitLiveReport(option)}
                                    disabled={liveReportLoading}
                                    className={`rounded-[14px] px-2 py-3 text-center text-xs font-medium transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 min-[560px]:rounded-2xl min-[560px]:py-4 lg:py-5 min-[560px]:text-xs lg:text-sm ${optionClass}`}
                                  >
                                    {option.label}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        </div>

                        <div className="mx-5 mt-4 h-px bg-white/[0.06] min-[560px]:mx-0 min-[560px]:mt-4 lg:mt-5" />

                        <div className="mx-5 flex items-center gap-2 pb-6 pt-3.5 min-[560px]:mx-0 lg:mx-0 min-[560px]:pb-0 lg:pb-0">
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />
                          <p className="truncate text-xs text-white/35 min-[560px]:text-xs lg:text-sm">
                            Current vibe · {selected.city || "757"}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </>
          )}
        </div>
      </div>


      {venueDirectoryOpen && (
        <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/55 px-3 pb-4 pt-[17rem] backdrop-blur-sm sm:px-6 sm:pt-[18rem] lg:pt-[16rem]">
          <div className="venue-directory-panel w-full max-h-[calc(100vh-18.5rem)] max-w-3xl overflow-hidden rounded-[2rem] border border-white/15 bg-zinc-950/95 shadow-2xl shadow-black/60 backdrop-blur-3xl sm:max-h-[calc(100vh-19.5rem)] lg:max-h-[calc(100vh-17.5rem)]">
            <div className="sticky top-0 z-10 border-b border-white/10 bg-zinc-950/90 px-4 py-4 backdrop-blur-2xl sm:px-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.28em] text-orange-300">
                    Venue guide
                  </p>
                  <h3 className="mt-1 text-xl font-black text-white">
                    Find the move
                  </h3>
                  <p className="mt-1 text-xs text-white/45">
                    {filteredVenues.length} spots based on your city, search, and filters.
                  </p>
                </div>
                <button
                  onClick={() => setVenueDirectoryOpen(false)}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/10 text-white transition hover:bg-white/15"
                  aria-label="Close venue list"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="mt-3 flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.07] px-3 py-2">
                <Search size={15} className="text-white/45" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search spots by name, music, city, age, cover..."
                  className="w-full bg-transparent text-sm text-white outline-none placeholder:text-white/35"
                />
              </div>
            </div>

            <div className="max-h-[calc(100vh-26rem)] overflow-y-auto p-3 sm:max-h-[calc(100vh-27rem)] sm:p-4 lg:max-h-[calc(100vh-25rem)]">
              <div className="grid gap-3 sm:grid-cols-2">
                {filteredVenues.map((venue) => {
                  const photoUrl = String(
                    (venue as any).photo_url ||
                      (venue as any).venue_photo_url ||
                      (venue as any).building_photo_url ||
                      (venue as any).exterior_photo_url ||
                      (venue as any).image_url ||
                      (venue as any).cover_image_url ||
                      ""
                  );
                  const signalCount = (venue.voteCount || 0) + (venue.updateCount || 0) + (venue.liveReportCount || 0);

                  return (
                    <button
                      key={venue.id}
                      onClick={() => {
                        setSelected(venue);
                        setSheetExpanded(true);
                        setViewMode("map");
                        setVenueDirectoryOpen(false);
                        spotlightActivityVenue(venue.id);
                        map?.flyTo({
                          center: [venue.lng, venue.lat],
                          zoom: 14,
                          duration: 850,
                        });
                      }}
                      className="group overflow-hidden rounded-[1.5rem] border border-white/10 bg-zinc-950/80 text-left shadow-xl shadow-black/25 transition hover:-translate-y-0.5 hover:border-white/25 hover:bg-zinc-900/90 active:scale-[0.99]"
                    >
                      <div className="flex gap-3 p-3">
                        <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-[1.2rem] bg-white/10">
                          {photoUrl ? (
                            <img
                              src={photoUrl}
                              alt={venue.name}
                              className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-zinc-800 via-zinc-900 to-black text-xs font-black uppercase tracking-[0.18em] text-white/25">
                              Lit757
                            </div>
                          )}
                          <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent" />
                          <span
                            className="absolute bottom-2 left-2 rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.14em] backdrop-blur-xl"
                            style={{
                              backgroundColor: `${energyColor(venue.energyLevel)}24`,
                              borderColor: `${energyColor(venue.energyLevel)}70`,
                              color: "white",
                            }}
                          >
                            {statusLabel(venue.status)}
                          </span>
                        </div>

                        <div className="min-w-0 flex-1 py-0.5">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-base font-black text-white">
                                {venue.name}
                              </p>
                              <p className="mt-1 truncate text-[11px] font-semibold text-white/45">
                                {venue.city} · {venue.category || venueType(venue)}
                              </p>
                            </div>
                            <div className="shrink-0 rounded-2xl border border-white/10 bg-white/[0.07] px-2.5 py-1.5 text-center">
                              <p className="text-[10px] font-black uppercase tracking-[0.14em] text-white/80">{statusLabel(venue.status)}</p>
                              <p className="mt-0.5 text-[8px] font-black uppercase tracking-[0.16em] text-white/35">Now</p>
                            </div>
                          </div>

                          <p className="mt-2 line-clamp-2 text-xs font-semibold leading-5 text-white/72">
                            {venue.tonightEvent
                              ? venue.tonightEvent.title
                              : venue.music_genre
                              ? `${venue.music_genre} · ${activityPhrase(venue)}`
                              : activityPhrase(venue)}
                          </p>

                          <div className="mt-3 flex flex-wrap gap-1.5">
                            <span className="rounded-full bg-white/10 px-2 py-1 text-[10px] font-bold text-white/70">
                              {activityPhrase(venue)}
                            </span>
                            <span className="rounded-full bg-white/10 px-2 py-1 text-[10px] font-bold text-white/70">
                              {vibeTrendLabel(venue.vibeTrend)}
                            </span>
                            <span className="rounded-full bg-white/10 px-2 py-1 text-[10px] font-bold text-white/70">
                              {venue.cover || venue.tonightEvent?.cover_price || "Cover varies"}
                            </span>
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              {filteredVenues.length === 0 && (
                <div className="rounded-3xl border border-white/10 bg-white/[0.06] p-5 text-center text-sm text-white/55">
                  No spots match that search yet.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {askModalOpen && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 px-4 py-6 sm:items-center">
          <div className="w-full max-w-md rounded-[2rem] border border-white/15 bg-zinc-950/95 p-5 shadow-2xl backdrop-blur-3xl">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-white/45">
                  Ask Lit757
                </p>
                <h3 className="mt-2 text-lg font-black text-white">
                  Type your question instead
                </h3>
                <p className="mt-1 text-xs text-white/50">
                  Speech recognition is not available or failed.
                </p>
              </div>
              <button
                onClick={() => setAskModalOpen(false)}
                className="rounded-full bg-white/10 p-2 text-white transition hover:bg-white/15"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-[0.24em] text-white/45">
                  Your question
                </label>
                <input
                  value={askText}
                  onChange={(e) => setAskText(e.target.value)}
                  placeholder="Where should I go tonight?"
                  className="mt-2 w-full rounded-3xl border border-white/10 bg-black/80 px-4 py-3 text-sm text-white outline-none"
                />
              </div>

              {recognitionError && (
                <div className="rounded-3xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                  {recognitionError}
                </div>
              )}

              <button
                onClick={handleAskTextSubmit}
                disabled={!askText.trim()}
                className="w-full rounded-3xl bg-white py-3 text-sm font-black text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Ask Lit757
              </button>
            </div>
          </div>
        </div>
      )}

      {suggestionOpen && selected && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 px-4 py-4 backdrop-blur-md">
          <div className="w-full max-w-lg max-h-[calc(100vh-2rem)] overflow-y-auto rounded-[2rem] border border-white/15 bg-zinc-950/95 p-5 shadow-[0_30px_120px_rgba(0,0,0,0.9)] backdrop-blur-3xl">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-white/45">
                  Comment
                </p>
                <h3 className="mt-2 text-lg font-black text-white">
                  What’s the vibe?
                </h3>
                <p className="mt-1 text-xs text-white/50">
                  Add a quick note about {selected.name}.
                </p>
              </div>
              <button
                onClick={() => setSuggestionOpen(false)}
                className="rounded-full bg-white/10 p-2 text-white transition hover:bg-white/15"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-[0.24em] text-white/45">
                  Type
                </label>
                <select
                  value={suggestionType}
                  onChange={(e) => setSuggestionType(e.target.value)}
                  className="mt-2 w-full rounded-3xl border border-white/10 bg-black/80 px-4 py-3 text-sm text-white outline-none"
                >
                  <option>Event</option>
                  <option>Cover</option>
                  <option>Music</option>
                  <option>Line</option>
                  <option>Vibe</option>
                  <option>Other</option>
                </select>
              </div>

              <div>
                <label className="text-[10px] font-semibold uppercase tracking-[0.24em] text-white/45">
                  Comment
                </label>
                <textarea
                  value={suggestionMessage}
                  onChange={(e) => setSuggestionMessage(e.target.value)}
                  rows={4}
                  placeholder="Example: line is long, music is good, crowd is active, cover is $10…"
                  className="mt-2 w-full rounded-3xl border border-white/10 bg-black/80 px-4 py-3 text-sm text-white outline-none placeholder:text-white/35"
                />
              </div>

              <div>
                <label className="text-[10px] font-semibold uppercase tracking-[0.24em] text-white/45">
                  Photo / video optional
                </label>
                <input
                  type="file"
                  accept="image/*,video/*"
                  onChange={(e) => setSuggestionMediaFile(e.target.files?.[0] || null)}
                  className="mt-2 w-full rounded-3xl border border-white/10 bg-black/80 px-4 py-3 text-sm text-white file:mr-3 file:rounded-full file:border-0 file:bg-white file:px-3 file:py-1.5 file:text-xs file:font-bold file:text-black"
                />
                {suggestionMediaFile && (
                  <div className="mt-2 flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/60">
                    <span className="truncate">{suggestionMediaFile.name}</span>
                    <button
                      type="button"
                      onClick={() => setSuggestionMediaFile(null)}
                      className="ml-3 rounded-full bg-white/10 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-white"
                    >
                      Remove
                    </button>
                  </div>
                )}
                <p className="mt-2 text-[11px] text-white/40">
                  Images under 8MB, videos under 25MB. Optional, but photos make the vibe feel real.
                </p>
              </div>

              <div className="rounded-3xl border border-white/10 bg-white/5 px-4 py-3 text-xs text-white/55">
                <p className="font-semibold text-white">Venue</p>
                <p>{selected.name}</p>
              </div>

              {suggestionStatus === "error" && suggestionFeedback && (
                <div className="rounded-3xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                  {suggestionFeedback}
                </div>
              )}

              <button
                onClick={submitSuggestion}
                disabled={suggestionLoading || !suggestionMessage.trim()}
                className="w-full rounded-3xl bg-white py-3 text-sm font-black text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {suggestionLoading ? "Posting..." : "Post comment"}
              </button>
            </div>
          </div>
        </div>
      )}

      {eventOpen && selected && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 px-4 py-6 sm:items-center">
          <div className="w-full max-w-md rounded-[2rem] border border-white/15 bg-zinc-950/95 p-5 shadow-2xl backdrop-blur-3xl">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-white/45">
                  Submit Event
                </p>
                <h3 className="mt-2 text-lg font-black text-white">
                  Share event details for {selected.name}
                </h3>
              </div>
              <button
                onClick={() => setEventOpen(false)}
                className="rounded-full bg-white/10 p-2 text-white transition hover:bg-white/15"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-[0.24em] text-white/45">
                  Event title
                </label>
                <input
                  value={eventTitle}
                  onChange={(e) => setEventTitle(e.target.value)}
                  placeholder="Name of the event"
                  className="mt-2 w-full rounded-3xl border border-white/10 bg-black/80 px-4 py-3 text-sm text-white outline-none"
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-[0.24em] text-white/45">
                    Event date
                  </label>
                  <input
                    type="date"
                    value={eventDate}
                    onChange={(e) => setEventDate(e.target.value)}
                    className="mt-2 w-full rounded-3xl border border-white/10 bg-black/80 px-4 py-3 text-sm text-white outline-none"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-[0.24em] text-white/45">
                    Start time
                  </label>
                  <input
                    type="time"
                    value={eventTime}
                    onChange={(e) => setEventTime(e.target.value)}
                    className="mt-2 w-full rounded-3xl border border-white/10 bg-black/80 px-4 py-3 text-sm text-white outline-none"
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-[0.24em] text-white/45">
                    Genre
                  </label>
                  <input
                    value={eventGenre}
                    onChange={(e) => setEventGenre(e.target.value)}
                    placeholder="Hip-Hop, EDM, etc."
                    className="mt-2 w-full rounded-3xl border border-white/10 bg-black/80 px-4 py-3 text-sm text-white outline-none"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-[0.24em] text-white/45">
                    DJ
                  </label>
                  <input
                    value={eventDj}
                    onChange={(e) => setEventDj(e.target.value)}
                    placeholder="DJ name"
                    className="mt-2 w-full rounded-3xl border border-white/10 bg-black/80 px-4 py-3 text-sm text-white outline-none"
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-[0.24em] text-white/45">
                    Cover price
                  </label>
                  <input
                    value={eventCoverPrice}
                    onChange={(e) => setEventCoverPrice(e.target.value)}
                    placeholder="$20, Free, etc."
                    className="mt-2 w-full rounded-3xl border border-white/10 bg-black/80 px-4 py-3 text-sm text-white outline-none"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-[0.24em] text-white/45">
                    Age limit
                  </label>
                  <input
                    value={eventAgeLimit}
                    onChange={(e) => setEventAgeLimit(e.target.value)}
                    placeholder="21+, All ages"
                    className="mt-2 w-full rounded-3xl border border-white/10 bg-black/80 px-4 py-3 text-sm text-white outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="text-[10px] font-semibold uppercase tracking-[0.24em] text-white/45">
                  Description
                </label>
                <textarea
                  value={eventDescription}
                  onChange={(e) => setEventDescription(e.target.value)}
                  rows={4}
                  placeholder="Add extra details for the event"
                  className="mt-2 w-full rounded-3xl border border-white/10 bg-black/80 px-4 py-3 text-sm text-white outline-none placeholder:text-white/35"
                />
              </div>

              <div className="rounded-3xl border border-white/10 bg-white/5 px-4 py-3 text-xs text-white/55">
                <p className="font-semibold text-white">Venue</p>
                <p>{selected.name}</p>
              </div>

              {eventStatus === "error" && eventFeedback && (
                <div className="rounded-3xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                  {eventFeedback}
                </div>
              )}

              <button
                onClick={submitEvent}
                disabled={eventLoading || !eventTitle.trim()}
                className="w-full rounded-3xl bg-white py-3 text-sm font-black text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {eventLoading ? "Submitting event..." : "Submit event"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
