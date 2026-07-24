import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const db = getSupabaseAdmin();

type FeedConfig = {
  name: string;
  url: string;
  source?: string;
  venueName?: string;
};

type LocalEvent = {
  source_event_id: string;
  name: string;
  venue_name: string;
  start_time: string;
  end_time: string | null;
  source: string;
  ticket_status: string | null;
  source_url: string | null;
};

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  return request.headers.get("authorization") === `Bearer ${secret}` || request.headers.get("x-cron-secret") === secret;
}

function clean(value: string) {
  return value
    .replace(/\\n/gi, " ")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
    .trim();
}

function parseIcsDate(value: string) {
  const raw = value.trim();
  if (/^\d{8}$/.test(raw)) {
    return new Date(`${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T00:00:00Z`).toISOString();
  }
  const match = raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (!match) {
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  const [, year, month, day, hour, minute, second, zulu] = match;
  const iso = `${year}-${month}-${day}T${hour}:${minute}:${second}${zulu ? "Z" : ""}`;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function unfoldIcs(text: string) {
  return text.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "").split(/\r?\n/);
}

function property(lines: string[], name: string) {
  const prefix = `${name}:`;
  const withParams = `${name};`;
  const line = lines.find(item => item.startsWith(prefix) || item.startsWith(withParams));
  if (!line) return null;
  const separator = line.indexOf(":");
  return separator >= 0 ? clean(line.slice(separator + 1)) : null;
}

function stableId(source: string, uid: string | null, name: string, start: string) {
  const key = uid || `${name}|${start}`;
  return `${source}_${createHash("sha256").update(key).digest("hex").slice(0, 32)}`;
}

function parseIcs(text: string, feed: FeedConfig): LocalEvent[] {
  const lines = unfoldIcs(text);
  const events: LocalEvent[] = [];
  let current: string[] | null = null;
  const source = String(feed.source || feed.name || "local_calendar").toLowerCase().replace(/[^a-z0-9_-]+/g, "_");

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      current = [];
      continue;
    }
    if (line === "END:VEVENT") {
      if (!current) continue;
      const name = property(current, "SUMMARY");
      const startValue = property(current, "DTSTART");
      const start = startValue ? parseIcsDate(startValue) : null;
      if (name && start) {
        const endValue = property(current, "DTEND");
        const uid = property(current, "UID");
        events.push({
          source_event_id: stableId(source, uid, name, start),
          name,
          venue_name: property(current, "LOCATION") || feed.venueName || feed.name,
          start_time: start,
          end_time: endValue ? parseIcsDate(endValue) : null,
          source,
          ticket_status: null,
          source_url: property(current, "URL") || feed.url,
        });
      }
      current = null;
      continue;
    }
    if (current) current.push(line);
  }

  return events;
}

function configuredFeeds() {
  const raw = process.env.LOCAL_EVENT_FEEDS_JSON;
  if (!raw) return [] as FeedConfig[];
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) throw new Error("LOCAL_EVENT_FEEDS_JSON must be a JSON array");
  return parsed.filter((item): item is FeedConfig => {
    if (!item || typeof item !== "object") return false;
    const candidate = item as Partial<FeedConfig>;
    return Boolean(candidate.name && candidate.url && /^https:\/\//i.test(candidate.url));
  });
}

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  let feeds: FeedConfig[];
  try {
    feeds = configuredFeeds();
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Invalid local feed configuration" }, { status: 500 });
  }

  if (!feeds.length) {
    return NextResponse.json({ success: true, skipped: true, message: "No LOCAL_EVENT_FEEDS_JSON feeds configured", feeds: 0, upserted: 0 });
  }

  const now = Date.now();
  const cutoff = now + 120 * 24 * 60 * 60 * 1000;
  const allEvents: LocalEvent[] = [];
  const results: Array<{ name: string; status: string; found?: number; error?: string }> = [];

  for (const feed of feeds.slice(0, 30)) {
    try {
      const response = await fetch(feed.url, {
        cache: "no-store",
        headers: { Accept: "text/calendar,text/plain;q=0.9,*/*;q=0.5" },
        signal: AbortSignal.timeout(12_000),
      });
      if (!response.ok) throw new Error(`Feed request failed (${response.status})`);
      const events = parseIcs(await response.text(), feed).filter(event => {
        const start = new Date(event.start_time).getTime();
        return Number.isFinite(start) && start >= now - 6 * 60 * 60 * 1000 && start <= cutoff;
      });
      allEvents.push(...events);
      results.push({ name: feed.name, status: "ok", found: events.length });
    } catch (error) {
      results.push({ name: feed.name, status: "error", error: error instanceof Error ? error.message : "Unknown error" });
    }
  }

  const deduped = [...new Map(allEvents.map(event => [event.source_event_id, event])).values()];
  if (deduped.length) {
    const { error } = await db.from("events").upsert(deduped, { onConflict: "source_event_id" });
    if (error) return NextResponse.json({ success: false, error: error.message, results }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    generatedAt: new Date().toISOString(),
    feeds: feeds.length,
    upserted: deduped.length,
    results,
  });
}
