import { activityStatusLabel } from "../src/lib/buzz/truth-labels";
import { venueKinds } from "../src/lib/venue-kind";

export type CrowdLevel = "quiet" | "steady" | "busy" | "packed";
export type BuzzCategory =
  | "All"
  | "Food"
  | "Drinks"
  | "Nightlife"
  | "Events"
  | "Outdoors"
  | "Shopping";

export type BuzzVenue = {
  id: string;
  name: string;
  city?: string;
  address?: string | null;
  kind?: string;
  kinds?: string[];
  type?: string;
  category?: string;
  lat: number | string;
  lng: number | string;
  photoUrl?: string | null;
  reason?: string;
  openNow?: boolean | null;
  phone?: string | null;
  website?: string | null;
  distanceMiles?: number | null;
  area?: {
    shortName?: string;
    status?: string;
    traffic?: number;
    eventsActive?: number;
    eventsSoon?: number;
  } | null;
  event?: {
    name?: string | null;
    startTime?: string | null;
    sourceUrl?: string | null;
    ticketStatus?: string | null;
  } | null;
  activity?: {
    score: number;
    label: string;
    trendLabel: string;
    confidence?: string;
    scoreMode?: "live" | "forecast";
    updatedAt?: string;
  };
};

export type VenueDetail = {
  hours?: unknown;
  phone?: string | null;
  website?: string | null;
  address?: string | null;
  upcomingEvents?: Array<{
    id: string;
    name?: string | null;
    start_time?: string | null;
    source_url?: string | null;
  }>;
};

export type NearbyPayload = {
  success?: boolean;
  venues?: BuzzVenue[];
  picks?: BuzzVenue[];
  scope?: { label?: string };
  error?: string;
};

export type VotePayload = {
  success?: boolean;
  error?: string;
  verifiedNearby?: boolean;
  reportCount?: number;
  pointsAwarded?: number;
  totalPoints?: number | null;
  buzz?: { score?: number; label?: string; mode?: string; confidence?: string };
  message?: string;
};

export type LoadRequest = {
  lat?: number;
  lng?: number;
  radius?: number;
  bounds?: string;
  label?: string;
};

export const DEFAULT_BUZZ_CENTER: [number, number] = [-76.17, 36.88];
export const ACTIVE_MIN_SCORE = 60;
export const BUZZING_PIN_MIN_SCORE = 76;
export const ON_FIRE_PIN_MIN_SCORE = 88;

export function venueScore(venue: BuzzVenue) {
  return Math.max(0, Math.min(100, Number(venue.activity?.score ?? 35)));
}

export function venueCoordinates(venue: BuzzVenue): [number, number] {
  return [Number(venue.lng), Number(venue.lat)];
}

export function hasValidVenueCoordinates(venue: BuzzVenue) {
  const [longitude, latitude] = venueCoordinates(venue);
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude !== 0 &&
    longitude !== 0
  );
}

export function venueStatus(venue: BuzzVenue) {
  return activityStatusLabel(venueScore(venue), venue.activity?.scoreMode);
}

export function venueTruthLabel(venue: BuzzVenue) {
  return venue.activity?.scoreMode === "live" ? "Live" : "Forecast";
}

export function milesLabel(value?: number | null) {
  if (value == null) return null;
  if (value < 0.1) return "Here";
  return value < 10 ? `${value.toFixed(1)} mi` : `${Math.round(value)} mi`;
}

export function venueCategories(venue: BuzzVenue): BuzzCategory[] {
  const normalized = `${venue.name} ${venue.kind || ""} ${venue.type || ""} ${venue.category || ""}`.toLowerCase();
  const kinds = new Set(venue.kinds || venueKinds({
    name: venue.name,
    type: venue.type,
    category: venue.category,
  }));
  const categories = new Set<BuzzCategory>();

  if (venue.event?.name || venue.kind === "events" || kinds.has("events")) categories.add("Events");
  if (kinds.has("food")) categories.add("Food");
  if (kinds.has("nightlife")) {
    const drinks = /bar|brew|wine|drink|pub|cocktail|tap|tavern|biergarten/.test(normalized);
    const nightlife = /club|music|nightlife|dj|lounge|concert|hookah|cabaret/.test(normalized);
    if (drinks) categories.add("Drinks");
    if (nightlife || !drinks) categories.add("Nightlife");
  }
  if (kinds.has("activity") && /park|trail|beach|garden|museum|outdoor|zoo|aquarium|golf/.test(normalized)) categories.add("Outdoors");
  if (kinds.has("activity") && /shop|mall|market|store/.test(normalized)) categories.add("Shopping");
  if (!categories.size) categories.add("All");
  return ["Events", "Food", "Drinks", "Nightlife", "Outdoors", "Shopping", "All"]
    .filter(category => categories.has(category as BuzzCategory)) as BuzzCategory[];
}

export function venueCategory(venue: BuzzVenue): BuzzCategory {
  return venueCategories(venue)[0];
}

export function venueMatchesCategory(venue: BuzzVenue, category: BuzzCategory) {
  return category === "All" || venueCategories(venue).includes(category);
}

export function formatEventTime(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function todayHours(hours: unknown) {
  if (!hours) return "Hours not available";
  if (typeof hours === "string") return hours;
  if (Array.isArray(hours)) return hours.map(String).join(" · ");
  if (typeof hours !== "object") return "Hours not available";

  const row = hours as Record<string, unknown>;
  const day = new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(new Date());
  const keys = [
    day,
    day.toLowerCase(),
    day.slice(0, 3),
    day.slice(0, 3).toLowerCase(),
  ];
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string") return `Today: ${value}`;
    if (Array.isArray(value)) return `Today: ${value.map(String).join(", ")}`;
  }
  return "Hours available on venue page";
}

export function getBrowserPosition() {
  return new Promise<GeolocationPosition>((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Location is not available on this device."));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 15_000,
      maximumAge: 15_000,
    });
  });
}
