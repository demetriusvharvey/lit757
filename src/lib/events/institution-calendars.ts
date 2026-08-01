import { createHash } from "node:crypto";
import {
  cityEventFingerprint,
  parseCityCalendarJsonLd,
  type CityCalendarSource,
  type NormalizedCityEvent,
} from "./city-calendars";
import { parseVenueListingEvents } from "./venue-listing";
import { parseVisitNorfolkEvents } from "./tourism-events";

const EASTERN_TIME_ZONE = "America/New_York";
const WINDOW_DAYS = 120;
const REQUEST_TIMEOUT_MS = 14_000;
const LISTING_CONCURRENCY = 4;
const DETAIL_CONCURRENCY = 6;
const DETAIL_LIMIT = 45;

export type InstitutionKind = "university" | "arena" | "arts" | "museum" | "festival" | "attraction" | "tourism";
export type InstitutionFormat = "localist-api" | "tribe-api" | "venue-html" | "jsonld-html" | "embedded-json";

export type InstitutionCalendarSource = {
  id: string;
  name: string;
  kind: InstitutionKind;
  city: string;
  url: string;
  format: InstitutionFormat;
  enabled: boolean;
  venueName?: string;
  address?: string;
  detailPathPrefix?: string;
  coverageNote?: string;
};

export type InstitutionFeedResult = {
  source: InstitutionCalendarSource;
  status: "ok" | "error";
  events: NormalizedCityEvent[];
  error: string | null;
  fetchedAt: string;
};

export const INSTITUTION_CALENDAR_SOURCES: InstitutionCalendarSource[] = [
  {
    id: "hampton_university_official",
    name: "Hampton University Events Calendar",
    kind: "university",
    city: "Hampton",
    url: "https://calendar.hamptonu.edu",
    format: "localist-api",
    enabled: true,
  },
  {
    id: "cnu_official",
    name: "Christopher Newport University Events Calendar",
    kind: "university",
    city: "Newport News",
    url: "https://cal.cnu.edu",
    format: "localist-api",
    enabled: true,
  },
  {
    id: "virginia_zoo_official",
    name: "Virginia Zoo Events",
    kind: "attraction",
    city: "Norfolk",
    url: "https://virginiazoo.org/events/",
    format: "tribe-api",
    enabled: true,
    venueName: "Virginia Zoo",
  },
  {
    id: "nauticus_official",
    name: "Nauticus & Battleship Wisconsin Events",
    kind: "museum",
    city: "Norfolk",
    url: "https://nauticus.org/calendar/",
    format: "venue-html",
    enabled: true,
    venueName: "Nauticus",
    address: "One Waterside Drive, Norfolk, VA 23510",
    detailPathPrefix: "/events/",
    coverageNote: "Official Nauticus calendar and first-party event detail pages.",
  },
  {
    id: "neptune_festival_official",
    name: "Virginia Beach Neptune Festival",
    kind: "festival",
    city: "Virginia Beach",
    url: "https://www.neptunefestival.com/events/",
    format: "tribe-api",
    enabled: true,
    coverageNote: "Official Neptune Festival productions and related programming.",
  },
  {
    id: "sandler_center_official",
    name: "Sandler Center for the Performing Arts",
    kind: "arts",
    city: "Virginia Beach",
    url: "https://www.sandlercenter.org/events",
    format: "venue-html",
    enabled: true,
    venueName: "Sandler Center for the Performing Arts",
    detailPathPrefix: "/events/detail/",
  },
  {
    id: "chartway_arena_official",
    name: "Chartway Arena",
    kind: "arena",
    city: "Norfolk",
    url: "https://www.chartwayarena.com/events/all",
    format: "venue-html",
    enabled: true,
    venueName: "Chartway Arena",
    detailPathPrefix: "/events/detail/",
  },
  {
    id: "hampton_coliseum_official",
    name: "Hampton Coliseum",
    kind: "arena",
    city: "Hampton",
    url: "https://www.hamptoncoliseum.org/events/all",
    format: "venue-html",
    enabled: true,
    venueName: "Hampton Coliseum",
    detailPathPrefix: "/events/detail/",
  },
  {
    id: "chrysler_museum_official",
    name: "Chrysler Museum of Art Events",
    kind: "museum",
    city: "Norfolk",
    url: "https://chrysler.org/events/",
    format: "tribe-api",
    enabled: true,
    venueName: "Chrysler Museum of Art",
  },
  {
    id: "mariners_museum_official",
    name: "The Mariners' Museum and Park Events",
    kind: "museum",
    city: "Newport News",
    url: "https://www.marinersmuseum.org/events/",
    format: "tribe-api",
    enabled: true,
    venueName: "The Mariners' Museum and Park",
  },
  {
    id: "portsmouth_museums_official",
    name: "Portsmouth Museums Events",
    kind: "museum",
    city: "Portsmouth",
    url: "https://www.portsmouthmuseums.com/events",
    format: "jsonld-html",
    enabled: true,
    venueName: "Portsmouth Museums",
  },
  {
    id: "visit_norfolk_official",
    name: "VisitNorfolk Events",
    kind: "tourism",
    city: "Norfolk",
    url: "https://www.visitnorfolk.com/events/",
    format: "embedded-json",
    enabled: true,
    coverageNote: "Official destination calendar with local nightlife, food, arts, festivals, sports, classes, and community events.",
  },
  {
    id: "visit_hampton_official",
    name: "Visit Hampton Events",
    kind: "tourism",
    city: "Hampton",
    url: "https://visithampton.com/calendar/",
    format: "tribe-api",
    enabled: true,
    coverageNote: "Official Hampton destination calendar with festivals, waterfront events, arts, sports, tours, food, and community programming.",
  },
];

