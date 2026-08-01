import {
  cityEventFingerprint,
  type NormalizedCityEvent,
} from "./city-calendars";

const EASTERN_TIME_ZONE = "America/New_York";
const REQUEST_TIMEOUT_MS = 14_000;
const DETAIL_CONCURRENCY = 6;
const DEFAULT_DETAIL_LIMIT = 36;
const WINDOW_PAST_MS = 2 * 24 * 60 * 60 * 1000;
const WINDOW_FUTURE_MS = 180 * 24 * 60 * 60 * 1000;

export type SimpleviewRssSource = {
  id: string;
  name: string;
  city: string;
  url: string;
  apiOrigin?: string;
  venueName?: string;
};

export type SimpleviewRssItem = {
  title: string;
  link: string;
  guid: string | null;
  description: string | null;
  categories: string[];
  imageUrl: string | null;
  startDate: string | null;
  endDate: string | null;
};

type JsonRecord = Record<string, unknown>;

const SIMPLEVIEW_TOKEN_PATH = "/plugins/core/get_simple_token/";
const SIMPLEVIEW_EVENTS_PATH = "/includes/rest_v2/plugins_events_events_by_date/find/";

const FETCH_HEADERS = {
  Accept: "application/rss+xml,application/xml,text/xml,text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
  "User-Agent": "Buzz/1.0 (https://lit757.vercel.app; demetriusvharvey@gmail.com)",
};

function decodeEntities(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1")
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
  if (typeof value !== "string" || !value.trim()) return null;
  return decodeEntities(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim() || null;
}

function xmlValue(block: string, tag: string) {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = block.match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, "i"));
  return match?.[1] ? decodeEntities(match[1]).trim() : null;
}

function xmlValues(block: string, tag: string) {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...block.matchAll(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, "gi"))]
    .map(match => decodeEntities(match[1]).trim())
    .filter(Boolean);
}

function calendarDate(value: string) {
  const match = value.match(/\b(\d{2})\/(\d{2})\/(\d{4})\b/);
  return match ? `${match[3]}-${match[1]}-${match[2]}` : null;
}

function descriptionDates(value: string | null) {
  if (!value) return { startDate: null, endDate: null };
  const dates = [...value.matchAll(/\b(\d{2})\/(\d{2})\/(\d{4})\b/g)]
    .map(match => `${match[3]}-${match[1]}-${match[2]}`);
  return { startDate: dates[0] || null, endDate: dates[1] || dates[0] || null };
}

function descriptionImage(value: string | null) {
  if (!value) return null;
  return value.match(/<img\b[^>]*src=["']([^"']+)["']/i)?.[1] || null;
}

export function parseSimpleviewRssItems(xml: string): SimpleviewRssItem[] {
  const items: SimpleviewRssItem[] = [];
  for (const match of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const block = match[1];
    const title = cleanHtml(xmlValue(block, "title"));
    const link = xmlValue(block, "link");
    if (!title || !link) continue;
    const rawDescription = xmlValue(block, "description");
    const dates = descriptionDates(rawDescription);
    items.push({
      title,
      link,
      guid: xmlValue(block, "guid"),
      description: cleanHtml(rawDescription),
      categories: xmlValues(block, "category").map(category => cleanHtml(category)).filter((item): item is string => Boolean(item)),
      imageUrl: descriptionImage(rawDescription),
      startDate: dates.startDate,
      endDate: dates.endDate,
    });
  }
  return [...new Map(items.map(item => [item.link, item])).values()];
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function firstString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    for (const item of value) {
      const result = firstString(item);
      if (result) return result;
    }
  }
  const record = asRecord(value);
  return record
    ? firstString(record.url) || firstString(record.contentUrl) || firstString(record.name) || firstString(record.value)
    : null;
}

