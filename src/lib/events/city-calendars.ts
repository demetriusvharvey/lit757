import { createHash } from "node:crypto";

export type CityCalendarSource = {
  id: string;
  name: string;
  city: string;
  url: string;
  format: "ics" | "html-jsonld" | "vb-city-html" | "unverified";
  enabled: boolean;
  timeZone?: string;
  venueName?: string;
  maxDetailPages?: number;
};

export type NormalizedCityEvent = {
  source_event_id: string;
  name: string;
  description: string | null;
  venue_name: string;
  address: string | null;
  city: string;
  latitude: number | null;
  longitude: number | null;
  start_time: string;
  end_time: string | null;
  source: string;
  source_name: string;
  source_url: string | null;
  image_url: string | null;
  ticket_status: string | null;
};

export type CityCalendarProvider = {
  source: CityCalendarSource;
  fetchEvents(): Promise<NormalizedCityEvent[]>;
};

type VirginiaBeachListingEvent = {
  name: string;
  date: string;
  url: string;
};

export const CITY_CALENDAR_SOURCES: CityCalendarSource[] = [
  {
    id: "virginia_beach_official",
    name: "City of Virginia Beach Event Calendar",
    city: "Virginia Beach",
    url: "https://virginiabeach.gov/connect/events",
    format: "vb-city-html",
    enabled: true,
    timeZone: "America/New_York",
    maxDetailPages: 30,
  },
  { id: "norfolk_official", name: "Norfolk Official Events", city: "Norfolk", url: "https://www.norfolk.gov/calendar.aspx", format: "unverified", enabled: false, timeZone: "America/New_York" },
  { id: "chesapeake_official", name: "Chesapeake Official Events", city: "Chesapeake", url: "https://www.cityofchesapeake.net/Calendar.aspx", format: "unverified", enabled: false, timeZone: "America/New_York" },
  { id: "portsmouth_official", name: "Portsmouth Official Events", city: "Portsmouth", url: "https://www.portsmouthva.gov/calendar.aspx", format: "unverified", enabled: false, timeZone: "America/New_York" },
  { id: "hampton_official", name: "Hampton Official Events", city: "Hampton", url: "https://www.hampton.gov/calendar.aspx", format: "unverified", enabled: false, timeZone: "America/New_York" },
  { id: "newport_news_official", name: "Newport News Official Events", city: "Newport News", url: "https://www.nnva.gov/calendar.aspx", format: "unverified", enabled: false, timeZone: "America/New_York" },
  { id: "suffolk_official", name: "Suffolk Official Events", city: "Suffolk", url: "https://www.suffolkva.us/calendar.aspx", format: "unverified", enabled: false, timeZone: "America/New_York" },
];

const HTML_HEADERS = {
  Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
  "User-Agent": "Buzz/1.0 (https://lit757.vercel.app; demetriusvharvey@gmail.com)",
};

type IcsProperty = {
  value: string;
  params: Record<string, string>;
};

function clean(value: string) {
  return value.replace(/\\n/gi, " ").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\").trim();
}

function unfoldIcs(text: string) {
  return text.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "").split(/\r?\n/);
}

function propertyEntry(lines: string[], name: string): IcsProperty | null {
  const line = lines.find(item => item.startsWith(`${name}:`) || item.startsWith(`${name};`));
  if (!line) return null;
  const separator = line.indexOf(":");
  if (separator < 0) return null;

  const [propertyName, ...rawParams] = line.slice(0, separator).split(";");
  if (propertyName !== name) return null;

  const params: Record<string, string> = {};
  for (const rawParam of rawParams) {
    const equals = rawParam.indexOf("=");
    if (equals <= 0) continue;
    const key = rawParam.slice(0, equals).trim().toUpperCase();
    const value = rawParam.slice(equals + 1).trim().replace(/^"|"$/g, "");
    if (key && value) params[key] = value;
  }

  return { value: clean(line.slice(separator + 1)), params };
}

function property(lines: string[], name: string) {
  return propertyEntry(lines, name)?.value || null;
}

