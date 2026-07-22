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
  cancelled?: boolean;
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

type IcsProperty = {
  value: string;
  params: Record<string, string>;
};

type CompactIcsParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  allDay: boolean;
  zulu: boolean;
};

type ParsedRRule = {
  freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  interval: number;
  count: number | null;
  until: string | null;
  byDay: string[];
  byMonthDay: number[];
};

const EASTERN_TIME_ZONE = "America/New_York";
const VB_LISTING_TIMEOUT_MS = 7_000;
const VB_DETAIL_TIMEOUT_MS = 6_000;
const VB_LISTING_CONCURRENCY = 5;
const VB_DETAIL_CONCURRENCY = 6;
const VB_DETAIL_PAGE_LIMIT = 18;
const RECURRENCE_WINDOW_PAST_MS = 24 * 60 * 60 * 1000;
const RECURRENCE_WINDOW_FUTURE_MS = 121 * 24 * 60 * 60 * 1000;
const MAX_RECURRENCE_ITERATIONS = 100_000;
const MAX_RECURRENCE_OCCURRENCES = 2_000;
const DAY_CODE_TO_UTC_DAY: Record<string, number> = {
  SU: 0,
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
};

export const CITY_CALENDAR_SOURCES: CityCalendarSource[] = [
  {
    id: "virginia_beach_official",
    name: "City of Virginia Beach Event Calendar",
    city: "Virginia Beach",
    url: "https://virginiabeach.gov/connect/events",
    format: "vb-city-html",
    enabled: true,
    timeZone: EASTERN_TIME_ZONE,
    maxDetailPages: VB_DETAIL_PAGE_LIMIT,
  },
  { id: "norfolk_official", name: "Norfolk Official Events", city: "Norfolk", url: "https://www.norfolk.gov/calendar.aspx", format: "unverified", enabled: false, timeZone: EASTERN_TIME_ZONE },
  { id: "chesapeake_official", name: "Chesapeake Official Events", city: "Chesapeake", url: "https://www.cityofchesapeake.net/Calendar.aspx", format: "unverified", enabled: false, timeZone: EASTERN_TIME_ZONE },
  { id: "portsmouth_official", name: "Portsmouth Official Events", city: "Portsmouth", url: "https://www.portsmouthva.gov/calendar.aspx", format: "unverified", enabled: false, timeZone: EASTERN_TIME_ZONE },
  { id: "hampton_official", name: "Hampton Official Events", city: "Hampton", url: "https://www.hampton.gov/calendar.aspx", format: "unverified", enabled: false, timeZone: EASTERN_TIME_ZONE },
  { id: "newport_news_official", name: "Newport News Official Events", city: "Newport News", url: "https://www.nnva.gov/calendar.aspx", format: "unverified", enabled: false, timeZone: EASTERN_TIME_ZONE },
  { id: "suffolk_official", name: "Suffolk Official Events", city: "Suffolk", url: "https://www.suffolkva.us/calendar.aspx", format: "unverified", enabled: false, timeZone: EASTERN_TIME_ZONE },
];

const HTML_HEADERS = {
  Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
  "User-Agent": "Buzz/1.0 (https://lit757.vercel.app; demetriusvharvey@gmail.com)",
};

function clean(value: string) {
  return value
    .replace(/\\n/gi, " ")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
    .trim();
}

function unfoldIcs(text: string) {
  return text
    .replace(/\r\n[ \t]/g, "")
    .replace(/\n[ \t]/g, "")
    .split(/\r?\n/);
}

function propertyEntries(lines: string[], name: string): IcsProperty[] {
  const entries: IcsProperty[] = [];
  for (const line of lines) {
    if (!line.startsWith(`${name}:`) && !line.startsWith(`${name};`)) continue;
    const separator = line.indexOf(":");
    if (separator < 0) continue;

    const [propertyName, ...rawParams] = line.slice(0, separator).split(";");
    if (propertyName !== name) continue;

    const params: Record<string, string> = {};
    for (const rawParam of rawParams) {
      const equals = rawParam.indexOf("=");
      if (equals <= 0) continue;
      const key = rawParam.slice(0, equals).trim().toUpperCase();
      const value = rawParam.slice(equals + 1).trim().replace(/^"|"$/g, "");
      if (key && value) params[key] = value;
    }

    entries.push({
      value: clean(line.slice(separator + 1)),
      params,
    });
  }
  return entries;
}

