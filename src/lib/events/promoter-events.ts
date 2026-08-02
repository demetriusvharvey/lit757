import { createHash } from "node:crypto";
import type { NormalizedCityEvent } from "./city-calendars";

export type PromoterEventSource = {
  id: string;
  name: string;
  city: string;
  landingUrl: string;
  eventHosts: readonly string[];
  venueAliases?: Readonly<Record<string, string>>;
};

export type PromoterAppearance = {
  label: "Featured" | "Special guest" | "Appearance" | "Hosted by" | "Sounds by";
  names: string;
};

export type PromoterSourceResult = {
  source: PromoterEventSource;
  status: "ok" | "error";
  discoveredUrls: number;
  events: NormalizedCityEvent[];
  skipped: number;
  error: string | null;
  fetchedAt: string;
};

export const PROMOTER_EVENT_SOURCES: readonly PromoterEventSource[] = [
  {
    id: "traptastic_posh",
    name: "The Traptastic",
    city: "Virginia Beach",
    landingUrl: "https://linktr.ee/TheTraptastic",
    eventHosts: ["posh.vip"],
    venueAliases: {
      crocs: "Crocs 19th Street Bistro",
    },
  },
] as const;

const MAX_EVENT_URLS = 12;
const LANDING_TIMEOUT_MS = 8_000;
const EVENT_TIMEOUT_MS = 8_000;
const PAST_WINDOW_MS = 6 * 60 * 60 * 1_000;
const FUTURE_WINDOW_MS = 120 * 24 * 60 * 60 * 1_000;
const USER_AGENT = "Buzz/1.0 public promoter event discovery (hello@lit757.app)";

