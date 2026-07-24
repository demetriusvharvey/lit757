import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import {
  CITY_CALENDAR_SOURCES,
  createCityCalendarProvider,
  type NormalizedCityEvent,
} from "../../../../src/lib/events/city-calendars";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const db = getSupabaseAdmin();

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

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const now = Date.now();
  const cutoff = now + 120 * 24 * 60 * 60 * 1000;
  const activeSources = CITY_CALENDAR_SOURCES.filter(source => source.enabled);
  const summary = {
    fetched: 0,
    inserted: 0,
    updated: 0,
    cancelled: 0,
    skipped: 0,
    failed: 0,
  };
  const results: Array<Record<string, unknown>> = [];
  const collected: NormalizedCityEvent[] = [];

  for (const source of activeSources) {
    try {
      const provider = createCityCalendarProvider(source);
      const events = (await provider.fetchEvents()).filter(event => {
        if (event.cancelled) return true;
        const start = new Date(event.start_time).getTime();
        return Number.isFinite(start)
          && start >= now - 6 * 60 * 60 * 1000
          && start <= cutoff;
      });
      summary.fetched += events.length;
      collected.push(...events);
      results.push({
        source: source.id,
        city: source.city,
        format: source.format,
        status: "ok",
        fetched: events.length,
        cancellations: events.filter(event => event.cancelled).length,
      });
    } catch (error) {
      summary.failed += 1;
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error("City calendar ingestion failed", {
        source: source.id,
        city: source.city,
        error: message,
      });
      results.push({
        source: source.id,
        city: source.city,
        format: source.format,
        status: "error",
        error: message,
      });
    }
  }

  const deduped = [...new Map(
    collected.map(event => [event.source_event_id, event]),
  ).values()];
  summary.skipped += collected.length - deduped.length;

  const cancellations = deduped.filter(event => event.cancelled);
  const activeEvents = deduped.filter(event => !event.cancelled);
  summary.cancelled = cancellations.length;

  if (cancellations.length) {
    const cancelledIds = cancellations.map(event => event.source_event_id);
    const { error: deleteError } = await db
      .from("events")
      .delete()
      .in("source_event_id", cancelledIds);

    if (deleteError) {
      console.error("City calendar cancellation cleanup failed", deleteError.message);
      return NextResponse.json(
        { success: false, error: deleteError.message, summary, results },
        { status: 500 },
      );
    }
  }

  if (activeEvents.length) {
    const ids = activeEvents.map(event => event.source_event_id);
    const { data: existingRows, error: existingError } = await db
      .from("events")
      .select("source_event_id")
      .in("source_event_id", ids);

    if (existingError) {
      console.error("City calendar existing-event lookup failed", existingError.message);
      return NextResponse.json(
        { success: false, error: existingError.message, summary, results },
        { status: 500 },
      );
    }

    const existing = new Set(
      (existingRows || []).map(row => String(row.source_event_id)),
    );
    summary.updated = activeEvents.filter(event => existing.has(event.source_event_id)).length;
    summary.inserted = activeEvents.length - summary.updated;

    const { error: upsertError } = await db
      .from("events")
      .upsert(activeEvents.map(databaseRow), { onConflict: "source_event_id" });

    if (upsertError) {
      console.error("City calendar event upsert failed", upsertError.message);
      return NextResponse.json(
        { success: false, error: upsertError.message, summary, results },
        { status: 500 },
      );
    }
  }

  console.info("City calendar ingestion complete", summary);
  return NextResponse.json({
    success: true,
    generatedAt: new Date().toISOString(),
    registeredSources: CITY_CALENDAR_SOURCES.map(source => ({
      id: source.id,
      city: source.city,
      format: source.format,
      enabled: source.enabled,
    })),
    summary,
    results,
  });
}
