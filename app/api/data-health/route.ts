import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

type Row = Record<string, unknown>;
type Result = { data: unknown; error: { message: string } | null };

const records = (result: Result) => Array.isArray(result.data) ? result.data as Row[] : [];
const error = (result: Result) => result.error?.message || null;

function countBy(items: Row[], key: string) {
  return items.reduce<Record<string, number>>((counts, item) => {
    const value = String(item[key] || "unknown").toLowerCase();
    counts[value] = (counts[value] || 0) + 1;
    return counts;
  }, {});
}

function latest(items: Row[], key: string) {
  const timestamps = items
    .map(item => new Date(String(item[key] || "")).getTime())
    .filter(Number.isFinite);
  return timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : null;
}

export async function GET() {
  const now = new Date();
  const nowIso = now.toISOString();
  const eventEnd = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000).toISOString();

  const results = await Promise.all([
    db.from("events").select("source,start_time,created_at,source_url").gte("start_time", nowIso).lte("start_time", eventEnd).limit(5000),
    db.from("venues").select("google_place_id,photo_source").limit(5000),
    db.from("buzz_provider_venues").select("provider,coverage_status,last_success_at").limit(5000),
    db.from("buzz_provider_events").select("provider,venue_id,external_id").limit(5000),
    db.from("buzz_signal_snapshots").select("source,is_live,observed_at,expires_at").gt("expires_at", nowIso).limit(5000),
    db.from("buzz_score_snapshots").select("score_mode,confidence,computed_at,expires_at").gt("expires_at", nowIso).limit(5000),
  ]);

  const [eventResult, venueResult, providerVenueResult, providerEventResult, signalResult, scoreResult] = results as Result[];
  const events = records(eventResult);
  const venues = records(venueResult);
  const providerVenues = records(providerVenueResult);
  const providerEvents = records(providerEventResult);
  const signals = records(signalResult);
  const scores = records(scoreResult);

  const warnings: string[] = [];
  if (!events.length) warnings.push("No upcoming events were found in the next 60 days.");
  if (!signals.length) warnings.push("No unexpired activity signals are stored.");
  if (!scores.length) warnings.push("No unexpired Buzz Score snapshots are stored.");
  if (!providerEvents.length) warnings.push("No ticket-inventory event mappings are stored.");
  warnings.push("Event import currently runs daily, not continuously.");
  warnings.push("The Buzz provider refresh endpoint is not currently scheduled in vercel.json.");

  return NextResponse.json({
    success: results.every(result => !result.error),
    generatedAt: nowIso,
    schedules: {
      eventImport: "daily at 21:00 UTC",
      venuePhotoRefresh: "daily at 10:30 UTC",
      buzzRefresh: "not scheduled",
    },
    events: {
      upcomingNext60Days: events.length,
      bySource: countBy(events, "source"),
      newestImportedAt: latest(events, "created_at"),
      withTicketLink: events.filter(item => Boolean(item.source_url)).length,
      error: error(eventResult),
    },
    photos: {
      venues: venues.length,
      withGooglePlaceId: venues.filter(item => Boolean(item.google_place_id)).length,
      byStoredSource: countBy(venues, "photo_source"),
      error: error(venueResult),
    },
    realtime: {
      mappedVenues: providerVenues.length,
      venueMappingsByProvider: countBy(providerVenues, "provider"),
      venueCoverageByStatus: countBy(providerVenues, "coverage_status"),
      newestProviderSuccessAt: latest(providerVenues, "last_success_at"),
      mappedTicketedEvents: providerEvents.length,
      eventMappingsByProvider: countBy(providerEvents, "provider"),
      activeSignals: signals.length,
      liveSignals: signals.filter(item => item.is_live === true).length,
      activeSignalsBySource: countBy(signals, "source"),
      newestSignalAt: latest(signals, "observed_at"),
      activeScores: scores.length,
      scoreModes: countBy(scores, "score_mode"),
      scoreConfidence: countBy(scores, "confidence"),
      newestScoreAt: latest(scores, "computed_at"),
      errors: {
        providerVenues: error(providerVenueResult),
        providerEvents: error(providerEventResult),
        signals: error(signalResult),
        scores: error(scoreResult),
      },
    },
    warnings,
  }, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