function propertyEntry(lines: string[], name: string) {
  return propertyEntries(lines, name)[0] || null;
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
        formatter
          .formatToParts(new Date(candidate))
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

function calendarDateForInstant(timestamp: number, timeZone: string, zulu: boolean) {
  if (zulu) return new Date(timestamp);
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      })
        .formatToParts(new Date(timestamp))
        .filter(part => part.type !== "literal")
        .map(part => [part.type, Number(part.value)]),
    );
    return new Date(Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    ));
  } catch {
    return new Date(timestamp);
  }
}

function parseCompactIcsParts(value: string): CompactIcsParts | null {
  const raw = value.trim();
  const dateOnly = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (dateOnly) {
    return {
      year: Number(dateOnly[1]),
      month: Number(dateOnly[2]),
      day: Number(dateOnly[3]),
      hour: 0,
      minute: 0,
      second: 0,
      allDay: true,
      zulu: false,
    };
  }

  const compact = raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (!compact) return null;
  return {
    year: Number(compact[1]),
    month: Number(compact[2]),
    day: Number(compact[3]),
    hour: Number(compact[4]),
    minute: Number(compact[5]),
    second: Number(compact[6]),
    allDay: false,
    zulu: compact[7] === "Z",
  };
}

function calendarDate(parts: CompactIcsParts) {
  return new Date(Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  ));
}

function isoFromCalendarDate(value: Date, timeZone: string, zulu: boolean) {
  if (zulu) return value.toISOString();
  return zonedDateTimeToIso(
    value.getUTCFullYear(),
    value.getUTCMonth() + 1,
    value.getUTCDate(),
    value.getUTCHours(),
    value.getUTCMinutes(),
    value.getUTCSeconds(),
    timeZone,
  );
}