const FETCH_HEADERS = {
  Accept: "application/json,text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
  "User-Agent": "Buzz/1.0 (https://lit757.vercel.app; demetriusvharvey@gmail.com)",
};

function dateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function windowDates() {
  const start = new Date();
  const end = new Date(start.getTime() + WINDOW_DAYS * 24 * 60 * 60 * 1000);
  return { start: dateOnly(start), end: dateOnly(end) };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number") return String(value);
  return null;
}

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function decodeHtml(value: string) {
  return value
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function cleanHtml(value: unknown) {
  const raw = text(value);
  if (!raw) return null;
  return decodeHtml(raw.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim() || null;
}

function iso(value: unknown) {
  const raw = text(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

const MONTH_NUMBERS: Record<string, string> = {
  january: "01",
  february: "02",
  march: "03",
  april: "04",
  may: "05",
  june: "06",
  july: "07",
  august: "08",
  september: "09",
  october: "10",
  november: "11",
  december: "12",
};

function easternOffset(date: string) {
  const sample = new Date(`${date}T12:00:00Z`);
  const zone = new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN_TIME_ZONE,
    timeZoneName: "shortOffset",
  }).formatToParts(sample).find(part => part.type === "timeZoneName")?.value || "GMT-5";
  const match = zone.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/i);
  if (!match) return "-05:00";
  return `${match[1]}${match[2].padStart(2, "0")}:${(match[3] || "00").padStart(2, "0")}`;
}

function localClock(value: string) {
  const match = value.match(/\|\s*(\d{1,2})(?::(\d{2}))?\s*(AM|PM)\b/i);
  if (!match) return "12:00:00";
  let hour = Number(match[1]) % 12;
  if (match[3].toUpperCase() === "PM") hour += 12;
  return `${String(hour).padStart(2, "0")}:${match[2] || "00"}:00`;
}

export function parseInstitutionDateHeading(value: string | null) {
  if (!value) return { start: null, end: null };
  const dates = [...value.matchAll(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})\b/gi)]
    .map(match => `${match[3]}-${MONTH_NUMBERS[match[1].toLowerCase()]}-${match[2].padStart(2, "0")}`);
  if (!dates.length) return { start: null, end: null };
  const start = `${dates[0]}T${localClock(value)}${easternOffset(dates[0])}`;
  const endDate = dates[1];
  const end = endDate ? `${endDate}T23:59:59${easternOffset(endDate)}` : null;
  return { start, end };
}

function sourceAdapter(source: InstitutionCalendarSource, fallbackUrl = source.url): CityCalendarSource {
  return {
    id: source.id,
    name: source.name,
    city: source.city,
    url: fallbackUrl,
    format: "html-jsonld",
    enabled: source.enabled,
    timeZone: EASTERN_TIME_ZONE,
    venueName: source.venueName,
  };
}

