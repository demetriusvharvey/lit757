export type EventbriteOrganization = {
  id?: string | number;
  name?: string;
};

export type EventbriteEvent = {
  id?: string | number;
  name?: { text?: string; html?: string } | string;
  url?: string;
  status?: string;
  is_free?: boolean;
  start?: { utc?: string; local?: string };
  end?: { utc?: string; local?: string };
  venue?: {
    name?: string;
    address?: {
      city?: string;
      region?: string;
      localized_address_display?: string;
    };
  };
  ticket_availability?: {
    has_available_tickets?: boolean;
    minimum_ticket_price?: unknown;
    maximum_ticket_price?: unknown;
  };
};

export type EventbriteEventRow = {
  source_event_id: string;
  name: string;
  venue_name: string;
  start_time: string;
  end_time: string | null;
  source: "eventbrite";
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

function text(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as { text?: unknown; html?: unknown };
    return String(record.text || record.html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
  return "";
}

function normalized(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function validDate(value: unknown) {
  const raw = String(value || "");
  const date = new Date(raw);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function eventbriteOrganizationIds(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [] as string[];
  const organizations = (payload as { organizations?: unknown }).organizations;
  if (!Array.isArray(organizations)) return [] as string[];
  return organizations
    .map(item => item && typeof item === "object" ? String((item as EventbriteOrganization).id || "") : "")
    .filter(Boolean);
}

export function isHamptonRoadsEvent(event: EventbriteEvent) {
  const city = normalized(event.venue?.address?.city);
  if (MARKET_CITIES.has(city)) return true;
  const address = normalized(event.venue?.address?.localized_address_display);
  return [...MARKET_CITIES].some(candidate => address.includes(candidate));
}

export function eventbriteTicketStatus(event: EventbriteEvent) {
  if (event.is_free) return "Free Entry";
  const status = normalized(event.status);
  if (status === "sold out" || status === "soldout") return "Sold Out";
  if (status === "ended") return "Ended";
  if (status === "canceled" || status === "cancelled") return "Cancelled";

  const availability = event.ticket_availability;
  if (availability?.has_available_tickets === false) return "Sold Out";
  if (availability?.minimum_ticket_price || availability?.maximum_ticket_price) return "Tickets Available";
  return "Available";
}

export function normalizeEventbriteEvent(event: EventbriteEvent, createdAt = new Date().toISOString()): EventbriteEventRow | null {
  const id = String(event.id || "").trim();
  const name = text(event.name);
  const start = validDate(event.start?.utc || event.start?.local);
  if (!id || !name || !start || !isHamptonRoadsEvent(event)) return null;

  const venueName = String(
    event.venue?.name
      || event.venue?.address?.localized_address_display
      || event.venue?.address?.city
      || "Eventbrite Event",
  ).trim();

  return {
    source_event_id: `eventbrite:${id}`,
    name,
    venue_name: venueName,
    start_time: start,
    end_time: validDate(event.end?.utc || event.end?.local),
    source: "eventbrite",
    ticket_status: eventbriteTicketStatus(event),
    source_url: event.url || null,
    created_at: createdAt,
  };
}

export function eventbriteHasMorePages(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const pagination = (payload as { pagination?: unknown }).pagination;
  if (!pagination || typeof pagination !== "object" || Array.isArray(pagination)) return false;
  return Boolean((pagination as { has_more_items?: unknown }).has_more_items);
}
