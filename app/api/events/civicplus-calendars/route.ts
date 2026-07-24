import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import {
  CIVICPLUS_CALENDAR_FEEDS,
  fetchAllCivicPlusCalendars,
} from "../../../../src/lib/events/civicplus-calendars";
import type { NormalizedCityEvent } from "../../../../src/lib/events/city-calendars";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const db = getSupabaseAdmin();

const WINDOW_PAST_MS = 6 * 60 * 60 * 1000;
const WINDOW_FUTURE_MS = 120 * 24 * 60 * 60 * 1000;
const DATABASE_CHUNK_SIZE = 200;

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  return request.headers.get("authorization") === `Bearer ${secret}`
    || request.headers.get("x-cron-secret") === secret;
}

function databaseRow(event: NormalizedCityEvent) {
  return {
    source_event_id: event.source_event_id,
    name: event.name,
    venue_name: event.venue_name,
    start_time: event.start_time,
    end_time: event.end_time,
    source: event.source,
    ticket_status: event.ticket_status,
    source_url: event.source_url,
  };
}

function chunks<T>(items: T[], size = DATABASE_CHUNK_SIZE) {
  const output: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    output.push(items.slice(index, index + size));
  }
  return output;
}

async function existingEventIds(ids: string[]) {
  const existing = new Set<string>();
  for (const batch of chunks(ids)) {
    const { data, error } = await db
      .from("events")
      .select("source_event_id")
      .in("source_event_id", batch);
    if (error) throw new Error(error.message);
    for (const row of data || []) existing.add(String(row.source_event_id));
  }
  return existing;
}

async function deleteCancelled(ids: string[]) {
  for (const batch of chunks(ids)) {
    const { error } = await db.from("events").delete().in("source_event_id", batch);
    if (error) throw new Error(error.message);
  }
}

async function upsertEvents(events: NormalizedCityEvent[]) {
  for (const batch of chunks(events)) {
    const { error } = await db
      .from("events")
      .upsert(batch.map(databaseRow), { onConflict: "source_event_id" });
    if (error) throw new Error(error.message);
  }
}

async function run(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dryRun") === "1" || url.searchParams.get("dryRun") === "true";
  const now = Date.now();
  const fetched = await fetchAllCivicPlusCalendars();
  const events = fetched.events.filter(event => {
    if (event.cancelled) return true;
    const start = new Date(event.start_time).getTime();
    return Number.isFinite(start)
      && start >= now - WINDOW_PAST_MS
      && start <= now + WINDOW_FUTURE_MS;
  });
  const cancellations = events.filter(event => event.cancelled);
  const activeEvents = events.filter(event => !event.cancelled);

  const summary = {
    ...fetched.summary,
    inWindow: events.length,
    active: activeEvents.length,
    cancellations: cancellations.length,
    inserted: 0,
    updated: 0,
    dryRun,
  };

  if (!dryRun) {
    try {
      const existing = activeEvents.length
        ? await existingEventIds(activeEvents.map(event => event.source_event_id))
        : new Set<string>();
      summary.updated = activeEvents.filter(event => existing.has(event.source_event_id)).length;
      summary.inserted = activeEvents.length - summary.updated;
      if (cancellations.length) {
        await deleteCancelled(cancellations.map(event => event.source_event_id));
      }
      if (activeEvents.length) await upsertEvents(activeEvents);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Database operation failed";
      console.error("CivicPlus calendar database sync failed", message);
      return NextResponse.json({
        success: false,
        generatedAt: new Date().toISOString(),
        error: message,
        summary,
        feeds: fetched.results.map(result => ({
          feedId: result.feed.feedId,
          city: result.feed.city,
          category: result.feed.category,
          status: result.status,
          fetched: result.events.length,
          error: result.error,
        })),
      }, { status: 500 });
    }
  }

  const cityHealth = Object.fromEntries(
    [...new Set(CIVICPLUS_CALENDAR_FEEDS.map(feed => feed.city))].map(city => {
      const results = fetched.results.filter(result => result.feed.city === city);
      return [city, {
        registeredFeeds: results.length,
        successfulFeeds: results.filter(result => result.status === "ok").length,
        failedFeeds: results.filter(result => result.status === "error").length,
        rawEvents: results.reduce((sum, result) => sum + result.events.length, 0),
        coverageNotes: [...new Set(results.flatMap(result => result.feed.coverageNote ? [result.feed.coverageNote] : []))],
      }];
    }),
  );

  const failedFeeds = fetched.results.filter(result => result.status === "error").length;
  return NextResponse.json({
    success: fetched.results.some(result => result.status === "ok"),
    partial: failedFeeds > 0,
    generatedAt: new Date().toISOString(),
    truthNote: "Official municipal calendars improve event discovery; they do not prove live venue occupancy.",
    summary,
    cityHealth,
    feeds: fetched.results.map(result => ({
      feedId: result.feed.feedId,
      city: result.feed.city,
      category: result.feed.category,
      source: result.feed.citySourceId,
      url: result.feed.url,
      status: result.status,
      fetched: result.events.length,
      error: result.error,
      fetchedAt: result.fetchedAt,
    })),
  }, {
    status: failedFeeds === fetched.results.length ? 502 : 200,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function GET(request: Request) {
  return run(request);
}

export async function POST(request: Request) {
  return run(request);
}
