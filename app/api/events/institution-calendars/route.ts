import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  fetchAllInstitutionCalendars,
  institutionEventSignature,
} from "../../../../src/lib/events/institution-calendars";
import type { NormalizedCityEvent } from "../../../../src/lib/events/city-calendars";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const WINDOW_PAST_MS = 6 * 60 * 60 * 1000;
const WINDOW_FUTURE_MS = 120 * 24 * 60 * 60 * 1000;
const DATABASE_CHUNK_SIZE = 200;

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  return request.headers.get("authorization") === `Bearer ${secret}`
    || request.headers.get("x-cron-secret") === secret;
}

function chunks<T>(items: T[], size = DATABASE_CHUNK_SIZE) {
  const output: T[][] = [];
  for (let index = 0; index < items.length; index += size) output.push(items.slice(index, index + size));
  return output;
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

async function existingUpcomingEvents(start: string, end: string) {
  const { data, error } = await db
    .from("events")
    .select("source_event_id,name,venue_name,start_time,source")
    .gte("start_time", start)
    .lte("start_time", end)
    .limit(5000);
  if (error) throw new Error(error.message);
  return data || [];
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
  const startIso = new Date(now - WINDOW_PAST_MS).toISOString();
  const endIso = new Date(now + WINDOW_FUTURE_MS).toISOString();
  const fetched = await fetchAllInstitutionCalendars();
  const inWindow = fetched.events.filter(event => {
    const start = new Date(event.start_time).getTime();
    return Number.isFinite(start) && start >= now - WINDOW_PAST_MS && start <= now + WINDOW_FUTURE_MS;
  });

  const summary = {
    ...fetched.summary,
    inWindow: inWindow.length,
    crossSourceDuplicates: 0,
    inserted: 0,
    updated: 0,
    dryRun,
  };

  try {
    const existing = await existingUpcomingEvents(startIso, endIso);
    const existingSourceIds = new Set(existing.map(row => String(row.source_event_id || "")).filter(Boolean));
    const existingSignatures = new Map(
      existing.flatMap(row => {
        if (!row.name || !row.start_time || !row.venue_name) return [];
        return [[institutionEventSignature({
          name: String(row.name),
          start_time: String(row.start_time),
          venue_name: String(row.venue_name),
        }), String(row.source_event_id || "")]] as const;
      }),
    );

    const accepted: NormalizedCityEvent[] = [];
    for (const event of inWindow) {
      const duplicateId = existingSignatures.get(institutionEventSignature(event));
      if (duplicateId && duplicateId !== event.source_event_id && !existingSourceIds.has(event.source_event_id)) {
        summary.crossSourceDuplicates += 1;
        continue;
      }
      accepted.push(event);
    }

    summary.updated = accepted.filter(event => existingSourceIds.has(event.source_event_id)).length;
    summary.inserted = accepted.length - summary.updated;
    if (!dryRun && accepted.length) await upsertEvents(accepted);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Institution calendar database sync failed";
    console.error("Institution calendar sync failed", message);
    return NextResponse.json({
      success: false,
      generatedAt: new Date().toISOString(),
      error: message,
      summary,
      sources: fetched.results.map(result => ({
        id: result.source.id,
        name: result.source.name,
        kind: result.source.kind,
        city: result.source.city,
        status: result.status,
        fetched: result.events.length,
        error: result.error,
      })),
    }, { status: 500 });
  }

  const failedSources = fetched.results.filter(result => result.status === "error").length;
  return NextResponse.json({
    success: fetched.results.some(result => result.status === "ok"),
    partial: failedSources > 0,
    generatedAt: new Date().toISOString(),
    truthNote: "Institution events add scheduled demand context. They do not prove live venue occupancy.",
    summary,
    sources: fetched.results.map(result => ({
      id: result.source.id,
      name: result.source.name,
      kind: result.source.kind,
      city: result.source.city,
      format: result.source.format,
      status: result.status,
      fetched: result.events.length,
      error: result.error,
      fetchedAt: result.fetchedAt,
      coverageNote: result.source.coverageNote || null,
    })),
  }, {
    status: failedSources === fetched.results.length ? 502 : 200,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function GET(request: Request) {
  return run(request);
}

export async function POST(request: Request) {
  return run(request);
}
