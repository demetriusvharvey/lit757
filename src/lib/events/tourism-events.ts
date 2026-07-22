import { cityEventFingerprint, type NormalizedCityEvent } from "./city-calendars";

const EASTERN_TIME_ZONE = "America/New_York";

type TourismSource = {
  id: string;
  name: string;
  city: string;
  url: string;
};

type EmbeddedTourismEvent = {
  title?: unknown;
  id?: unknown;
  url?: unknown;
  img?: unknown;
  desc?: unknown;
  dates?: unknown;
  time?: unknown;
  label?: unknown;
  type?: unknown;
};

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function decodeHtml(value: string) {
  return value
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function cleanHtml(value: unknown) {
  const raw = text(value);
  return raw ? decodeHtml(raw.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim() || null : null;
}

function extractBalancedArray(html: string, start: number) {
  let depth = 0;
  let string = false;
  let escaped = false;
  for (let index = start; index < html.length; index += 1) {
    const character = html[index];
    if (string) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') string = false;
      continue;
    }
    if (character === '"') string = true;
    else if (character === "[") depth += 1;
    else if (character === "]") {
      depth -= 1;
      if (depth === 0) return html.slice(start, index + 1);
    }
  }
  return null;
}

export function extractTourismEventRows(html: string) {
  const decoded = decodeHtml(html);
  const arrays: EmbeddedTourismEvent[][] = [];
  let cursor = 0;
  while (cursor < decoded.length) {
    const start = decoded.indexOf('[{"title"', cursor);
    if (start < 0) break;
    const candidate = extractBalancedArray(decoded, start);
    cursor = start + 10;
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate);
      if (!Array.isArray(parsed)) continue;
      const rows = parsed.filter((item): item is EmbeddedTourismEvent => (
        Boolean(item && typeof item === "object" && text((item as EmbeddedTourismEvent).title))
      ));
      if (rows.length) arrays.push(rows);
    } catch {
      // The page can contain unrelated JavaScript arrays; ignore invalid candidates.
    }
  }
  return arrays.sort((left, right) => right.length - left.length)[0] || [];
}

function easternOffset(date: string) {
  const sample = new Date(`${date}T12:00:00Z`);
  const part = new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN_TIME_ZONE,
    timeZoneName: "shortOffset",
  }).formatToParts(sample).find(item => item.type === "timeZoneName")?.value || "GMT-5";
  const match = part.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/i);
  if (!match) return "-05:00";
  const sign = match[1];
  const hours = match[2].padStart(2, "0");
  const minutes = (match[3] || "00").padStart(2, "0");
  return `${sign}${hours}:${minutes}`;
}

function clock(value: string | null) {
  if (!value || /all day|time may vary|varies|tbd/i.test(value)) return null;
  const match = value.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] || "0");
  const meridiem = match[3].toLowerCase().startsWith("p") ? "pm" : "am";
  if (hour === 12) hour = 0;
  if (meridiem === "pm") hour += 12;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function clocks(value: string | null) {
  if (!value) return [] as string[];
  const matches = [...value.matchAll(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/gi)];
  return matches.map(match => clock(match[0])).filter((item): item is string => Boolean(item));
}

function localIso(date: string, time: string | null) {
  return `${date}T${time || "12:00"}:00${easternOffset(date)}`;
}

function dateFromEpoch(value: unknown) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return null;
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}

function resolveUrl(value: unknown, source: TourismSource) {
  const raw = text(value);
  if (!raw) return source.url;
  try {
    return new URL(raw, source.url).toString();
  } catch {
    return source.url;
  }
}

function resolveOptionalUrl(value: unknown, source: TourismSource) {
  const raw = text(value);
  if (!raw) return null;
  try {
    return new URL(raw, source.url).toString();
  } catch {
    return null;
  }
}

export function parseVisitNorfolkEvents(html: string, source: TourismSource): NormalizedCityEvent[] {
  const rows = extractTourismEventRows(html);
  const events: NormalizedCityEvent[] = [];
  for (const row of rows) {
    const title = cleanHtml(row.title);
    const dates = Array.isArray(row.dates) ? row.dates.map(dateFromEpoch).filter((item): item is string => Boolean(item)) : [];
    if (!title || !dates.length) continue;
    const timeLabel = cleanHtml(row.time);
    const parsedClocks = clocks(timeLabel);
    const startClock = parsedClocks[0] || null;
    const endClock = parsedClocks[1] || null;
    const sourceUrl = resolveUrl(row.url, source);
    const imageUrl = resolveOptionalUrl(row.img, source);
    for (const date of dates) {
      const start = localIso(date, startClock);
      const venue = "Norfolk";
      events.push({
        source_event_id: cityEventFingerprint(source.id, `${String(row.id || sourceUrl)}:${date}`, title, start, venue),
        name: title,
        description: cleanHtml(row.desc) || cleanHtml(row.label),
        venue_name: venue,
        address: null,
        city: source.city,
        latitude: null,
        longitude: null,
        start_time: start,
        end_time: endClock ? localIso(date, endClock) : null,
        source: source.id,
        source_name: source.name,
        source_url: sourceUrl,
        image_url: imageUrl,
        ticket_status: /ticket|featured|marquee/i.test(`${row.label || ""} ${row.type || ""}`) ? "available" : null,
      });
    }
  }
  return [...new Map(events.map(event => [event.source_event_id, event])).values()];
}