function schemaEventType(value: unknown) {
  const values = Array.isArray(value) ? value : [value];
  return values.some(item => {
    if (typeof item !== "string") return false;
    const type = item.split(/[\/#]/).at(-1) || item;
    return type === "Event" || type.endsWith("Event");
  });
}

function collectSchemaEvents(value: unknown, output: JsonRecord[]) {
  if (Array.isArray(value)) {
    value.forEach(item => collectSchemaEvents(item, output));
    return;
  }
  const record = asRecord(value);
  if (!record) return;
  if (schemaEventType(record["@type"])) output.push(record);
  Object.values(record).forEach(child => {
    if (child && typeof child === "object") collectSchemaEvents(child, output);
  });
}

function jsonLdRecords(html: string) {
  const records: JsonRecord[] = [];
  for (const match of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    const raw = match[1].trim();
    if (!raw) continue;
    for (const candidate of [raw, decodeEntities(raw)]) {
      try {
        collectSchemaEvents(JSON.parse(candidate), records);
        break;
      } catch {
        // Try the decoded candidate before skipping malformed page data.
      }
    }
  }
  return records;
}

function easternOffset(date: string) {
  const sample = new Date(`${date}T12:00:00Z`);
  const part = new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN_TIME_ZONE,
    timeZoneName: "shortOffset",
  }).formatToParts(sample).find(item => item.type === "timeZoneName")?.value || "GMT-5";
  const match = part.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/i);
  if (!match) return "-05:00";
  return `${match[1]}${match[2].padStart(2, "0")}:${(match[3] || "00").padStart(2, "0")}`;
}

