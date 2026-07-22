import { createHash } from "node:crypto";

export type CityCalendarSource = {
  id: string;
  name: string;
  city: string;
  url: string;
  format: "ics";
  enabled: boolean;
  venueName?: string;
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

export const CITY_CALENDAR_SOURCES: CityCalendarSource[] = [
  {
    id: "virginia_beach_official",
    name: "Virginia Beach Official Events",
    city: "Virginia Beach",
    url: "https://www.visitvirginiabeach.com/events/?view=grid&sort=date&bounds=false",
    format: "ics",
    enabled: true,
  },
  { id: "norfolk_official", name: "Norfolk Official Events", city: "Norfolk", url: "https://www.norfolk.gov/calendar.aspx", format: "ics", enabled: false },
  { id: "chesapeake_official", name: "Chesapeake Official Events", city: "Chesapeake", url: "https://www.cityofchesapeake.net/Calendar.aspx", format: "ics", enabled: false },
  { id: "portsmouth_official", name: "Portsmouth Official Events", city: "Portsmouth", url: "https://www.portsmouthva.gov/calendar.aspx", format: "ics", enabled: false },
  { id: "hampton_official", name: "Hampton Official Events", city: "Hampton", url: "https://www.hampton.gov/calendar.aspx", format: "ics", enabled: false },
  { id: "newport_news_official", name: "Newport News Official Events", city: "Newport News", url: "https://www.nnva.gov/calendar.aspx", format: "ics", enabled: false },
  { id: "suffolk_official", name: "Suffolk Official Events", city: "Suffolk", url: "https://www.suffolkva.us/calendar.aspx", format: "ics", enabled: false },
];

function clean(value: string) {
  return value.replace(/\\n/gi, " ").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\").trim();
}

function unfoldIcs(text: string) {
  return text.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "").split(/\r?\n/);
}

function property(lines: string[], name: string) {
  const line = lines.find(item => item.startsWith(`${name}:`) || item.startsWith(`${name};`));
  if (!line) return null;
  const separator = line.indexOf(":");
  return separator >= 0 ? clean(line.slice(separator + 1)) : null;
}

function parseIcsDate(value: string) {
  const raw = value.trim();
  if (/^\d{8}$/.test(raw)) return new Date(`${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T00:00:00Z`).toISOString();
  const match = raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (!match) {
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  const [, year, month, day, hour, minute, second, zulu] = match;
  const parsed = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}${zulu ? "Z" : ""}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
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
      const startValue = property(current, "DTSTART");
      const start = startValue ? parseIcsDate(startValue) : null;
      if (title && start) {
        const location = property(current, "LOCATION") || source.venueName || source.name;
        const externalId = property(current, "UID");
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
          end_time: property(current, "DTEND") ? parseIcsDate(property(current, "DTEND")!) : null,
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

export function createIcsCityCalendarProvider(source: CityCalendarSource): CityCalendarProvider {
  return {
    source,
    async fetchEvents() {
      const response = await fetch(source.url, {
        cache: "no-store",
        headers: { Accept: "text/calendar,text/plain;q=0.9,*/*;q=0.5" },
        signal: AbortSignal.timeout(12_000),
      });
      if (!response.ok) throw new Error(`City calendar request failed (${response.status})`);
      const text = await response.text();
      if (!text.includes("BEGIN:VCALENDAR") && !text.includes("BEGIN:VEVENT")) {
        throw new Error("City calendar source did not return ICS content");
      }
      return parseCityCalendarIcs(text, source);
    },
  };
}
