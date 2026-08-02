import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import {
  DIRECT_PRESENCE_WINDOW_MINUTES,
  directPresenceBand,
  groupDirectPresence,
  privacySafeDirectPresenceCount,
  type DirectPresenceRow,
} from "../../../src/lib/buzz/direct-presence";
import { fetchHrtRealtime, fetchHrtStatic } from "../../../src/lib/integrations/hrt";
import {
  fetchNwsWeather,
  HAMPTON_ROADS_WEATHER_POINTS,
  weatherActivityImpact,
} from "../../../src/lib/integrations/nws";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const db = getSupabaseAdmin();

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

function rejectionMessage(result: PromiseSettledResult<unknown>) {
  if (result.status === "fulfilled") return null;
  return result.reason instanceof Error ? result.reason.message : String(result.reason || "Unknown error");
}

export async function GET() {
  const now = new Date();
  const nowIso = now.toISOString();
  const eventEnd = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000).toISOString();
  const presenceStart = new Date(now.getTime() - DIRECT_PRESENCE_WINDOW_MINUTES * 60_000).toISOString();

  const databasePromise = Promise.all([
    db.from("events").select("source,start_time,created_at,source_url").gte("start_time", nowIso).lte("start_time", eventEnd).limit(5000),
    db.from("venues").select("google_place_id,photo_source").limit(5000),
    db.from("buzz_provider_venues").select("provider,coverage_status,last_success_at").limit(5000),
    db.from("buzz_provider_events").select("provider,venue_id,external_id").limit(5000),
    db.from("buzz_signal_snapshots").select("source,is_live,observed_at,expires_at").gt("expires_at", nowIso).limit(5000),
    db.from("buzz_score_snapshots").select("score_mode,confidence,computed_at,expires_at").gt("expires_at", nowIso).limit(5000),
    db.from("venue_live_reports").select("venue_id,device_id,report_type,created_at").in("report_type", ["nearby_presence", "passive_presence"]).gte("created_at", presenceStart).order("created_at", { ascending: false }).limit(5000),
  ]);

  const publicFeedsPromise = Promise.allSettled([
    Promise.all(HAMPTON_ROADS_WEATHER_POINTS.map(async point => {
      const weather = await fetchNwsWeather(point.latitude, point.longitude);
      return {
        id: point.id,
        city: point.city,
        status: "healthy",
        forecastUpdatedAt: weather.forecastUpdatedAt,
        hourlyUpdatedAt: weather.hourlyUpdatedAt,
        forecastPeriods: weather.forecast.length,
        hourlyPeriods: weather.hourly.length,
        activeAlerts: weather.alerts.length,
        activityImpact: weatherActivityImpact(weather.hourly[0]),
      };
    })),
    fetchHrtStatic(),
    fetchHrtRealtime(),
  ]);

  const [results, publicFeeds] = await Promise.all([databasePromise, publicFeedsPromise]);
  const [eventResult, venueResult, providerVenueResult, providerEventResult, signalResult, scoreResult, presenceResult] = results as Result[];
  const events = records(eventResult);
  const venues = records(venueResult);
  const providerVenues = records(providerVenueResult);
  const providerEvents = records(providerEventResult);
  const signals = records(signalResult);
  const scores = records(scoreResult);
  const directPresence = groupDirectPresence(records(presenceResult) as DirectPresenceRow[], now);

  const [weatherResult, staticTransitResult, realtimeTransitResult] = publicFeeds;
  const weatherPoints = weatherResult.status === "fulfilled" ? weatherResult.value : [];
  const staticTransit = staticTransitResult.status === "fulfilled" ? staticTransitResult.value : null;
  const realtimeTransit = realtimeTransitResult.status === "fulfilled" ? realtimeTransitResult.value : null;

  const warnings: string[] = [];
  if (!events.length) warnings.push("No upcoming events were found in the next 60 days.");
  if (!signals.length) warnings.push("No unexpired activity signals are stored.");
  if (!scores.length) warnings.push("No unexpired Buzz Score snapshots are stored.");
  if (presenceResult.error) warnings.push(`Direct presence health check failed: ${error(presenceResult)}`);
  else if (!directPresence.activeDevices) warnings.push("No fresh opt-in nearby presence is available; Buzz remains forecast-only without other direct evidence.");
  else if (!directPresence.venuesMeetingLiveThreshold) warnings.push("Fresh nearby presence is below the independent-phone Live threshold.");
  if (!providerEvents.length) warnings.push("No ticket-inventory event mappings are stored.");
  if (weatherResult.status === "rejected") warnings.push(`National Weather Service health check failed: ${rejectionMessage(weatherResult)}`);
  if (staticTransitResult.status === "rejected") warnings.push(`HRT static GTFS health check failed: ${rejectionMessage(staticTransitResult)}`);
  if (realtimeTransitResult.status === "rejected") warnings.push(`HRT realtime health check failed: ${rejectionMessage(realtimeTransitResult)}`);
  if (realtimeTransit && !realtimeTransit.availability.vehiclePositions) {
    warnings.push(realtimeTransit.availability.vehiclePositionsNote || "HRT vehicle positions are not available.");
  }

  const databaseHealthy = results.every(result => !result.error);
  const publicFeedsHealthy = publicFeeds.every(result => result.status === "fulfilled");

  return NextResponse.json({
    success: databaseHealthy && publicFeedsHealthy,
    generatedAt: nowIso,
    schedules: {
      cityCalendarSync: "every 4 hours",
      eventImport: "daily at 21:00 UTC",
      venuePhotoRefresh: "daily at 10:30 UTC",
      publicDataSmoke: "every 2 hours",
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
      directPresence: {
        windowMinutes: directPresence.windowMinutes,
        activeDeviceBand: directPresenceBand(directPresence.activeDevices),
        activeDeviceCount: privacySafeDirectPresenceCount(directPresence.activeDevices),
        passiveDeviceBand: directPresenceBand(directPresence.passiveDevices),
        verifiedDeviceBand: directPresenceBand(directPresence.verifiedDevices),
        venuesWithEvidence: directPresence.venuesWithEvidence,
        venuesMeetingLiveThreshold: directPresence.venuesMeetingLiveThreshold,
        venuesBelowLiveThreshold: directPresence.venuesBelowLiveThreshold,
        newestPresenceAt: directPresence.activeDevices >= 3 ? directPresence.latestObservedAt : null,
        liveThreshold: "3 passive phones, 2 signed-in verified phones, or 2 passive plus 1 verified phone",
        privacy: "Counts of 1 or 2 devices are grouped; venue, user, device, and exact-location identifiers are never returned.",
        error: error(presenceResult),
      },
      errors: {
        providerVenues: error(providerVenueResult),
        providerEvents: error(providerEventResult),
        signals: error(signalResult),
        scores: error(scoreResult),
        directPresence: error(presenceResult),
      },
    },
    publicFeeds: {
      weather: {
        provider: "National Weather Service",
        status: weatherResult.status === "fulfilled" ? "healthy" : "error",
        points: weatherPoints,
        error: rejectionMessage(weatherResult),
      },
      transit: {
        provider: "Hampton Roads Transit",
        static: staticTransit ? {
          status: "healthy",
          generatedAt: staticTransit.generatedAt,
          routeCount: staticTransit.routeCount,
          stopCount: staticTransit.stopCount,
          source: staticTransit.source,
          error: null,
        } : {
          status: "error",
          routeCount: 0,
          stopCount: 0,
          error: rejectionMessage(staticTransitResult),
        },
        realtime: realtimeTransit ? {
          status: "healthy",
          generatedAt: realtimeTransit.generatedAt,
          tripUpdates: realtimeTransit.tripUpdates.length,
          serviceAlerts: realtimeTransit.alerts.length,
          vehicles: realtimeTransit.vehicles.length,
          availability: realtimeTransit.availability,
          error: null,
        } : {
          status: "error",
          tripUpdates: 0,
          serviceAlerts: 0,
          vehicles: 0,
          error: rejectionMessage(realtimeTransitResult),
        },
      },
    },
    truthRules: {
      weather: "Weather may suppress or qualify forecasts but cannot prove venue occupancy.",
      transit: "Transit arrivals may support district movement estimates but cannot make a venue Live by themselves.",
      vehiclePositions: "Vehicle positions remain unavailable until HRT publishes or authorizes an official feed.",
    },
    warnings,
  }, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
