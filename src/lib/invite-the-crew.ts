export type ShareTruthMode = "live" | "forecast";

export type InviteCrewVenue = {
  id: string;
  name: string;
  city?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  status?: string | null;
  trend?: string | null;
  mode?: string | null;
  referralId?: string | null;
};

function cleanText(value: unknown, fallback = "") {
  return String(value || fallback).replace(/\s+/g, " ").trim().slice(0, 120);
}

function runtimeOrigin() {
  if (typeof window !== "undefined" && window.location?.origin) return window.location.origin;
  return "https://lit757.vercel.app";
}

export function shareMode(value: unknown): ShareTruthMode {
  return String(value || "").toLowerCase() === "live" ? "live" : "forecast";
}

export function shareStatus(value: unknown) {
  const clean = cleanText(value, "Heating up");
  return clean || "Heating up";
}

export function buildInviteCrewUrl(origin: string, venue: InviteCrewVenue): string;
export function buildInviteCrewUrl(venueId: string, referralId?: string | null, mode?: string | null): string;
export function buildInviteCrewUrl(
  originOrVenueId: string,
  venueOrReferral?: InviteCrewVenue | string | null,
  legacyMode?: string | null,
) {
  const modern = venueOrReferral && typeof venueOrReferral === "object";
  const origin = modern ? originOrVenueId : runtimeOrigin();
  const venue: InviteCrewVenue = modern
    ? venueOrReferral as InviteCrewVenue
    : {
        id: originOrVenueId,
        name: "Buzz venue",
        referralId: typeof venueOrReferral === "string" ? venueOrReferral : null,
        mode: legacyMode,
      };
  const url = new URL("/", origin);
  url.searchParams.set("venue", cleanText(venue.id));
  url.searchParams.set("source", "invite-the-crew");
  url.searchParams.set("mode", shareMode(venue.mode));
  const referralId = cleanText(venue.referralId);
  if (/^[a-zA-Z0-9_-]{8,128}$/.test(referralId)) url.searchParams.set("ref", referralId);
  return url.toString();
}

export function buildStoryCardUrl(origin: string, venue: InviteCrewVenue): string;
export function buildStoryCardUrl(venueId: string, referralId?: string | null): string;
export function buildStoryCardUrl(
  originOrVenueId: string,
  venueOrReferral?: InviteCrewVenue | string | null,
) {
  const modern = venueOrReferral && typeof venueOrReferral === "object";
  const origin = modern ? originOrVenueId : runtimeOrigin();
  const venue: InviteCrewVenue = modern
    ? venueOrReferral as InviteCrewVenue
    : {
        id: originOrVenueId,
        name: "Buzz venue",
        referralId: typeof venueOrReferral === "string" ? venueOrReferral : null,
      };
  const url = new URL("/api/share/venue-card", origin);
  url.searchParams.set("venue", cleanText(venue.id));
  url.searchParams.set("name", cleanText(venue.name, "Buzz venue"));
  if (venue.city) url.searchParams.set("city", cleanText(venue.city));
  if (venue.latitude != null && Number.isFinite(Number(venue.latitude))) {
    url.searchParams.set("lat", Number(venue.latitude).toFixed(5));
  }
  if (venue.longitude != null && Number.isFinite(Number(venue.longitude))) {
    url.searchParams.set("lng", Number(venue.longitude).toFixed(5));
  }
  url.searchParams.set("status", shareStatus(venue.status));
  if (venue.trend) url.searchParams.set("trend", cleanText(venue.trend));
  url.searchParams.set("mode", shareMode(venue.mode));
  const referralId = cleanText(venue.referralId);
  if (/^[a-zA-Z0-9_-]{8,128}$/.test(referralId)) url.searchParams.set("ref", referralId);
  return url.toString();
}

export function buildInviteCrewText(venue: InviteCrewVenue): string;
export function buildInviteCrewText(name: string, status?: string | null, eventName?: string | null, url?: string | null): string;
export function buildInviteCrewText(
  venueOrName: InviteCrewVenue | string,
  legacyStatus?: string | null,
  legacyEventName?: string | null,
  legacyUrl?: string | null,
) {
  if (typeof venueOrName === "string") {
    const place = cleanText(venueOrName, "This place");
    const event = legacyEventName ? ` ${cleanText(legacyEventName)} is happening.` : "";
    const link = legacyUrl ? ` ${cleanText(legacyUrl)}` : "";
    return `🔥 ${place} is ${shareStatus(legacyStatus).toLowerCase()}.${event} Who’s coming?${link}`;
  }
  const mode = shareMode(venueOrName.mode) === "live" ? "Live activity" : "Buzz forecast";
  const place = cleanText(venueOrName.name, "This place");
  const city = venueOrName.city ? ` in ${cleanText(venueOrName.city)}` : "";
  return `🔥 ${place}${city} is ${shareStatus(venueOrName.status).toLowerCase()} — ${mode}. Who’s coming?`;
}

export function safeCardText(value: unknown, fallback: string, maximum = 54) {
  const clean = cleanText(value, fallback);
  return (clean || fallback).slice(0, maximum);
}