function addressFromParts(parts: unknown[]) {
  return parts.map(text).filter((part): part is string => Boolean(part)).join(", ") || null;
}

function externalEventId(source: InstitutionCalendarSource, id: unknown, title: string, start: string, venue: string) {
  return cityEventFingerprint(source.id, text(id), title, start, venue);
}

function localistEvent(source: InstitutionCalendarSource, wrapper: unknown) {
  const event = record(record(wrapper)?.event || wrapper);
  if (!event) return [] as NormalizedCityEvent[];
  const title = cleanHtml(event.title || event.name);
  if (!title) return [] as NormalizedCityEvent[];
  const instances = Array.isArray(event.event_instances) ? event.event_instances : [];
  const normalizedInstances = instances.flatMap(item => {
    const instance = record(record(item)?.event_instance || item);
    const start = iso(instance?.start || instance?.start_time || event.first_date || event.start);
    if (!start) return [];
    return [{ instance, start, end: iso(instance?.end || instance?.end_time || event.last_date || event.end) }];
  });
  if (!normalizedInstances.length) {
    const start = iso(event.first_date || event.start || event.start_time);
    if (start) normalizedInstances.push({ instance: null, start, end: iso(event.last_date || event.end || event.end_time) });
  }

  const venueRecord = record(event.venue);
  const geo = record(event.geo || venueRecord?.geo);
  const address = text(event.address)
    || addressFromParts([venueRecord?.address, venueRecord?.city, venueRecord?.state, venueRecord?.zip]);
  const venue = text(event.location_name)
    || text(event.location)
    || text(venueRecord?.name)
    || source.venueName
    || address
    || source.name;
  const sourceUrl = text(event.localist_url) || text(event.url) || text(event.website) || source.url;
  const image = text(event.photo_url) || text(record(event.photo)?.url);

  return normalizedInstances.map(({ instance, start, end }) => ({
    source_event_id: externalEventId(source, instance?.id || event.id, title, start, venue),
    name: title,
    description: cleanHtml(event.description_text || event.description),
    venue_name: venue,
    address,
    city: source.city,
    latitude: numberValue(geo?.latitude || geo?.lat),
    longitude: numberValue(geo?.longitude || geo?.lng || geo?.lon),
    start_time: start,
    end_time: end,
    source: source.id,
    source_name: source.name,
    source_url: sourceUrl,
    image_url: image,
    ticket_status: text(event.ticket_url) ? "tickets" : null,
  }));
}

function tribeEvent(source: InstitutionCalendarSource, value: unknown) {
  const event = record(value);
  if (!event) return null;
  const title = cleanHtml(event.title);
  const start = iso(event.start_date || event.start_date_utc || event.start);
  if (!title || !start) return null;
  const venueRecord = record(event.venue);
  const imageRecord = record(event.image);
  const venue = cleanHtml(venueRecord?.venue)
    || source.venueName
    || cleanHtml(venueRecord?.address)
    || source.name;
  const address = addressFromParts([
    venueRecord?.address,
    venueRecord?.city,
    venueRecord?.stateprovince || venueRecord?.state,
    venueRecord?.zip,
  ]);
  return {
    source_event_id: externalEventId(source, event.id, title, start, venue),
    name: title,
    description: cleanHtml(event.description || event.excerpt),
    venue_name: venue,
    address,
    city: source.city,
    latitude: numberValue(venueRecord?.geo_lat || venueRecord?.latitude),
    longitude: numberValue(venueRecord?.geo_lng || venueRecord?.longitude),
    start_time: start,
    end_time: iso(event.end_date || event.end_date_utc || event.end),
    source: source.id,
    source_name: source.name,
    source_url: text(event.url) || source.url,
    image_url: text(imageRecord?.url),
    ticket_status: text(event.cost) || text(event.website) ? "available" : null,
  } satisfies NormalizedCityEvent;
}

async function fetchJson(url: string) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: FETCH_HEADERS,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Institution calendar request failed (${response.status})`);
  return response.json() as Promise<unknown>;
}

async function fetchHtml(url: string) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: FETCH_HEADERS,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Institution calendar request failed (${response.status})`);
  return response.text();
}

async function mapLimit<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>) {
  const output = new Array<R>(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      output[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => run()));
  return output;
}