function normalizedDate(value: unknown, end = false) {
  const raw = firstString(value);
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return `${raw}T${end ? "23:59:59" : "12:00:00"}${easternOffset(raw)}`;
  }
  const parsed = new Date(raw);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function addressFrom(value: unknown) {
  if (typeof value === "string") return cleanHtml(value);
  const address = asRecord(value);
  if (!address) return null;
  return [address.streetAddress, address.addressLocality, address.addressRegion, address.postalCode]
    .map(firstString)
    .filter((item): item is string => Boolean(item))
    .join(", ") || null;
}

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function easternCalendarDate(value: unknown) {
  const raw = firstString(value);
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = new Date(raw);
  if (!Number.isFinite(parsed.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(parsed);
  const year = parts.find(part => part.type === "year")?.value;
  const month = parts.find(part => part.type === "month")?.value;
  const day = parts.find(part => part.type === "day")?.value;
  return year && month && day ? `${year}-${month}-${day}` : null;
}

function localDateTime(date: string, value: unknown, end = false) {
  const raw = firstString(value);
  const match = raw?.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  const hour = match ? Number(match[1]) : end ? 23 : 12;
  const minute = match ? Number(match[2]) : end ? 59 : 0;
  const second = match?.[3] ? Number(match[3]) : end ? 59 : 0;
  if (hour > 23 || minute > 59 || second > 59) return null;
  return `${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}${easternOffset(date)}`;
}

function simpleviewEventUrl(source: SimpleviewRssSource, event: JsonRecord, title: string, recid: string) {
  const direct = firstString(event.url);
  if (direct) return new URL(direct, source.url).toString();
  const slug = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return new URL(`/event/${slug || "event"}/${encodeURIComponent(recid)}/`, source.url).toString();
}

function restImageUrl(event: JsonRecord) {
  for (const collection of [event._media, event.media_raw]) {
    if (!Array.isArray(collection)) continue;
    for (const item of collection) {
      const url = firstString(asRecord(item)?.mediaurl) || firstString(asRecord(item)?.url);
      if (url) return url;
    }
  }
  return null;
}

export function parseSimpleviewRestEvents(
  payload: unknown,
  source: SimpleviewRssSource,
): NormalizedCityEvent[] {
  const root = asRecord(payload);
  const docsContainer = asRecord(root?.docs);
  const docs = Array.isArray(docsContainer?.docs) ? docsContainer.docs : [];
  const events = docs.flatMap(item => {
    const event = asRecord(item);
    if (!event) return [];
    const title = cleanHtml(event.title);
    const dates = asRecord(event.dates);
    const date = easternCalendarDate(event.date)
      || easternCalendarDate(dates?.eventDate)
      || easternCalendarDate(event.nextDate)
      || easternCalendarDate(event.startDate);
    const recid = firstString(event.recid) || firstString(event.recId) || firstString(event._id);
    if (!title || !date || !recid) return [];

    const start = localDateTime(date, event.startTime);
    if (!start) return [];
    let end = firstString(event.endTime) ? localDateTime(date, event.endTime, true) : null;
    if (end && new Date(end).getTime() < new Date(start).getTime()) {
      end = new Date(new Date(end).getTime() + 24 * 60 * 60 * 1000).toISOString();
    }

    const address = [event.address1, event.address2, event.city, event.state, event.zip]
      .map(cleanHtml)
      .filter((part): part is string => Boolean(part))
      .join(", ") || null;
    const listing = asRecord(event.listing);
    const venue = cleanHtml(event.location) || cleanHtml(listing?.title) || address || source.name;
    const location = asRecord(event.loc);
    const coordinates = Array.isArray(location?.coordinates) ? location.coordinates : [];
    const longitude = numberValue(coordinates[0]) ?? numberValue(event.longitude);
    const latitude = numberValue(coordinates[1]) ?? numberValue(event.latitude);
    const sourceUrl = simpleviewEventUrl(source, event, title, recid);
    return [{
      source_event_id: cityEventFingerprint(source.id, `${recid}:${date}`, title, start, venue),
      name: title,
      description: cleanHtml(event.description),
      venue_name: venue,
      address,
      city: cleanHtml(event.city) || source.city,
      latitude,
      longitude,
      start_time: start,
      end_time: end,
      source: source.id,
      source_name: source.name,
      source_url: sourceUrl,
      image_url: restImageUrl(event),
      ticket_status: null,
    } satisfies NormalizedCityEvent];
  });
  return [...new Map(events.map(event => [event.source_event_id, event])).values()];
}

export function parseSimpleviewEventDetail(
  html: string,
  source: SimpleviewRssSource,
  fallbackUrl: string,
): NormalizedCityEvent[] {
  const events = jsonLdRecords(html).flatMap(event => {
    const name = cleanHtml(event.name);
    const start = normalizedDate(event.startDate);
    if (!name || !start) return [];
    const location = asRecord(event.location);
    const address = addressFrom(location?.address) || addressFrom(event.location);
    const venue = cleanHtml(location?.name) || address || source.venueName || source.name;
    const geo = asRecord(location?.geo);
    const sourceUrl = firstString(event.url) || fallbackUrl;
    const identifier = firstString(event.identifier) || firstString(event["@id"]) || sourceUrl;
    const offers = asRecord(event.offers);
    return [{
      source_event_id: cityEventFingerprint(source.id, identifier, name, start, venue),
      name,
      description: cleanHtml(event.description),
      venue_name: venue,
      address,
      city: source.city,
      latitude: numberValue(geo?.latitude),
      longitude: numberValue(geo?.longitude),
      start_time: start,
      end_time: normalizedDate(event.endDate, true),
      source: source.id,
      source_name: source.name,
      source_url: sourceUrl,
      image_url: firstString(event.image),
      ticket_status: firstString(offers?.url) || firstString(event.offers) ? "available" : null,
    } satisfies NormalizedCityEvent];
  });
  return [...new Map(events.map(event => [event.source_event_id, event])).values()];
}

function fallbackEvent(item: SimpleviewRssItem, source: SimpleviewRssSource): NormalizedCityEvent | null {
  const startDate = item.startDate || calendarDate(item.description || "");
  if (!startDate) return null;
  const start = normalizedDate(startDate)!;
  const venue = source.venueName || source.city;
  return {
    source_event_id: cityEventFingerprint(source.id, item.guid || item.link, item.title, start, venue),
    name: item.title,
    description: item.description,
    venue_name: venue,
    address: null,
    city: source.city,
    latitude: null,
    longitude: null,
    start_time: start,
    end_time: normalizedDate(item.endDate, true),
    source: source.id,
    source_name: source.name,
    source_url: item.link,
    image_url: item.imageUrl,
    ticket_status: null,
  };
}

function currentWindow(event: NormalizedCityEvent, now: Date) {
  const start = new Date(event.start_time).getTime();
  const end = new Date(event.end_time || event.start_time).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
  return end >= now.getTime() - WINDOW_PAST_MS && start <= now.getTime() + WINDOW_FUTURE_MS;
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

async function fetchText(url: string) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: FETCH_HEADERS,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Simpleview calendar request failed (${response.status})`);
  return response.text();
}

async function fetchSimpleviewRestCalendar(
  source: SimpleviewRssSource,
  limit: number,
  now: Date,
) {
  const apiOrigin = source.apiOrigin || source.url;
  const tokenUrl = new URL(SIMPLEVIEW_TOKEN_PATH, apiOrigin).toString();
  const token = (await fetchText(tokenUrl)).trim();
  if (!token) throw new Error("Simpleview public calendar token was empty");

  const query = {
    // Akamai rejects Simpleview's `$date` query syntax from server runtimes.
    // Ask for the next active rows, then enforce Buzz's time window below.
    filter: {
      active: true,
    },
    options: {
      limit,
      count: true,
      castDocs: false,
      sort: { date: 1, rank: 1, title_sort: 1 },
    },
  };
  const endpoint = new URL(SIMPLEVIEW_EVENTS_PATH, apiOrigin);
  endpoint.searchParams.set("json", JSON.stringify(query));
  endpoint.searchParams.set("token", token);
  const response = await fetch(endpoint, {
    cache: "no-store",
    headers: {
      ...FETCH_HEADERS,
      Accept: "application/json",
      Referer: new URL("/events-and-festivals/", source.url).toString(),
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Simpleview REST calendar request failed (${response.status})`);
  const events = parseSimpleviewRestEvents(await response.json(), source)
    .filter(event => currentWindow(event, now));
  if (!events.length) throw new Error("Official tourism REST calendar returned no current events");
  return events;
}

async function fetchSimpleviewRssFeedCalendar(
  source: SimpleviewRssSource,
  detailLimit: number,
  now: Date,
) {
  const rss = await fetchText(source.url);
  if (!/<rss\b/i.test(rss) || !/<item\b/i.test(rss)) {
    throw new Error("Official tourism source did not return an RSS event feed");
  }
  const items = parseSimpleviewRssItems(rss).slice(0, detailLimit);
  if (!items.length) throw new Error("Official tourism RSS feed returned no event items");

  const events = (await mapLimit(items, DETAIL_CONCURRENCY, async item => {
    try {
      const html = await fetchText(item.link);
      const detailed = parseSimpleviewEventDetail(html, source, item.link);
      return detailed.length ? detailed : [fallbackEvent(item, source)].filter((event): event is NormalizedCityEvent => Boolean(event));
    } catch {
      const fallback = fallbackEvent(item, source);
      return fallback ? [fallback] : [];
    }
  })).flat().filter(event => currentWindow(event, now));

  if (!events.length) throw new Error("Official tourism RSS details contained no current events");
  return [...new Map(events.map(event => [event.source_event_id, event])).values()];
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function fetchSimpleviewRssCalendar(
  source: SimpleviewRssSource,
  detailLimit = DEFAULT_DETAIL_LIMIT,
  now = new Date(),
) {
  try {
    return await fetchSimpleviewRssFeedCalendar(source, detailLimit, now);
  } catch (rssError) {
    try {
      return await fetchSimpleviewRestCalendar(source, detailLimit, now);
    } catch (restError) {
      throw new Error(
        `Official tourism calendar failed via RSS (${errorMessage(rssError)}) and REST fallback (${errorMessage(restError)})`,
      );
    }
  }
}