function normalize(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanText(value: unknown, limit = 240) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function safeHttpUrl(value: unknown, allowedHosts?: readonly string[]) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (allowedHosts && !allowedHosts.includes(url.hostname.toLowerCase())) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function decodeEscapedString(value: string) {
  try {
    return JSON.parse(`"${value}"`) as string;
  } catch {
    return value.replace(/\\"/g, '"').replace(/\\n/g, " ").replace(/\\\\/g, "\\");
  }
}

function escapedString(html: string, key: string) {
  const marker = `\\"${key}\\"`;
  const markerIndex = html.indexOf(marker);
  if (markerIndex < 0) return null;
  const colonIndex = html.indexOf(":", markerIndex + marker.length);
  if (colonIndex < 0) return null;
  const valueStart = html.indexOf('\\"', colonIndex + 1);
  if (valueStart < 0) return null;
  const valueEnd = html.indexOf('\\"', valueStart + 2);
  if (valueEnd < 0) return null;
  return cleanText(decodeEscapedString(html.slice(valueStart + 2, valueEnd)));
}

function escapedNumber(html: string, key: string) {
  const marker = `\\"${key}\\"`;
  const markerIndex = html.indexOf(marker);
  if (markerIndex < 0) return null;
  const match = html.slice(markerIndex + marker.length).match(/^\s*:\s*(-?\d+(?:\.\d+)?)/);
  const value = match ? Number(match[1]) : NaN;
  return Number.isFinite(value) ? value : null;
}

function validIso(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function appearanceNames(value: string) {
  return cleanText(value, 100)
    .replace(/\s+(?:tickets?|at|on sale|doors?)\b.*$/i, "")
    .replace(/[|•]+.*$/, "")
    .replace(/[.!,:;-]+$/, "")
    .trim();
}

export function promoterAppearance(value: unknown): PromoterAppearance | null {
  const text = cleanText(value, 500);
  const patterns: Array<{ expression: RegExp; label: PromoterAppearance["label"] }> = [
    { expression: /\bspecial guests?\s*[:\-]?\s+([^.!|\n]{2,100})/i, label: "Special guest" },
    { expression: /\b(?:live\s+)?appearance by\s*[:\-]?\s+([^.!|\n]{2,100})/i, label: "Appearance" },
    { expression: /\bhosted by\s*[:\-]?\s+([^.!|\n]{2,100})/i, label: "Hosted by" },
    { expression: /\bsounds by\s*[:\-]?\s+([^.!|\n]{2,100})/i, label: "Sounds by" },
    { expression: /\b(?:featuring|feat\.?|ft\.?)\s*[:\-]?\s+([^.!|\n]{2,100})/i, label: "Featured" },
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern.expression);
    const names = match ? appearanceNames(match[1]) : "";
    if (names.length >= 2) return { label: pattern.label, names };
  }
  return null;
}

export function extractPromoterEventUrls(html: string, source: PromoterEventSource) {
  const urls = new Set<string>();
  const candidates = html.match(/https?:\\?\/\\?\/[^"'<>\s]+/gi) || [];
  for (const candidate of candidates) {
    const decoded = candidate
      .replace(/\\\//g, "/")
      .replace(/&amp;/gi, "&")
      .replace(/[),.;]+$/, "");
    const safe = safeHttpUrl(decoded, source.eventHosts);
    if (!safe || !new URL(safe).pathname.startsWith("/e/")) continue;
    urls.add(safe);
    if (urls.size >= MAX_EVENT_URLS) break;
  }
  return [...urls];
}

export function parsePoshEventPage(
  html: string,
  source: PromoterEventSource,
  eventUrl: string,
  reference = new Date(),
): NormalizedCityEvent | null {
  const safeSourceUrl = safeHttpUrl(eventUrl, source.eventHosts);
  const eventId = escapedString(html, "eventId");
  const eventName = escapedString(html, "eventName");
  const rawVenueName = escapedString(html, "venueName");
  const start = validIso(escapedString(html, "start"));
  const end = validIso(escapedString(html, "end"));
  if (!safeSourceUrl || !eventId || !eventName || !rawVenueName || !start) return null;

  const startMs = new Date(start).getTime();
  const endMs = end ? new Date(end).getTime() : startMs + 4 * 60 * 60 * 1_000;
  if (endMs < reference.getTime() - PAST_WINDOW_MS || startMs > reference.getTime() + FUTURE_WINDOW_MS) return null;

  const description = escapedString(html, "description");
  const appearance = promoterAppearance(`${eventName}. ${description || ""}`);
  const availability = escapedString(html, "availability");
  const ticketLabel = availability?.includes("InStock") ? "Tickets available" : "Listed event";
  const appearanceLabel = appearance ? ` · ${appearance.label}: ${appearance.names}` : "";
  const venueName = source.venueAliases?.[normalize(rawVenueName)] || rawVenueName;
  const address = escapedString(html, "streetAddress");
  const image = safeHttpUrl(escapedString(html, "imageUrl"));

  return {
    source_event_id: `promoter:${source.id}:${eventId}`,
    name: eventName,
    description,
    venue_name: venueName,
    address,
    city: source.city,
    latitude: escapedNumber(html, "latitude"),
    longitude: escapedNumber(html, "longitude"),
    start_time: start,
    end_time: end,
    source: "promoter_posh",
    source_name: source.name,
    source_url: safeSourceUrl,
    image_url: image,
    ticket_status: `${ticketLabel}${appearanceLabel}`.slice(0, 180),
  };
}

async function fetchText(url: string, timeoutMs: number) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: { Accept: "text/html", "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

export async function fetchPromoterSource(source: PromoterEventSource, reference = new Date()): Promise<PromoterSourceResult> {
  const fetchedAt = new Date().toISOString();
  try {
    const landingHtml = await fetchText(source.landingUrl, LANDING_TIMEOUT_MS);
    const eventUrls = extractPromoterEventUrls(landingHtml, source);
    const fetched = await Promise.all(eventUrls.map(async eventUrl => {
      try {
        return parsePoshEventPage(await fetchText(eventUrl, EVENT_TIMEOUT_MS), source, eventUrl, reference);
      } catch {
        return null;
      }
    }));
    const events = fetched.filter((event): event is NormalizedCityEvent => Boolean(event));
    return {
      source,
      status: "ok",
      discoveredUrls: eventUrls.length,
      events: [...new Map(events.map(event => [event.source_event_id, event])).values()],
      skipped: fetched.length - events.length,
      error: null,
      fetchedAt,
    };
  } catch (error) {
    return {
      source,
      status: "error",
      discoveredUrls: 0,
      events: [],
      skipped: 0,
      error: error instanceof Error ? error.message.slice(0, 180) : "Promoter source failed",
      fetchedAt,
    };
  }
}

export function promoterEventSignature(event: Pick<NormalizedCityEvent, "name" | "venue_name" | "start_time">) {
  return createHash("sha256")
    .update(`${normalize(event.name)}|${normalize(event.venue_name)}|${event.start_time}`)
    .digest("hex");
}
