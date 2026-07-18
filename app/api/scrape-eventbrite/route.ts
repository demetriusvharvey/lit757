/* eslint-disable @typescript-eslint/no-explicit-any -- Scraped JSON-LD and Next payloads have no stable schema. */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isCronAuthorized } from "../../../src/lib/cron-auth";

export const dynamic = "force-dynamic";

type ScrapedEvent = {
  source_event_id: string;
  name: string;
  venue_name: string | null;
  start_time: string | null;
  end_time: string | null;
  source: "eventbrite";
  ticket_status: string | null;
  source_url: string | null;
};

const EVENTBRITE_CITY_URLS = [
  "https://www.eventbrite.com/d/va--norfolk/events/",
  "https://www.eventbrite.com/d/va--virginia-beach/events/",
  "https://www.eventbrite.com/d/va--chesapeake/events/",
  "https://www.eventbrite.com/d/va--portsmouth/events/",
  "https://www.eventbrite.com/d/va--suffolk/events/",
  "https://www.eventbrite.com/d/va--hampton/events/",
  "https://www.eventbrite.com/d/va--newport-news/events/",
];

const NIGHTLIFE_KEYWORDS = [
  "party",
  "club",
  "night",
  "nightlife",
  "dj",
  "brunch",
  "day party",
  "festival",
  "concert",
  "live music",
  "lounge",
  "hookah",
  "latin",
  "afrobeats",
  "hip hop",
  "r&b",
  "rnb",
  "dance",
  "comedy",
  "karaoke",
  "mixer",
  "social",
  "rooftop",
];

export async function GET(req: Request) {
  try {
    const requestUrl = new URL(req.url);
    if (!isCronAuthorized(req)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json(
        { error: "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const city = requestUrl.searchParams.get("city");
    const urls = city
      ? [`https://www.eventbrite.com/d/va--${slugify(city)}/events/`]
      : EVENTBRITE_CITY_URLS;

    const allEvents: ScrapedEvent[] = [];

    for (const url of urls) {
      const html = await fetchHtml(url);
      allEvents.push(...extractEventsFromHtml(html, url));
    }

    const events = dedupeBySourceEventId(allEvents)
      .filter((event) => event.name && event.source_event_id)
      .filter((event) => isRelevantNightlifeEvent(event.name));

    if (!events.length) {
      return NextResponse.json({
        success: true,
        source: "eventbrite",
        scraped: allEvents.length,
        upserted: 0,
        message:
          "No Eventbrite events extracted. Eventbrite may have blocked the request or changed the page structure.",
      });
    }

    const rows = events.map((event) => ({
      source_event_id: event.source_event_id,
      name: event.name,
      venue_name: event.venue_name || "Eventbrite Event",
      start_time: event.start_time,
      end_time: event.end_time,
      source: event.source,
      ticket_status: event.ticket_status || inferTicketStatus(event.name),
      source_url: event.source_url,
    }));

    const { error } = await supabase
      .from("events")
      .upsert(rows, { onConflict: "source_event_id" });

    if (error) {
      return NextResponse.json(
        {
          error: "Supabase upsert failed",
          details: error,
          note:
            "If this says source_url does not exist, run: alter table events add column if not exists source_url text;",
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      source: "eventbrite",
      scraped: allEvents.length,
      upserted: rows.length,
      cities: urls,
      sample: rows.slice(0, 5),
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        error: "Eventbrite scrape failed",
        message: error?.message || "Unknown error",
      },
      { status: 500 }
    );
  }
}

async function fetchHtml(url: string) {
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
    },
    next: { revalidate: 0 },
  });

  if (!response.ok) {
    throw new Error(`Eventbrite page fetch failed: ${response.status} ${url}`);
  }

  return response.text();
}

function extractEventsFromHtml(html: string, pageUrl: string): ScrapedEvent[] {
  const fromJsonLd = extractJsonLdEvents(html);
  if (fromJsonLd.length) return fromJsonLd;

  const fromNextData = extractNextDataEvents(html);
  if (fromNextData.length) return fromNextData;

  return extractEventLinksFallback(html, pageUrl);
}

function extractJsonLdEvents(html: string): ScrapedEvent[] {
  const scriptRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const events: ScrapedEvent[] = [];
  let match: RegExpExecArray | null;

  while ((match = scriptRegex.exec(html))) {
    try {
      const parsed = JSON.parse(cleanJsonText(match[1]));
      const nodes = flattenJsonLd(parsed);

      for (const node of nodes) {
        const type = Array.isArray(node?.["@type"])
          ? node["@type"].join(" ").toLowerCase()
          : String(node?.["@type"] || "").toLowerCase();

        if (!type.includes("event")) continue;

        const name = text(node.name);
        const sourceUrl = normalizeEventbriteUrl(text(node.url));
        const id = extractEventbriteId(sourceUrl) || hashKey(`${name}-${sourceUrl}`);

        if (!name || !sourceUrl) continue;

        const cardTimeLabel = extractEventCardTime(html, id);

        events.push({
          source_event_id: `eventbrite_${id}`,
          name,
          venue_name: getLocationName(node.location),
          start_time: toEventDateIso(text(node.startDate), cardTimeLabel),
          end_time: toIsoOrNull(text(node.endDate)),
          source: "eventbrite",
          ticket_status: inferTicketStatus(`${name} ${text(node.offers?.availability)}`),
          source_url: sourceUrl,
        });
      }
    } catch {
      continue;
    }
  }

  return events;
}

function extractNextDataEvents(html: string): ScrapedEvent[] {
  const match = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match?.[1]) return [];

  try {
    const parsed = JSON.parse(cleanJsonText(match[1]));
    const candidates: any[] = [];

    walk(parsed, (value) => {
      if (!value || typeof value !== "object") return;

      const possibleName = value.name || value.title || value.eventName || value.event_name;
      const possibleUrl = value.url || value.vanityUrl || value.eventUrl || value.event_url;
      const possibleStart =
        value.startDate ||
        value.start_date ||
        value.startTime ||
        value.start_time ||
        value.start?.utc ||
        value.start?.local;

      if (possibleName && possibleUrl && String(possibleUrl).includes("eventbrite")) {
        candidates.push(value);
      } else if (possibleName && possibleStart && looksLikeEventObject(value)) {
        candidates.push(value);
      }
    });

    return candidates
      .map((item) => {
        const name = text(item.name || item.title || item.eventName || item.event_name);
        const sourceUrl = normalizeEventbriteUrl(
          text(item.url || item.vanityUrl || item.eventUrl || item.event_url)
        );
        const id =
          extractEventbriteId(sourceUrl) ||
          text(item.id || item.eventId || item.event_id) ||
          hashKey(`${name}-${sourceUrl}`);

        return {
          source_event_id: `eventbrite_${id}`,
          name,
          venue_name: text(
            item.venue?.name ||
              item.primaryVenue?.name ||
              item.location?.name ||
              item.venue_name ||
              item.place?.name
          ),
          start_time: toIsoOrNull(
            text(
              item.startDate ||
                item.start_date ||
                item.startTime ||
                item.start_time ||
                item.start?.utc ||
                item.start?.local
            )
          ),
          end_time: toIsoOrNull(
            text(
              item.endDate ||
                item.end_date ||
                item.endTime ||
                item.end_time ||
                item.end?.utc ||
                item.end?.local
            )
          ),
          source: "eventbrite" as const,
          ticket_status: inferTicketStatus(`${name} ${text(item.ticketAvailability)} ${text(item.status)}`),
          source_url: sourceUrl || null,
        };
      })
      .filter((event) => event.name);
  } catch {
    return [];
  }
}

