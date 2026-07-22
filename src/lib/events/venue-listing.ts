import { cityEventFingerprint, type NormalizedCityEvent } from "./city-calendars";
import type { InstitutionCalendarSource } from "./institution-calendars";

const EASTERN_TIME_ZONE = "America/New_York";
const MONTHS: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

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

function clean(value: string) {
  return decodeHtml(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function zonedDateTimeToIso(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone = EASTERN_TIME_ZONE,
) {
  const target = Date.UTC(year, month - 1, day, hour, minute, 0);
  let candidate = target;
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
      Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour), Number(parts.minute), Number(parts.second),
    );
    const adjustment = target - represented;
    candidate += adjustment;
    if (adjustment === 0) break;
  }
  return new Date(candidate).toISOString();
}

function informativeTitle(value: string) {
  const title = clean(value);
  if (!title || /^(buy tickets|more info|event details|tickets|learn more)$/i.test(title)) return null;
  return title;
}

function nearestDate(text: string) {
  const expression = /(?:Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)?\s*\|?\s*(January|February|March|April|May|June|July|August|September|Sept|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})(?:\s*-\s*\d{1,2})?\s*(?:\/|,)\s*(\d{4})/gi;
  let result: { year: number; month: number; day: number } | null = null;
  for (const match of text.matchAll(expression)) {
    result = {
      year: Number(match[3]),
      month: MONTHS[match[1].toLowerCase()],
      day: Number(match[2]),
    };
  }
  return result;
}

function eventTime(text: string) {
  const match = text.match(/Event\s+Starts\s+(\d{1,2})(?::(\d{2}))?\s*([AP])\.?M\.?/i)
    || text.match(/\b(\d{1,2}):(\d{2})\s*([AP])\.?M\.?\b/i);
  if (!match) return { hour: 0, minute: 0, found: false };
  let hour = Number(match[1]) % 12;
  if (match[3].toUpperCase() === "P") hour += 12;
  return { hour, minute: Number(match[2] || 0), found: true };
}

export function parseVenueListingEvents(
  html: string,
  source: InstitutionCalendarSource,
): NormalizedCityEvent[] {
  if (!source.detailPathPrefix) return [];
  const base = new URL(source.url);
  const anchors: Array<{ url: string; title: string; index: number }> = [];
  const expression = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(expression)) {
    const title = informativeTitle(match[2]);
    if (!title || match.index === undefined) continue;
    try {
      const url = new URL(decodeHtml(match[1]), base);
      if (url.origin !== base.origin || !url.pathname.startsWith(source.detailPathPrefix)) continue;
      url.hash = "";
      anchors.push({ url: url.toString(), title, index: match.index });
    } catch {
      // Ignore malformed venue links.
    }
  }

  const grouped = new Map<string, { url: string; title: string; index: number }>();
  for (const anchor of anchors) {
    const current = grouped.get(anchor.url);
    if (!current || anchor.title.length > current.title.length) grouped.set(anchor.url, anchor);
  }

  const events: NormalizedCityEvent[] = [];
  for (const item of grouped.values()) {
    const before = clean(html.slice(Math.max(0, item.index - 2200), item.index));
    const after = clean(html.slice(item.index, Math.min(html.length, item.index + 1400)));
    const date = nearestDate(before);
    if (!date) continue;
    const time = eventTime(after);
    const start = zonedDateTimeToIso(date.year, date.month, date.day, time.hour, time.minute);
    const venue = source.venueName || source.name;
    events.push({
      source_event_id: cityEventFingerprint(source.id, item.url, item.title, start, venue),
      name: item.title,
      description: null,
      venue_name: venue,
      address: null,
      city: source.city,
      latitude: null,
      longitude: null,
      start_time: start,
      end_time: null,
      source: source.id,
      source_name: source.name,
      source_url: item.url,
      image_url: null,
      ticket_status: /buy tickets/i.test(after) ? "available" : null,
    });
  }

  return [...new Map(events.map(event => [event.source_event_id, event])).values()];
}