async function fetchLocalist(source: InstitutionCalendarSource) {
  const { start, end } = windowDates();
  const events: NormalizedCityEvent[] = [];
  for (let page = 1; page <= 5; page += 1) {
    const url = new URL("/api/2/events", source.url);
    url.searchParams.set("start", start);
    url.searchParams.set("end", end);
    url.searchParams.set("pp", "100");
    url.searchParams.set("page", String(page));
    const payload = record(await fetchJson(url.toString()));
    const rows = Array.isArray(payload?.events) ? payload.events : [];
    events.push(...rows.flatMap(row => localistEvent(source, row)));
    const pageInfo = record(payload?.page);
    const totalPages = numberValue(pageInfo?.total_pages || pageInfo?.totalPages);
    if (!rows.length || (totalPages !== null && page >= totalPages) || rows.length < 100) break;
  }
  return events;
}

async function fetchTribe(source: InstitutionCalendarSource) {
  const { start, end } = windowDates();
  const endpoint = new URL("/wp-json/tribe/events/v1/events", source.url);
  const events: NormalizedCityEvent[] = [];
  for (let page = 1; page <= 5; page += 1) {
    endpoint.searchParams.set("start_date", start);
    endpoint.searchParams.set("end_date", end);
    endpoint.searchParams.set("per_page", "100");
    endpoint.searchParams.set("page", String(page));
    const payload = record(await fetchJson(endpoint.toString()));
    const rows = Array.isArray(payload?.events) ? payload.events : [];
    for (const row of rows) {
    const event = tribeEvent(source, row);
    if (event) events.push(event);
  }
    const totalPages = numberValue(payload?.total_pages || payload?.totalPages);
    if (!rows.length || (totalPages !== null && page >= totalPages) || rows.length < 100) break;
  }
  return events;
}

export function extractInstitutionDetailLinks(html: string, source: InstitutionCalendarSource) {
  const prefix = source.detailPathPrefix;
  if (!prefix) return [];
  const origin = new URL(source.url).origin;
  const links: string[] = [];
  for (const match of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    try {
      const resolved = new URL(decodeHtml(match[1]), source.url);
      if (resolved.origin !== origin || !resolved.pathname.startsWith(prefix)) continue;
      resolved.hash = "";
      links.push(resolved.toString());
    } catch {
      // Ignore malformed links.
    }
  }
  return [...new Set(links)].slice(0, DETAIL_LIMIT);
}

function metaContent(html: string, key: string) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const expressions = [
    new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${escaped}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name|itemprop)=["']${escaped}["']`, "i"),
  ];
  for (const expression of expressions) {
    const match = html.match(expression);
    if (match?.[1]) return decodeHtml(match[1]).trim();
  }
  return null;
}

