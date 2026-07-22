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
};

function cleanText(value: unknown, fallback = "") {
  return String(value || fallback).replace(/\s+/g, " ").trim().slice(0, 120);
}

export function shareMode(value: unknown): ShareTruthMode {
  return String(value || "").toLowerCase() === "live" ? "live" : "forecast";
}

export function shareStatus(value: unknown) {
  const clean = cleanText(value, "Heating up");
  return clean || "Heating up";
}

export function buildInviteCrewUrl(origin: string, venue: InviteCrewVenue) {
  const url = new URL("/", origin);
  url.searchParams.set("venue", cleanText(venue.id));
  url.searchParams.set("source", "invite-the-crew");
  url.searchParams.set("mode", shareMode(venue.mode));
  return url.toString();
}

export function buildStoryCardUrl(origin: string, venue: InviteCrewVenue) {
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
  return url.toString();
}

export function buildInviteCrewText(venue: InviteCrewVenue) {
  const mode = shareMode(venue.mode) === "live" ? "Live activity" : "Buzz forecast";
  const place = cleanText(venue.name, "This place");
  const city = venue.city ? ` in ${cleanText(venue.city)}` : "";
  return `🔥 ${place}${city} is ${shareStatus(venue.status).toLowerCase()} — ${mode}. Who’s coming?`;
}

export function safeCardText(value: unknown, fallback: string, maximum = 54) {
  const clean = cleanText(value, fallback);
  return (clean || fallback).slice(0, maximum);
}