function extractEventLinksFallback(html: string, pageUrl: string): ScrapedEvent[] {
  const events: ScrapedEvent[] = [];
  const linkRegex = /<a[^>]+href=["']([^"']*eventbrite\.com\/e\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = linkRegex.exec(html))) {
    const sourceUrl = normalizeEventbriteUrl(match[1]);
    const id = extractEventbriteId(sourceUrl);
    if (!sourceUrl || !id) continue;

    const name = stripHtml(match[2]).replace(/\s+/g, " ").trim();
    const cleanName = name && name.length >= 6 ? name.slice(0, 160) : eventNameFromUrl(sourceUrl) || "Eventbrite event";

    events.push({
      source_event_id: `eventbrite_${id}`,
      name: cleanName,
      venue_name: inferCityVenueName(pageUrl),
      start_time: null,
      end_time: null,
      source: "eventbrite",
      ticket_status: inferTicketStatus(cleanName),
      source_url: sourceUrl,
    });
  }

  return dedupeBySourceEventId(events);
}

function flattenJsonLd(input: any): any[] {
  if (!input) return [];
  if (Array.isArray(input)) return input.flatMap(flattenJsonLd);
  if (input["@graph"]) return flattenJsonLd(input["@graph"]);
  if (input.itemListElement) return flattenJsonLd(input.itemListElement);
  if (input.item) return flattenJsonLd(input.item);
  return [input];
}

function extractEventCardTime(html: string, eventId: string) {
  if (!eventId) return "";

  const markerIndex = html.indexOf(`data-event-id="${eventId}"`);
  if (markerIndex < 0) return "";

  const cardHtml = html.slice(markerIndex, markerIndex + 10000);
  const timeMatch = cardHtml.match(
    /<p[^>]*>([^<]*\b\d{1,2}:\d{2}\s*(?:AM|PM)\b[^<]*)<\/p>/i
  );

  return timeMatch?.[1] ? stripHtml(timeMatch[1]).trim() : "";
}