function zonedDateTimeToIso(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
) {
  const target = Date.UTC(year, month - 1, day, hour, minute, second);
  let candidate = target;

  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });

    for (let iteration = 0; iteration < 3; iteration += 1) {
      const parts = Object.fromEntries(
        formatter.formatToParts(new Date(candidate))
          .filter(part => part.type !== "literal")
          .map(part => [part.type, Number(part.value)]),
      );
      const represented = Date.UTC(
        Number(parts.year),
        Number(parts.month) - 1,
        Number(parts.day),
        Number(parts.hour),
        Number(parts.minute),
        Number(parts.second),
      );
      const adjustment = target - represented;
      candidate += adjustment;
      if (adjustment === 0) break;
    }

    return new Date(candidate).toISOString();
  } catch {
    return null;
  }
}

function parseIcsDate(value: string, timeZone = "America/New_York") {
  const raw = value.trim();
  if (/^\d{8}$/.test(raw)) return new Date(`${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T00:00:00Z`).toISOString();
  const match = raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (!match) return toIso(raw);

  const [, year, month, day, hour, minute, second, zulu] = match;
  if (zulu) {
    return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second))).toISOString();
  }

  return zonedDateTimeToIso(
    Number(year),
    Number(month),
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    timeZone,
  );
}

function toIso(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
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

function stripHtml(value: unknown) {
  if (typeof value !== "string") return null;
  const cleaned = decodeHtml(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
  return cleaned || null;
}

function htmlLines(value: string) {
  return decodeHtml(
    value
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<(?:br\s*\/?|\/p|\/div|\/li|\/h[1-6])>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .split(/\n+/)
    .map(line => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function firstString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstString(item);
      if (found) return found;
    }
  }
  const record = asRecord(value);
  if (record) return firstString(record.url) || firstString(record.contentUrl) || firstString(record.value) || firstString(record.name);
  return null;
}

function formatAddress(value: unknown) {
  if (typeof value === "string") return stripHtml(value);
  const address = asRecord(value);
  if (!address) return null;
  return [address.streetAddress, address.addressLocality, address.addressRegion, address.postalCode]
    .map(firstString)
    .filter((part): part is string => Boolean(part))
    .join(", ") || null;
}

function eventType(value: unknown) {
  const values = Array.isArray(value) ? value : [value];
  return values.some(item => typeof item === "string" && (item === "Event" || item.endsWith("/Event")));
}

function jsonLdValues(html: string) {
  const values: unknown[] = [];
  const expression = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(expression)) {
    const raw = match[1].trim();
    if (!raw) continue;
    try {
      values.push(JSON.parse(raw));
    } catch {
      try {
        values.push(JSON.parse(decodeHtml(raw)));
      } catch {
        // Invalid structured data should not break the whole source.
      }
    }
  }
  return values;
}

function collectEventRecords(value: unknown, output: Record<string, unknown>[]) {
  if (Array.isArray(value)) {
    for (const item of value) collectEventRecords(item, output);
    return;
  }
  const record = asRecord(value);
  if (!record) return;
  if (eventType(record["@type"])) output.push(record);
  for (const child of Object.values(record)) {
    if (child && typeof child === "object") collectEventRecords(child, output);
  }
}

function eventIdentifier(event: Record<string, unknown>, sourceUrl: string) {
  const explicit = firstString(event.identifier) || firstString(event["@id"]);
  if (explicit) return explicit;
  const match = sourceUrl.match(/\/(\d+)\/?(?:[?#].*)?$/);
  return match?.[1] || null;
}

function normalizeJsonLdEvent(event: Record<string, unknown>, source: CityCalendarSource, fallbackUrl: string): NormalizedCityEvent | null {
  const name = stripHtml(event.name);
  const start = toIso(event.startDate);
  if (!name || !start) return null;

  const location = asRecord(event.location);
  const sourceUrl = firstString(event.url) || fallbackUrl;
  const address = formatAddress(location?.address) || formatAddress(event.location);
  const venueName = stripHtml(location?.name) || address || source.venueName || source.name;
  const geo = asRecord(location?.geo);

  return {
    source_event_id: cityEventFingerprint(source.id, eventIdentifier(event, sourceUrl), name, start, venueName),
    name,
    description: stripHtml(event.description),
    venue_name: venueName,
    address,
    city: source.city,
    latitude: numberOrNull(geo?.latitude),
    longitude: numberOrNull(geo?.longitude),
    start_time: start,
    end_time: toIso(event.endDate),
    source: source.id,
    source_name: source.name,
    source_url: sourceUrl,
    image_url: firstString(event.image),
    ticket_status: null,
  };
}

function sectionHtml(html: string, headingPattern: string) {
  const heading = new RegExp(`<h[1-6][^>]*>[\\s\\S]*?${headingPattern}[\\s\\S]*?<\\/h[1-6]>`, "i").exec(html);
  if (!heading || heading.index === undefined) return null;
  const rest = html.slice(heading.index + heading[0].length);
  const nextHeading = rest.search(/<h[1-6]\b/i);
  return nextHeading >= 0 ? rest.slice(0, nextHeading) : rest;
}

function markerSectionHtml(html: string, markerPattern: string) {
  const marker = new RegExp(markerPattern, "i").exec(html);
  if (!marker || marker.index === undefined) return null;
  const rest = html.slice(marker.index + marker[0].length);
  const nextHeading = rest.search(/<h[1-6]\b/i);
  return nextHeading >= 0 ? rest.slice(0, nextHeading) : rest;
}

function clockParts(hourValue: string, minuteValue: string | undefined, meridiem: string) {
  let hour = Number(hourValue) % 12;
  if (meridiem.toLowerCase() === "p") hour += 12;
  return { hour, minute: Number(minuteValue || 0) };
}

function eventTimesFromText(date: string, text: string, timeZone: string) {
  const [year, month, day] = date.split("-").map(Number);
  const range = text.match(/(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?\s*[-–]\s*(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?/i);
  if (range) {
    const startClock = clockParts(range[1], range[2], range[3]);
    const endClock = clockParts(range[4], range[5], range[6]);
    const start = zonedDateTimeToIso(year, month, day, startClock.hour, startClock.minute, 0, timeZone);
    let end = zonedDateTimeToIso(year, month, day, endClock.hour, endClock.minute, 0, timeZone);
    if (start && end && new Date(end).getTime() < new Date(start).getTime()) {
      end = new Date(new Date(end).getTime() + 24 * 60 * 60 * 1000).toISOString();
    }
    return { start, end };
  }

  const single = text.match(/(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?/i);
  if (single) {
    const clock = clockParts(single[1], single[2], single[3]);
    return {
      start: zonedDateTimeToIso(year, month, day, clock.hour, clock.minute, 0, timeZone),
      end: null,
    };
  }

  return {
    start: zonedDateTimeToIso(year, month, day, 0, 0, 0, timeZone),
    end: null,
  };
}

export function cityEventFingerprint(source: string, externalId: string | null, title: string, start: string, venue: string) {
  const key = externalId || `${title.trim().toLowerCase()}|${start}|${venue.trim().toLowerCase()}`;
  return `${source}_${createHash("sha256").update(key).digest("hex").slice(0, 32)}`;
}

export function parseCityCalendarIcs(text: string, source: CityCalendarSource): NormalizedCityEvent[] {
  const lines = unfoldIcs(text);
  const events: NormalizedCityEvent[] = [];
  let current: string[] | null = null;

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      current = [];
      continue;
    }
    if (line === "END:VEVENT") {
      if (!current) continue;
      const title = property(current, "SUMMARY");
      const startProperty = propertyEntry(current, "DTSTART");
      const start = startProperty
        ? parseIcsDate(startProperty.value, startProperty.params.TZID || source.timeZone)
        : null;
      if (title && start) {
        const location = property(current, "LOCATION") || source.venueName || source.name;
        const externalId = property(current, "UID");
        const endProperty = propertyEntry(current, "DTEND");
        events.push({
          source_event_id: cityEventFingerprint(source.id, externalId, title, start, location),
          name: title,
          description: property(current, "DESCRIPTION"),
          venue_name: location,
          address: location,
          city: source.city,
          latitude: null,
          longitude: null,
          start_time: start,
          end_time: endProperty
            ? parseIcsDate(endProperty.value, endProperty.params.TZID || startProperty?.params.TZID || source.timeZone)
            : null,
          source: source.id,
          source_name: source.name,
          source_url: property(current, "URL") || source.url,
          image_url: property(current, "IMAGE"),
          ticket_status: null,
        });
      }
      current = null;
      continue;
    }
    if (current) current.push(line);
  }

  return events;
}

export function parseCityCalendarJsonLd(html: string, source: CityCalendarSource, fallbackUrl = source.url) {
  const records: Record<string, unknown>[] = [];
  for (const value of jsonLdValues(html)) collectEventRecords(value, records);
  const events = records
    .map(record => normalizeJsonLdEvent(record, source, fallbackUrl))
    .filter((event): event is NormalizedCityEvent => Boolean(event));
  return [...new Map(events.map(event => [event.source_event_id, event])).values()];
}

export function extractEventDetailLinks(html: string, source: CityCalendarSource) {
  const base = new URL(source.url);
  const links: string[] = [];
  const expression = /href\s*=\s*["']([^"']+)["']/gi;
  for (const match of html.matchAll(expression)) {
    const raw = decodeHtml(match[1]).trim();
    if (!raw || raw.startsWith("#") || raw.startsWith("mailto:") || raw.startsWith("javascript:")) continue;
    try {
      const resolved = new URL(raw, base);
      if (resolved.origin !== base.origin) continue;
      if (!/^\/event\/[^?#]+\/\d+\/?$/i.test(resolved.pathname)) continue;
      resolved.hash = "";
      resolved.search = "";
      links.push(resolved.toString());
    } catch {
      // Ignore malformed links from third-party markup.
    }
  }
  return [...new Set(links)];
}

export function parseVirginiaBeachEventListing(html: string, source: CityCalendarSource) {
  const base = new URL(source.url);
  const events: VirginiaBeachListingEvent[] = [];
  const expression = /<a\b[^>]*href=["']([^"']*\/connect\/events\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

  for (const match of html.matchAll(expression)) {
    const name = stripHtml(match[2]);
    if (!name) continue;
    try {
      const url = new URL(decodeHtml(match[1]), base);
      if (url.origin !== base.origin) continue;
      const date = url.pathname.match(/\/(\d{4}-\d{2}-\d{2})\/?$/)?.[1];
      if (!date) continue;
      url.hash = "";
      events.push({ name, date, url: url.toString() });
    } catch {
      // Ignore malformed event links.
    }
  }

  return [...new Map(events.map(event => [event.url, event])).values()];
}

export function parseVirginiaBeachEventDetail(
  html: string,
  listing: VirginiaBeachListingEvent,
  source: CityCalendarSource,
): NormalizedCityEvent {
  const title = stripHtml(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]) || listing.name;
  const dateSection = sectionHtml(html, "Date\\s*(?:&amp;|&)\\s*Time");
  const dateText = dateSection ? htmlLines(dateSection).join(" ") : "";
  const times = eventTimesFromText(listing.date, dateText, source.timeZone || "America/New_York");
  const locationSection = sectionHtml(html, "Location");
  const locationLines = locationSection ? htmlLines(locationSection).slice(0, 4) : [];
  const venueName = locationLines[0] || source.venueName || source.name;
  const address = locationLines.length > 1 ? locationLines.slice(1).join(", ") : null;
  const descriptionSection = markerSectionHtml(html, "Event\\s+Details\\s*:");
  const description = descriptionSection ? stripHtml(descriptionSection) : null;
  const start = times.start || zonedDateTimeToIso(
    Number(listing.date.slice(0, 4)),
    Number(listing.date.slice(5, 7)),
    Number(listing.date.slice(8, 10)),
    0,
    0,
    0,
    source.timeZone || "America/New_York",
  )!;

  return {
    source_event_id: cityEventFingerprint(source.id, listing.url, title, start, venueName),
    name: title,
    description,
    venue_name: venueName,
    address,
    city: source.city,
    latitude: null,
    longitude: null,
    start_time: start,
    end_time: times.end,
    source: source.id,
    source_name: source.name,
    source_url: listing.url,
    image_url: null,
    ticket_status: null,
  };
}

async function fetchText(url: string, headers: Record<string, string>, timeoutMs = 12_000) {
  const response = await fetch(url, {
    cache: "no-store",
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`City calendar request failed (${response.status})`);
  return response.text();
}

async function mapLimit<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => run()));
  return results;
}

function datedListingUrl(source: CityCalendarSource) {
  const url = new URL(source.url);
  const format = (date: Date) => `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
  url.searchParams.set("startDate", format(new Date()));
  url.searchParams.set("endDate", format(new Date(Date.now() + 120 * 24 * 60 * 60 * 1000)));
  url.searchParams.set("sort", "date");
  url.searchParams.set("skip", "0");
  return url.toString();
}

function monthlyListingUrls(source: CityCalendarSource) {
  const start = new Date();
  const end = new Date(Date.now() + 120 * 24 * 60 * 60 * 1000);
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const urls: string[] = [];
  while (cursor <= end) {
    const url = new URL(source.url);
    url.searchParams.set("date", `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`);
    urls.push(url.toString());
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return urls;
}

export function createIcsCityCalendarProvider(source: CityCalendarSource): CityCalendarProvider {
  return {
    source,
    async fetchEvents() {
      const text = await fetchText(source.url, { Accept: "text/calendar,text/plain;q=0.9,*/*;q=0.5" });
      if (!text.includes("BEGIN:VCALENDAR") && !text.includes("BEGIN:VEVENT")) {
        throw new Error("City calendar source did not return ICS content");
      }
      return parseCityCalendarIcs(text, source);
    },
  };
}

export function createHtmlJsonLdCityCalendarProvider(source: CityCalendarSource): CityCalendarProvider {
  return {
    source,
    async fetchEvents() {
      const listingUrl = datedListingUrl(source);
      const listingHtml = await fetchText(listingUrl, HTML_HEADERS, 15_000);
      const listingEvents = parseCityCalendarJsonLd(listingHtml, source, listingUrl);
      const links = extractEventDetailLinks(listingHtml, source).slice(0, source.maxDetailPages || 30);

      if (!links.length) {
        if (listingEvents.length || /no events|no matching events/i.test(listingHtml)) return listingEvents;
        throw new Error("City calendar layout returned no structured events or event detail links");
      }

      const detailEvents = (await mapLimit(links, 5, async link => {
        try {
          const html = await fetchText(link, HTML_HEADERS, 8_000);
          return parseCityCalendarJsonLd(html, source, link);
        } catch (error) {
          console.warn("City calendar detail fetch failed", {
            source: source.id,
            url: link,
            error: error instanceof Error ? error.message : "Unknown error",
          });
          return [] as NormalizedCityEvent[];
        }
      })).flat();

      const events = [...listingEvents, ...detailEvents];
      if (!events.length) throw new Error("City calendar event pages contained no valid Event structured data");
      return [...new Map(events.map(event => [event.source_event_id, event])).values()];
    },
  };
}

export function createVirginiaBeachCityCalendarProvider(source: CityCalendarSource): CityCalendarProvider {
  return {
    source,
    async fetchEvents() {
      const listingPages = await mapLimit(monthlyListingUrls(source), 3, url => fetchText(url, HTML_HEADERS, 12_000));
      const listings = [...new Map(
        listingPages.flatMap(html => parseVirginiaBeachEventListing(html, source)).map(event => [event.url, event]),
      ).values()].slice(0, source.maxDetailPages || 30);

      if (!listings.length) throw new Error("Virginia Beach calendar returned no dated event links");

      return mapLimit(listings, 5, async listing => {
        try {
          const html = await fetchText(listing.url, HTML_HEADERS, 8_000);
          return parseVirginiaBeachEventDetail(html, listing, source);
        } catch (error) {
          console.warn("Virginia Beach event detail fetch failed", {
            url: listing.url,
            error: error instanceof Error ? error.message : "Unknown error",
          });
          const [year, month, day] = listing.date.split("-").map(Number);
          const start = zonedDateTimeToIso(year, month, day, 0, 0, 0, source.timeZone || "America/New_York")!;
          return {
            source_event_id: cityEventFingerprint(source.id, listing.url, listing.name, start, source.name),
            name: listing.name,
            description: null,
            venue_name: source.name,
            address: null,
            city: source.city,
            latitude: null,
            longitude: null,
            start_time: start,
            end_time: null,
            source: source.id,
            source_name: source.name,
            source_url: listing.url,
            image_url: null,
            ticket_status: null,
          };
        }
      });
    },
  };
}

export function createCityCalendarProvider(source: CityCalendarSource): CityCalendarProvider {
  if (source.format === "vb-city-html") return createVirginiaBeachCityCalendarProvider(source);
  if (source.format === "html-jsonld") return createHtmlJsonLdCityCalendarProvider(source);
  if (source.format === "ics") return createIcsCityCalendarProvider(source);
  throw new Error(`City calendar format is not verified for ${source.id}`);
}
