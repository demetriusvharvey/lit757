import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { isCronAuthorized } from "../../../../src/lib/cron-auth";
import {
  PROMOTER_EVENT_SOURCES,
  fetchPromoterSource,
  promoterEventSignature,
} from "../../../../src/lib/events/promoter-events";
import type { NormalizedCityEvent } from "../../../../src/lib/events/city-calendars";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const db = getSupabaseAdmin();
const WINDOW_PAST_MS = 6 * 60 * 60 * 1_000;
const WINDOW_FUTURE_MS = 120 * 24 * 60 * 60 * 1_000;

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

async function run(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const dryRun = new URL(request.url).searchParams.get("dryRun") === "1";
  const now = new Date();
  const results = await Promise.all(PROMOTER_EVENT_SOURCES.map(source => fetchPromoterSource(source, now)));
  const collected = [...new Map(results.flatMap(result => result.events).map(event => [event.source_event_id, event])).values()];
  const startIso = new Date(now.getTime() - WINDOW_PAST_MS).toISOString();
  const endIso = new Date(now.getTime() + WINDOW_FUTURE_MS).toISOString();
  const summary = {
    sources: results.length,
    healthySources: results.filter(result => result.status === "ok").length,
    discoveredUrls: results.reduce((sum, result) => sum + result.discoveredUrls, 0),
    collected: collected.length,
    crossSourceDuplicates: 0,
    inserted: 0,
    updated: 0,
    dryRun,
  };

  try {
    const { data: existingRows, error: existingError } = await db
      .from("events")
      .select("source_event_id,name,venue_name,start_time")
      .gte("start_time", startIso)
      .lte("start_time", endIso)
      .limit(5_000);
    if (existingError) throw new Error(existingError.message);

    const existingSourceIds = new Set((existingRows || []).map(row => String(row.source_event_id || "")).filter(Boolean));
    const existingSignatures = new Map((existingRows || []).flatMap(row => {
      if (!row.name || !row.venue_name || !row.start_time) return [];
      return [[promoterEventSignature({
        name: String(row.name),
        venue_name: String(row.venue_name),
        start_time: String(row.start_time),
      }), String(row.source_event_id || "")]] as const;
    }));
    const accepted = collected.filter(event => {
      const duplicateId = existingSignatures.get(promoterEventSignature(event));
      if (duplicateId && duplicateId !== event.source_event_id && !existingSourceIds.has(event.source_event_id)) {
        summary.crossSourceDuplicates += 1;
        return false;
      }
      return true;
    });

    summary.updated = accepted.filter(event => existingSourceIds.has(event.source_event_id)).length;
    summary.inserted = accepted.length - summary.updated;
    if (!dryRun && accepted.length) {
      const { error } = await db.from("events").upsert(accepted.map(databaseRow), { onConflict: "source_event_id" });
      if (error) throw new Error(error.message);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Promoter event sync failed";
    console.error("Promoter event sync failed", message);
    return NextResponse.json({
      success: false,
      generatedAt: new Date().toISOString(),
      error: message,
      summary,
      sources: results.map(result => ({ id: result.source.id, status: result.status, error: result.error })),
    }, { status: 502, headers: { "Cache-Control": "private, no-store" } });
  }

  const failedSources = results.filter(result => result.status === "error").length;
  return NextResponse.json({
    success: results.some(result => result.status === "ok"),
    partial: failedSources > 0,
    generatedAt: new Date().toISOString(),
    truthNote: "Promoter and ticket listings add scheduled demand and featured-appearance context. They do not prove live venue occupancy.",
    summary,
    sources: results.map(result => ({
      id: result.source.id,
      name: result.source.name,
      city: result.source.city,
      landingUrl: result.source.landingUrl,
      status: result.status,
      discoveredUrls: result.discoveredUrls,
      events: result.events.length,
      skipped: result.skipped,
      error: result.error,
      fetchedAt: result.fetchedAt,
    })),
  }, {
    status: failedSources === results.length ? 502 : 200,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function GET(request: Request) {
  return run(request);
}

export async function POST(request: Request) {
  return run(request);
}