function walk(value: any, cb: (value: any) => void) {
  cb(value);

  if (Array.isArray(value)) {
    value.forEach((item) => walk(item, cb));
  } else if (value && typeof value === "object") {
    Object.values(value).forEach((item) => walk(item, cb));
  }
}

function looksLikeEventObject(value: any) {
  const keys = Object.keys(value || {}).join(" ").toLowerCase();
  return keys.includes("event") || keys.includes("ticket") || keys.includes("venue") || keys.includes("start");
}

function getLocationName(location: any): string | null {
  if (!location) return null;
  if (typeof location === "string") return location;
  return text(location.name) || text(location.address?.streetAddress) || text(location.address?.addressLocality) || null;
}

function isRelevantNightlifeEvent(name: string) {
  const lower = name.toLowerCase();
  return NIGHTLIFE_KEYWORDS.some((keyword) => lower.includes(keyword));
}

function inferTicketStatus(input: string) {
  const lower = input.toLowerCase();
  if (lower.includes("sold out")) return "Sold Out";
  if (lower.includes("almost sold")) return "Almost Sold Out";
  if (lower.includes("limited")) return "Limited Tickets";
  if (lower.includes("free")) return "Free Entry";
  if (lower.includes("early bird")) return "Selling Fast";
  return "Eventbrite";
}

function inferCityVenueName(pageUrl: string) {
  if (pageUrl.includes("virginia-beach")) return "Virginia Beach Event";
  if (pageUrl.includes("norfolk")) return "Norfolk Event";
  if (pageUrl.includes("chesapeake")) return "Chesapeake Event";
  if (pageUrl.includes("portsmouth")) return "Portsmouth Event";
  if (pageUrl.includes("suffolk")) return "Suffolk Event";
  if (pageUrl.includes("hampton")) return "Hampton Event";
  if (pageUrl.includes("newport-news")) return "Newport News Event";
  return "Eventbrite Event";
}

function normalizeEventbriteUrl(url: string) {
  if (!url) return "";
  const absolute = url.startsWith("http") ? url : `https://www.eventbrite.com${url}`;
  return absolute.split("?")[0].split("#")[0];
}

function extractEventbriteId(url: string) {
  if (!url) return "";

  const patterns = [/tickets-(\d+)/i, /-tickets-(\d+)/i, /\/e\/[^/]*-(\d+)/i, /\/e\/(\d+)/i];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match?.[1]) return match[1];
  }

  return "";
}

function eventNameFromUrl(url: string) {
  const match = url.match(/\/e\/([^/?#]+)/i);
  if (!match?.[1]) return "";

  return match[1]
    .replace(/-tickets-\d+$/i, "")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim();
}

function toIsoOrNull(value: string) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function toEventDateIso(dateValue: string, timeLabel: string) {
  if (!dateValue) return null;

  const dateOnlyMatch = dateValue.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timeMatch = timeLabel.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);

  if (!dateOnlyMatch || !timeMatch) return toIsoOrNull(dateValue);

  const [, yearText, monthText, dayText] = dateOnlyMatch;
  let hour = Number(timeMatch[1]) % 12;
  const minute = Number(timeMatch[2]);
  if (timeMatch[3].toUpperCase() === "PM") hour += 12;

  const reference = new Date(`${yearText}-${monthText}-${dayText}T12:00:00Z`);
  const timeZoneName = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    timeZoneName: "shortOffset",
  })
    .formatToParts(reference)
    .find((part) => part.type === "timeZoneName")?.value;
  const offsetMatch = timeZoneName?.match(/GMT([+-]\d{1,2})(?::(\d{2}))?/i);
  const offsetMinutes = offsetMatch
    ? Number(offsetMatch[1]) * 60 + Math.sign(Number(offsetMatch[1])) * Number(offsetMatch[2] || 0)
    : -4 * 60;
  const localAsUtc = Date.UTC(
    Number(yearText),
    Number(monthText) - 1,
    Number(dayText),
    hour,
    minute
  );

  return new Date(localAsUtc - offsetMinutes * 60 * 1000).toISOString();
}

function text(value: any) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  return "";
}

function stripHtml(value: string) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ");
}

function cleanJsonText(value: string) {
  return value.replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#x27;/g, "'").trim();
}

function dedupeBySourceEventId(events: ScrapedEvent[]) {
  const seen = new Set<string>();
  const deduped: ScrapedEvent[] = [];

  for (const event of events) {
    if (!event.source_event_id || seen.has(event.source_event_id)) continue;
    seen.add(event.source_event_id);
    deduped.push(event);
  }

  return deduped;
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function hashKey(value: string) {
  let hash = 0;

  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }

  return Math.abs(hash).toString();
}
