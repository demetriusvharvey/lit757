export type SeatGeekEvent = {
  id?: number | string;
  title?: string;
  url?: string;
  datetime_utc?: string;
  datetime_local?: string;
  time_tbd?: boolean;
  score?: number;
  venue?: {
    id?: number | string;
    name?: string;
    city?: string;
    state?: string;
    address?: string;
    postal_code?: string;
    location?: { lat?: number; lon?: number };
  };
  stats?: {
    listing_count?: number;
    average_price?: number | null;
    lowest_price?: number | null;
    highest_price?: number | null;
  };
};

export type SeatGeekEventRow = {
  source_event_id: string;
  name: string;
  venue_name: string;
  start_time: string;
  end_time: null;
  source: "seatgeek";
  ticket_status: string;
  source_url: string | null;
  created_at: string;
};

const MARKET_CITIES = new Set([
  "chesapeake",
  "hampton",
  "newport news",
  "norfolk",
  "portsmouth",
  "suffolk",
  "virginia beach",
]);

function normalize(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function validIso(value: unknown) {
  const date = new Date(String(value || ""));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function isHamptonRoadsSeatGeekEvent(event: SeatGeekEvent) {
  return MARKET_CITIES.has(normalize(event.venue?.city));
}

export function seatGeekTicketStatus(event: SeatGeekEvent) {
  const listings = Number(event.stats?.listing_count || 0);
  if (listings <= 0) return "No Listings";
  const lowest = Number(event.stats?.lowest_price);
  if (Number.isFinite(lowest) && lowest > 0) return `Tickets from $${Math.round(lowest)}`;
  return "Tickets Available";
}

export function normalizeSeatGeekEvent(event: SeatGeekEvent, createdAt = new Date().toISOString()): SeatGeekEventRow | null {
  const id = String(event.id || "").trim();
  const name = String(event.title || "").trim();
  const start = validIso(event.datetime_utc || event.datetime_local);
  if (!id || !name || !start || !isHamptonRoadsSeatGeekEvent(event)) return null;

  return {
    source_event_id: `seatgeek:${id}`,
    name,
    venue_name: String(event.venue?.name || `${event.venue?.city || "Hampton Roads"} Event`).trim(),
    start_time: start,
    end_time: null,
    source: "seatgeek",
    ticket_status: seatGeekTicketStatus(event),
    source_url: event.url || null,
    created_at: createdAt,
  };
}

export function seatGeekDemandMetadata(event: SeatGeekEvent) {
  return {
    providerVenueId: event.venue?.id ? String(event.venue.id) : null,
    providerVenueName: event.venue?.name || null,
    providerCity: event.venue?.city || null,
    listingCount: Number(event.stats?.listing_count || 0),
    averagePrice: Number.isFinite(Number(event.stats?.average_price)) ? Number(event.stats?.average_price) : null,
    lowestPrice: Number.isFinite(Number(event.stats?.lowest_price)) ? Number(event.stats?.lowest_price) : null,
    highestPrice: Number.isFinite(Number(event.stats?.highest_price)) ? Number(event.stats?.highest_price) : null,
    popularityScore: Number.isFinite(Number(event.score)) ? Number(event.score) : null,
    timeTbd: Boolean(event.time_tbd),
  };
}

export function seatGeekHasMorePages(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const meta = (payload as { meta?: unknown }).meta;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return false;
  const record = meta as { page?: unknown; per_page?: unknown; total?: unknown };
  const page = Number(record.page || 1);
  const perPage = Number(record.per_page || 0);
  const total = Number(record.total || 0);
  return perPage > 0 && page * perPage < total;
}