function parseIcsDate(value: string, timeZone = EASTERN_TIME_ZONE) {
  const parts = parseCompactIcsParts(value);
  if (parts) return isoFromCalendarDate(calendarDate(parts), timeZone, parts.zulu);
  return toIso(value);
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
  const cleaned = decodeHtml(value.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
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
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
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
  if (!record) return null;
  return firstString(record.url)
    || firstString(record.contentUrl)
    || firstString(record.value)
    || firstString(record.name);
}

function formatAddress(value: unknown) {
  if (typeof value === "string") return stripHtml(value);
  const address = asRecord(value);
  if (!address) return null;
  return [
    address.streetAddress,
    address.addressLocality,
    address.addressRegion,
    address.postalCode,
  ]
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
        // Ignore malformed structured data from a single page.
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
  return sourceUrl.match(/\/(\d+)\/?(?:[?#].*)?$/)?.[1] || null;
}

function normalizeJsonLdEvent(
  event: Record<string, unknown>,
  source: CityCalendarSource,
  fallbackUrl: string,
): NormalizedCityEvent | null {
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
  const heading = new RegExp(
    `<h[1-6][^>]*>[\\s\\S]*?${headingPattern}[\\s\\S]*?<\\/h[1-6]>`,
    "i",
  ).exec(html);
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

function parseRRule(value: string | null): ParsedRRule | null {
  if (!value) return null;
  const fields = Object.fromEntries(
    value.split(";").map(part => {
      const separator = part.indexOf("=");
      return separator < 0
        ? [part.toUpperCase(), ""]
        : [part.slice(0, separator).toUpperCase(), part.slice(separator + 1)];
    }),
  );
  const freq = String(fields.FREQ || "").toUpperCase();
  if (!(["DAILY", "WEEKLY", "MONTHLY", "YEARLY"] as string[]).includes(freq)) return null;

  const interval = Math.max(1, Number.parseInt(String(fields.INTERVAL || "1"), 10) || 1);
  const rawCount = Number.parseInt(String(fields.COUNT || ""), 10);
  const count = Number.isFinite(rawCount) && rawCount > 0 ? rawCount : null;
  const byDay = String(fields.BYDAY || "")
    .split(",")
    .map(value => value.trim().toUpperCase())
    .filter(Boolean);
  const byMonthDay = String(fields.BYMONTHDAY || "")
    .split(",")
    .map(value => Number.parseInt(value, 10))
    .filter(value => Number.isFinite(value) && value !== 0 && value >= -31 && value <= 31);

  return {
    freq: freq as ParsedRRule["freq"],
    interval,
    count,
    until: fields.UNTIL ? String(fields.UNTIL) : null,
    byDay,
    byMonthDay,
  };
}

function startOfUtcWeek(value: Date) {
  const result = new Date(value);
  const distanceFromMonday = (result.getUTCDay() + 6) % 7;
  result.setUTCDate(result.getUTCDate() - distanceFromMonday);
  result.setUTCHours(0, 0, 0, 0);
  return result;
}

function validDayOfMonth(year: number, monthIndex: number, day: number) {
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const normalized = day > 0 ? day : daysInMonth + day + 1;
  return normalized >= 1 && normalized <= daysInMonth ? normalized : null;
}

function monthlyDaysForRule(
  year: number,
  monthIndex: number,
  startDay: number,
  rule: ParsedRRule,
) {
  const days = new Set<number>();
  if (rule.byMonthDay.length) {
    for (const value of rule.byMonthDay) {
      const day = validDayOfMonth(year, monthIndex, value);
      if (day) days.add(day);
    }
    return [...days].sort((left, right) => left - right);
  }

  if (rule.byDay.length) {
    const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
    for (const token of rule.byDay) {
      const match = token.match(/^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/);
      if (!match) continue;
      const ordinal = match[1] ? Number(match[1]) : null;
      const targetDay = DAY_CODE_TO_UTC_DAY[match[2]];
      const matching: number[] = [];
      for (let day = 1; day <= daysInMonth; day += 1) {
        if (new Date(Date.UTC(year, monthIndex, day)).getUTCDay() === targetDay) matching.push(day);
      }
      if (ordinal === null) matching.forEach(day => days.add(day));
      else {
        const index = ordinal > 0 ? ordinal - 1 : matching.length + ordinal;
        if (matching[index]) days.add(matching[index]);
      }
    }
    return [...days].sort((left, right) => left - right);
  }

  const sameDay = validDayOfMonth(year, monthIndex, startDay);
  return sameDay ? [sameDay] : [];
}

function untilMilliseconds(rule: ParsedRRule, timeZone: string) {
  if (!rule.until) return null;
  const parsed = parseIcsDate(rule.until, timeZone);
  if (!parsed) return null;
  const parts = parseCompactIcsParts(rule.until);
  if (!parts?.allDay) return new Date(parsed).getTime();
  const nextDay = calendarDate(parts);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const nextMidnight = isoFromCalendarDate(nextDay, timeZone, false);
  return nextMidnight ? new Date(nextMidnight).getTime() - 1 : new Date(parsed).getTime();
}

function recurrenceCalendarDates(
  start: Date,
  startParts: CompactIcsParts,
  rule: ParsedRRule,
  timeZone: string,
) {
  const output: Date[] = [];
  const windowStart = Date.now() - RECURRENCE_WINDOW_PAST_MS;
  const windowEnd = Date.now() + RECURRENCE_WINDOW_FUTURE_MS;
  const until = untilMilliseconds(rule, timeZone);
  let occurrenceNumber = 0;
  let iterations = 0;

  function addCandidate(candidate: Date) {
    if (candidate.getTime() < start.getTime()) return true;
    const iso = isoFromCalendarDate(candidate, timeZone, startParts.zulu);
    if (!iso) return true;
    const timestamp = new Date(iso).getTime();
    if (until !== null && timestamp > until) return false;
    if (timestamp > windowEnd) return false;

    occurrenceNumber += 1;
    if (rule.count !== null && occurrenceNumber > rule.count) return false;
    if (timestamp >= windowStart) output.push(new Date(candidate));
    if (output.length >= MAX_RECURRENCE_OCCURRENCES) return false;
    return rule.count === null || occurrenceNumber < rule.count;
  }

  if (rule.freq === "DAILY") {
    let firstOffset = 0;
    const localWindow = calendarDateForInstant(windowStart, timeZone, startParts.zulu);
    const daysToWindow = Math.floor((localWindow.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
    if (daysToWindow > 0) {
      const skippedIntervals = Math.max(0, Math.floor(daysToWindow / rule.interval) - 1);
      firstOffset = skippedIntervals * rule.interval;
      occurrenceNumber = skippedIntervals;
    }

    for (let offset = firstOffset; iterations < MAX_RECURRENCE_ITERATIONS; offset += rule.interval) {
      iterations += 1;
      const candidate = new Date(start);
      candidate.setUTCDate(candidate.getUTCDate() + offset);
      if (!addCandidate(candidate)) break;
    }
    return output;
  }

  if (rule.freq === "WEEKLY") {
    const permittedDays = new Set(
      (rule.byDay.length ? rule.byDay : [Object.keys(DAY_CODE_TO_UTC_DAY)
        .find(code => DAY_CODE_TO_UTC_DAY[code] === start.getUTCDay())!])
        .map(token => token.slice(-2))
        .map(code => DAY_CODE_TO_UTC_DAY[code])
        .filter(day => day !== undefined),
    );
    const firstWeek = startOfUtcWeek(start).getTime();
    const candidate = new Date(start);
    while (iterations < MAX_RECURRENCE_ITERATIONS) {
      iterations += 1;
      const week = Math.floor((startOfUtcWeek(candidate).getTime() - firstWeek) / (7 * 24 * 60 * 60 * 1000));
      if (week >= 0 && week % rule.interval === 0 && permittedDays.has(candidate.getUTCDay())) {
        if (!addCandidate(candidate)) break;
      }
      candidate.setUTCDate(candidate.getUTCDate() + 1);
    }
    return output;
  }

  if (rule.freq === "MONTHLY") {
    for (let monthOffset = 0; iterations < MAX_RECURRENCE_ITERATIONS; monthOffset += rule.interval) {
      iterations += 1;
      const monthAnchor = new Date(Date.UTC(
        start.getUTCFullYear(),
        start.getUTCMonth() + monthOffset,
        1,
        start.getUTCHours(),
        start.getUTCMinutes(),
        start.getUTCSeconds(),
      ));
      const days = monthlyDaysForRule(
        monthAnchor.getUTCFullYear(),
        monthAnchor.getUTCMonth(),
        start.getUTCDate(),
        rule,
      );
      let keepGoing = true;
      for (const day of days) {
        const candidate = new Date(monthAnchor);
        candidate.setUTCDate(day);
        if (!addCandidate(candidate)) {
          keepGoing = false;
          break;
        }
      }
      if (!keepGoing) break;
    }
    return output;
  }

  for (let yearOffset = 0; iterations < MAX_RECURRENCE_ITERATIONS; yearOffset += rule.interval) {
    iterations += 1;
    const candidate = new Date(Date.UTC(
      start.getUTCFullYear() + yearOffset,
      start.getUTCMonth(),
      start.getUTCDate(),
      start.getUTCHours(),
      start.getUTCMinutes(),
      start.getUTCSeconds(),
    ));
    if (candidate.getUTCMonth() !== start.getUTCMonth()) continue;
    if (!addCandidate(candidate)) break;
  }
  return output;
}

function recurrenceIdentity(uid: string | null, occurrenceIso: string) {
  return `${uid || "recurrence"}|${occurrenceIso}`;
}

function detachedOccurrenceDetails(lines: string[], source: CityCalendarSource) {
  const recurrence = propertyEntry(lines, "RECURRENCE-ID");
  if (!recurrence) return null;
  const parts = parseCompactIcsParts(recurrence.value);
  const timeZone = recurrence.params.TZID
    || (parts?.zulu ? "UTC" : source.timeZone)
    || EASTERN_TIME_ZONE;
  const iso = parseIcsDate(recurrence.value, timeZone);
  return iso
    ? { identity: recurrenceIdentity(property(lines, "UID"), iso), start: iso }
    : null;
}

function exdateInstants(lines: string[], source: CityCalendarSource) {
  const values = new Set<number>();
  for (const entry of propertyEntries(lines, "EXDATE")) {
    for (const raw of entry.value.split(",").map(value => value.trim()).filter(Boolean)) {
      const parts = parseCompactIcsParts(raw);
      const timeZone = entry.params.TZID
        || (parts?.zulu ? "UTC" : source.timeZone)
        || EASTERN_TIME_ZONE;
      const iso = parseIcsDate(raw, timeZone);
      if (iso) values.add(new Date(iso).getTime());
    }
  }
  return values;
}

export function cityEventFingerprint(
  source: string,
  externalId: string | null,
  title: string,
  start: string,
  venue: string,
) {
  const key = externalId || `${title.trim().toLowerCase()}|${start}|${venue.trim().toLowerCase()}`;
  return `${source}_${createHash("sha256").update(key).digest("hex").slice(0, 32)}`;
}

function normalizedIcsEvent(
  lines: string[],
  source: CityCalendarSource,
  start: string,
  end: string | null,
  externalId: string | null,
): NormalizedCityEvent | null {
  const title = property(lines, "SUMMARY");
  if (!title) return null;
  const location = property(lines, "LOCATION") || source.venueName || source.name;
  return {
    source_event_id: cityEventFingerprint(source.id, externalId, title, start, location),
    name: title,
    description: property(lines, "DESCRIPTION"),
    venue_name: location,
    address: location,
    city: source.city,
    latitude: null,
    longitude: null,
    start_time: start,
    end_time: end,
    source: source.id,
    source_name: source.name,
    source_url: property(lines, "URL") || source.url,
    image_url: property(lines, "IMAGE"),
    ticket_status: null,
  };
}

function cancelledIcsEvent(
  lines: string[],
  source: CityCalendarSource,
  identity: string,
  recurrenceStart: string,
): NormalizedCityEvent {
  const name = property(lines, "SUMMARY") || "Cancelled event";
  const venue = property(lines, "LOCATION") || source.venueName || source.name;
  return {
    source_event_id: cityEventFingerprint(source.id, identity, name, recurrenceStart, venue),
    name,
    description: property(lines, "DESCRIPTION"),
    venue_name: venue,
    address: venue,
    city: source.city,
    latitude: null,
    longitude: null,
    start_time: recurrenceStart,
    end_time: null,
    source: source.id,
    source_name: source.name,
    source_url: property(lines, "URL") || source.url,
    image_url: null,
    ticket_status: "cancelled",
    cancelled: true,
  };
}

function expandIcsBlock(lines: string[], source: CityCalendarSource) {
  const startProperty = propertyEntry(lines, "DTSTART");
  if (!startProperty) return [] as NormalizedCityEvent[];
  const startParts = parseCompactIcsParts(startProperty.value);
  const startTimeZone = startProperty.params.TZID
    || (startParts?.zulu ? "UTC" : source.timeZone)
    || EASTERN_TIME_ZONE;
  const startIso = parseIcsDate(startProperty.value, startTimeZone);
  if (!startIso) return [] as NormalizedCityEvent[];

  const endProperty = propertyEntry(lines, "DTEND");
  const endParts = endProperty ? parseCompactIcsParts(endProperty.value) : null;
  const endTimeZone = endProperty?.params.TZID || startTimeZone;
  const endIso = endProperty ? parseIcsDate(endProperty.value, endTimeZone) : null;
  const detached = detachedOccurrenceDetails(lines, source);
  const rule = detached ? null : parseRRule(property(lines, "RRULE"));

  if (!rule || !startParts) {
    const externalId = detached?.identity || property(lines, "UID");
    const event = normalizedIcsEvent(lines, source, startIso, endIso, externalId);
    return event ? [event] : [];
  }

  const startCalendar = calendarDate(startParts);
  const endCalendar = endParts ? calendarDate(endParts) : null;
  const calendarDuration = endCalendar ? endCalendar.getTime() - startCalendar.getTime() : null;
  const instantDuration = endIso ? new Date(endIso).getTime() - new Date(startIso).getTime() : null;
  const excluded = exdateInstants(lines, source);
  const uid = property(lines, "UID");
  const events: NormalizedCityEvent[] = [];

  for (const occurrence of recurrenceCalendarDates(startCalendar, startParts, rule, startTimeZone)) {
    const occurrenceStart = isoFromCalendarDate(occurrence, startTimeZone, startParts.zulu);
    if (!occurrenceStart) continue;
    if (excluded.has(new Date(occurrenceStart).getTime())) continue;

    let occurrenceEnd: string | null = null;
    if (calendarDuration !== null && endParts) {
      const endCalendarOccurrence = new Date(occurrence.getTime() + calendarDuration);
      occurrenceEnd = isoFromCalendarDate(endCalendarOccurrence, endTimeZone, endParts.zulu);
    } else if (instantDuration !== null) {
      occurrenceEnd = new Date(new Date(occurrenceStart).getTime() + instantDuration).toISOString();
    }

    const event = normalizedIcsEvent(
      lines,
      source,
      occurrenceStart,
      occurrenceEnd,
      recurrenceIdentity(uid, occurrenceStart),
    );
    if (event) events.push(event);
  }

  return events;
}

export function parseCityCalendarIcs(text: string, source: CityCalendarSource): NormalizedCityEvent[] {
  const blocks: string[][] = [];
  let current: string[] | null = null;
  for (const line of unfoldIcs(text)) {
    if (line === "BEGIN:VEVENT") {
      current = [];
      continue;
    }
    if (line === "END:VEVENT") {
      if (current) blocks.push(current);
      current = null;
      continue;
    }
    if (current) current.push(line);
  }

  const events = new Map<string, { event: NormalizedCityEvent; detached: boolean }>();
  const cancelled = new Map<string, NormalizedCityEvent>();

  for (const block of blocks) {
    const detached = detachedOccurrenceDetails(block, source);
    if (String(property(block, "STATUS") || "").toUpperCase() === "CANCELLED" && detached) {
      const cancellation = cancelledIcsEvent(block, source, detached.identity, detached.start);
      events.delete(cancellation.source_event_id);
      cancelled.set(cancellation.source_event_id, cancellation);
      continue;
    }

    const isDetached = Boolean(detached);
    for (const event of expandIcsBlock(block, source)) {
      if (cancelled.has(event.source_event_id)) continue;
      const existing = events.get(event.source_event_id);
      if (!existing || isDetached || !existing.detached) {
        events.set(event.source_event_id, { event, detached: isDetached });
      }
    }
  }

  return [
    ...[...events.values()].map(value => value.event),
    ...cancelled.values(),
  ];
}

export function parseCityCalendarJsonLd(
  html: string,
  source: CityCalendarSource,
  fallbackUrl = source.url,
) {
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
  const times = eventTimesFromText(listing.date, dateText, source.timeZone || EASTERN_TIME_ZONE);
  const rawLocationSection = sectionHtml(html, "Location");
  const locationSection = rawLocationSection
    ? rawLocationSection.split(/Event\s+Details\s*:/i)[0]
    : null;
  const locationLines = locationSection ? htmlLines(locationSection).slice(0, 4) : [];
  const venueName = locationLines[0] || source.venueName || source.name;
  const address = locationLines.length > 1 ? locationLines.slice(1).join(", ") : null;
  const descriptionSection = markerSectionHtml(html, "Event\\s+Details\\s*:");
  const description = descriptionSection ? stripHtml(descriptionSection) : null;
  const [year, month, day] = listing.date.split("-").map(Number);
  const start = times.start
    || zonedDateTimeToIso(year, month, day, 0, 0, 0, source.timeZone || EASTERN_TIME_ZONE)!;

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

async function fetchText(
  url: string,
  headers: Record<string, string>,
  timeoutMs = 12_000,
) {
  const response = await fetch(url, {
    cache: "no-store",
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`City calendar request failed (${response.status})`);
  return response.text();
}

async function mapLimit<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
) {
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => run()),
  );
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
    url.searchParams.set(
      "date",
      `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`,
    );
    urls.push(url.toString());
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return urls;
}

export function createIcsCityCalendarProvider(source: CityCalendarSource): CityCalendarProvider {
  return {
    source,
    async fetchEvents() {
      const text = await fetchText(
        source.url,
        { Accept: "text/calendar,text/plain;q=0.9,*/*;q=0.5" },
      );
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
      const listingHtml = await fetchText(listingUrl, HTML_HEADERS, 10_000);
      const listingEvents = parseCityCalendarJsonLd(listingHtml, source, listingUrl);
      const links = extractEventDetailLinks(listingHtml, source)
        .slice(0, source.maxDetailPages || VB_DETAIL_PAGE_LIMIT);

      if (!links.length) {
        if (listingEvents.length || /no events|no matching events/i.test(listingHtml)) return listingEvents;
        throw new Error("City calendar layout returned no structured events or event detail links");
      }

      const detailEvents = (await mapLimit(links, VB_DETAIL_CONCURRENCY, async link => {
        try {
          const html = await fetchText(link, HTML_HEADERS, VB_DETAIL_TIMEOUT_MS);
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
      const listingPages = await mapLimit(
        monthlyListingUrls(source),
        VB_LISTING_CONCURRENCY,
        url => fetchText(url, HTML_HEADERS, VB_LISTING_TIMEOUT_MS),
      );
      const listings = [...new Map(
        listingPages
          .flatMap(html => parseVirginiaBeachEventListing(html, source))
          .map(event => [event.url, event]),
      ).values()].slice(0, source.maxDetailPages || VB_DETAIL_PAGE_LIMIT);

      if (!listings.length) throw new Error("Virginia Beach calendar returned no dated event links");

      return mapLimit(listings, VB_DETAIL_CONCURRENCY, async listing => {
        try {
          const html = await fetchText(listing.url, HTML_HEADERS, VB_DETAIL_TIMEOUT_MS);
          return parseVirginiaBeachEventDetail(html, listing, source);
        } catch (error) {
          console.warn("Virginia Beach event detail fetch failed", {
            url: listing.url,
            error: error instanceof Error ? error.message : "Unknown error",
          });
          const [year, month, day] = listing.date.split("-").map(Number);
          const start = zonedDateTimeToIso(
            year,
            month,
            day,
            0,
            0,
            0,
            source.timeZone || EASTERN_TIME_ZONE,
          )!;
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