function fallbackVenueDetail(source: InstitutionCalendarSource, html: string, url: string) {
  const title = cleanHtml(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1])
    || cleanHtml(metaContent(html, "og:title"));
  const dateHeading = cleanHtml(html.match(/<h3\b[^>]*class=["'][^"']*\bpost-date\b[^"']*["'][^>]*>([\s\S]*?)<\/h3>/i)?.[1]);
  const headingDates = parseInstitutionDateHeading(dateHeading);
  const start = iso(
    metaContent(html, "event:start_time")
    || metaContent(html, "startDate")
    || html.match(/<time\b[^>]*datetime=["']([^"']+)["']/i)?.[1],
  ) || headingDates.start;
  if (!title || !start) return null;
  const end = iso(metaContent(html, "event:end_time") || metaContent(html, "endDate")) || headingDates.end;
  const venue = cleanHtml(html.match(/<strong>\s*LOCATION\s*<\/strong>\s*<p[^>]*>([\s\S]*?)<\/p>/i)?.[1])
    || source.venueName
    || source.name;
  return {
    source_event_id: externalEventId(source, url, title, start, venue),
    name: title,
    description: cleanHtml(metaContent(html, "description") || metaContent(html, "og:description")),
    venue_name: venue,
    address: source.address || null,
    city: source.city,
    latitude: null,
    longitude: null,
    start_time: start,
    end_time: end,
    source: source.id,
    source_name: source.name,
    source_url: url,
    image_url: metaContent(html, "og:image"),
    ticket_status: /buy tickets|tickets/i.test(html) ? "available" : null,
  } satisfies NormalizedCityEvent;
}

async function fetchVenueHtml(source: InstitutionCalendarSource) {
  const listing = await fetchHtml(source.url);
  const listingEvents = parseCityCalendarJsonLd(listing, sourceAdapter(source));
  const listingFallbackEvents = parseVenueListingEvents(listing, source);
  const links = extractInstitutionDetailLinks(listing, source);
  const detailEvents = (await mapLimit(links, DETAIL_CONCURRENCY, async link => {
    try {
      const html = await fetchHtml(link);
      const structured = parseCityCalendarJsonLd(html, sourceAdapter(source, link), link);
      if (structured.length) return structured;
      const fallback = fallbackVenueDetail(source, html, link);
      return fallback ? [fallback] : [];
    } catch {
      return [] as NormalizedCityEvent[];
    }
  })).flat();
  const events = [...listingEvents, ...listingFallbackEvents, ...detailEvents];
  if (!events.length && !links.length) throw new Error("Official venue page exposed no event detail links or structured events");
  if (!events.length) throw new Error("Official venue event pages contained no parseable dates");
  return events;
}

async function fetchJsonLdHtml(source: InstitutionCalendarSource) {
  const html = await fetchHtml(source.url);
  const events = parseCityCalendarJsonLd(html, sourceAdapter(source));
  if (!events.length) throw new Error("Official institution page contained no Event structured data");
  return events;
}

async function fetchEmbeddedTourism(source: InstitutionCalendarSource) {
  const html = await fetchHtml(source.url);
  const events = parseVisitNorfolkEvents(html, source);
  if (!events.length) throw new Error("Official tourism page contained no parseable embedded events");
  return events;
}

export function institutionEventSignature(event: Pick<NormalizedCityEvent, "name" | "start_time" | "venue_name">) {
  const canonical = (value: string) => value.toLowerCase().normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/^the\s+/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const start = new Date(event.start_time);
  const minute = Number.isFinite(start.getTime()) ? start.toISOString().slice(0, 16) : event.start_time;
  return createHash("sha256")
    .update(`${canonical(event.name)}|${minute}|${canonical(event.venue_name)}`)
    .digest("hex")
    .slice(0, 32);
}

export function dedupeInstitutionEvents(events: NormalizedCityEvent[]) {
  const bySourceId = [...new Map(events.map(event => [event.source_event_id, event])).values()];
  return [...new Map(bySourceId.map(event => [institutionEventSignature(event), event])).values()];
}

export async function fetchInstitutionSource(source: InstitutionCalendarSource): Promise<InstitutionFeedResult> {
  const fetchedAt = new Date().toISOString();
  try {
    const events = source.format === "localist-api"
      ? await fetchLocalist(source)
      : source.format === "tribe-api"
        ? await fetchTribe(source)
        : source.format === "venue-html"
          ? await fetchVenueHtml(source)
          : source.format === "embedded-json"
            ? await fetchEmbeddedTourism(source)
            : await fetchJsonLdHtml(source);
    return { source, status: "ok", events: dedupeInstitutionEvents(events), error: null, fetchedAt };
  } catch (error) {
    return {
      source,
      status: "error",
      events: [],
      error: error instanceof Error ? error.message : "Unknown institution calendar error",
      fetchedAt,
    };
  }
}

export async function fetchAllInstitutionCalendars(
  sources = INSTITUTION_CALENDAR_SOURCES.filter(source => source.enabled),
) {
  const results = await mapLimit(sources, LISTING_CONCURRENCY, fetchInstitutionSource);
  const rawEvents = results.flatMap(result => result.events);
  const events = dedupeInstitutionEvents(rawEvents);
  return {
    generatedAt: new Date().toISOString(),
    results,
    events,
    summary: {
      registeredSources: sources.length,
      successfulSources: results.filter(result => result.status === "ok").length,
      failedSources: results.filter(result => result.status === "error").length,
      rawEvents: rawEvents.length,
      dedupedEvents: events.length,
      byKind: Object.fromEntries([...new Set(sources.map(source => source.kind))].map(kind => [
        kind,
        {
          registered: sources.filter(source => source.kind === kind).length,
          successful: results.filter(result => result.source.kind === kind && result.status === "ok").length,
          events: results.filter(result => result.source.kind === kind).reduce((sum, result) => sum + result.events.length, 0),
        },
      ])),
    },
  };
}
