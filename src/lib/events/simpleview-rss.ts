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

export async function fetchSimpleviewRssCalendar(
  source: SimpleviewRssSource,
  detailLimit = DEFAULT_DETAIL_LIMIT,
  now = new Date(),
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
