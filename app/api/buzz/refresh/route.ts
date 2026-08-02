import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { bestTimeSignals, createBestTimeForecast, fetchBestTimeLive, isBestTimeConfigured } from "../../../../src/lib/buzz/providers/besttime";
import { fetchTicketmasterInventory, isTicketmasterInventoryConfigured, ticketmasterInventorySignal } from "../../../../src/lib/buzz/providers/ticketmaster";
import { fetchPredictedEvents, isPredictHQConfigured, predictedAttendanceSignal } from "../../../../src/lib/buzz/providers/predicthq";
import { recomputeBuzzScore, saveBuzzSignals } from "../../../../src/lib/buzz/repository";
import type { BuzzSignal, VenueForBuzz } from "../../../../src/lib/buzz/types";
import { crowdLevelValue, summarizeVerifiedCrowdReports } from "../../../../src/lib/buzz/verified-reports";
import { meteredProviderCallsEnabled } from "../../../../src/lib/metered-providers";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const db = getSupabaseAdmin();

type VenueRow = VenueForBuzz & {
  lat?: number | null;
  lng?: number | null;
};

type ProviderVenueRow = {
  venue_id: string;
  external_id: string | null;
  coverage_status: string;
};

type ProviderEventRow = {
  venue_id: string | null;
  external_id: string;
};

type RefreshResult = {
  provider: string;
  attempted: number;
  succeeded: number;
  failed: number;
  details: Array<{ venueId?: string; externalId?: string; status: string; error?: string }>;
};

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  return request.headers.get("authorization") === `Bearer ${secret}` || request.headers.get("x-cron-secret") === secret;
}

function categoryBucket(venue: VenueRow) {
  const text = `${venue.type || ""} ${venue.category || ""} ${venue.name || ""}`.toLowerCase();
  if (/restaurant|food|cafe|coffee|brunch|bakery/.test(text)) return "food";
  if (/park|museum|beach|arcade|bowling|golf|zoo|aquarium|shopping|market|theater|theatre|arts|outdoor/.test(text)) return "activity";
  if (/bar|club|nightlife|lounge|brewery|wine|music/.test(text)) return "nightlife";
  return "other";
}

function chooseDiverse(venues: VenueRow[], limit: number) {
  const buckets = new Map<string, VenueRow[]>();
  for (const venue of venues) {
    const bucket = categoryBucket(venue);
    buckets.set(bucket, [...(buckets.get(bucket) || []), venue]);
  }
  const order = ["activity", "food", "other", "nightlife"];
  const chosen: VenueRow[] = [];
  let index = 0;
  while (chosen.length < limit && order.some(bucket => (buckets.get(bucket)?.length || 0) > index)) {
    for (const bucket of order) {
      const venue = buckets.get(bucket)?.[index];
      if (venue && chosen.length < limit) chosen.push(venue);
    }
    index += 1;
  }
  return chosen;
}

async function mapLimit<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>) {
  const output = new Array<R>(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      output[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => run()));
  return output;
}

async function loadVenues(ids: string[]) {
  if (!ids.length) return [] as VenueRow[];
  const { data, error } = await db
    .from("venues")
    .select("id,name,address,city,type,category,ai_score,lat,lng")
    .in("id", ids);
  if (error) throw new Error(error.message);
  return (data || []) as VenueRow[];
}

async function refreshBestTime(limit: number, bootstrap: boolean): Promise<RefreshResult> {
  const result: RefreshResult = { provider: "besttime", attempted: 0, succeeded: 0, failed: 0, details: [] };
  if (!meteredProviderCallsEnabled("besttime")) {
    result.details.push({ status: "skipped", error: "BestTime is disabled by the zero-cost provider policy" });
    return result;
  }
  if (!isBestTimeConfigured()) {
    result.details.push({ status: "skipped", error: "BESTTIME_API_KEY_PRIVATE is not configured" });
    return result;
  }

  let mappings: ProviderVenueRow[] = [];
  if (bootstrap) {
    const [{ data: venueData, error: venueError }, { data: mappingData, error: mappingError }] = await Promise.all([
      db.from("venues").select("id,name,address,city,type,category,ai_score,lat,lng").not("address", "is", null).order("ai_score", { ascending: false }).limit(500),
      db.from("buzz_provider_venues").select("venue_id,external_id,coverage_status").eq("provider", "besttime"),
    ]);
    if (venueError || mappingError) throw new Error(venueError?.message || mappingError?.message);
    const mappedIds = new Set((mappingData || []).map(row => row.venue_id));
    const candidates = chooseDiverse((venueData || []) as VenueRow[], 100).filter(venue => !mappedIds.has(venue.id)).slice(0, limit);
    result.attempted = candidates.length;

    await mapLimit(candidates, 3, async venue => {
      try {
        const mapping = await createBestTimeForecast(venue);
        const live = await fetchBestTimeLive(mapping.providerVenueId);
        const signals = bestTimeSignals(live);
        const coverage = signals.some(signal => signal.type === "besttime_live") ? "covered" : signals.length ? "forecast_only" : "no_data";
        const now = new Date().toISOString();
        const { error } = await db.from("buzz_provider_venues").upsert({
          venue_id: venue.id,
          provider: "besttime",
          external_id: mapping.providerVenueId,
          coverage_status: coverage,
          last_checked_at: now,
          last_success_at: signals.length ? now : null,
          metadata: { ...mapping.metadata, providerName: mapping.providerName, providerAddress: mapping.providerAddress, timezone: mapping.timezone },
          updated_at: now,
        }, { onConflict: "venue_id,provider" });
        if (error) throw new Error(error.message);
        await saveBuzzSignals(db, venue.id, signals);
        await recomputeBuzzScore(db, venue);
        result.succeeded += 1;
        result.details.push({ venueId: venue.id, externalId: mapping.providerVenueId, status: coverage });
      } catch (error) {
        result.failed += 1;
        result.details.push({ venueId: venue.id, status: "error", error: error instanceof Error ? error.message : "Unknown error" });
      }
    });
    return result;
  }

  const { data, error } = await db
    .from("buzz_provider_venues")
    .select("venue_id,external_id,coverage_status")
    .eq("provider", "besttime")
    .neq("coverage_status", "disabled")
    .not("external_id", "is", null)
    .order("last_checked_at", { ascending: true, nullsFirst: true })
    .limit(limit);
  if (error) throw new Error(error.message);
  mappings = (data || []) as ProviderVenueRow[];
  const venues = await loadVenues(mappings.map(mapping => mapping.venue_id));
  const venueMap = new Map(venues.map(venue => [venue.id, venue]));
  result.attempted = mappings.length;

  await mapLimit(mappings, 5, async mapping => {
    const venue = venueMap.get(mapping.venue_id);
    if (!venue || !mapping.external_id) return;
    try {
      const live = await fetchBestTimeLive(mapping.external_id);
      const signals = bestTimeSignals(live);
      const coverage = signals.some(signal => signal.type === "besttime_live") ? "covered" : signals.length ? "forecast_only" : "no_data";
      const now = new Date().toISOString();
      await saveBuzzSignals(db, venue.id, signals);
      await recomputeBuzzScore(db, venue);
      await db.from("buzz_provider_venues").update({ coverage_status: coverage, last_checked_at: now, last_success_at: signals.length ? now : null, updated_at: now }).eq("venue_id", venue.id).eq("provider", "besttime");
      result.succeeded += 1;
      result.details.push({ venueId: venue.id, externalId: mapping.external_id, status: coverage });
    } catch (refreshError) {
      const now = new Date().toISOString();
      await db.from("buzz_provider_venues").update({ coverage_status: "error", last_checked_at: now, updated_at: now }).eq("venue_id", venue.id).eq("provider", "besttime");
      result.failed += 1;
      result.details.push({ venueId: venue.id, externalId: mapping.external_id, status: "error", error: refreshError instanceof Error ? refreshError.message : "Unknown error" });
    }
  });
  return result;
}

async function refreshTicketmaster(limit: number): Promise<RefreshResult> {
  const result: RefreshResult = { provider: "ticketmaster", attempted: 0, succeeded: 0, failed: 0, details: [] };
  if (!isTicketmasterInventoryConfigured()) {
    result.details.push({ status: "skipped", error: "Ticketmaster Inventory Status access is not configured" });
    return result;
  }
  const { data, error } = await db.from("buzz_provider_events").select("venue_id,external_id").eq("provider", "ticketmaster").not("venue_id", "is", null).limit(limit);
  if (error) throw new Error(error.message);
  const mappings = (data || []) as ProviderEventRow[];
  result.attempted = mappings.length;
  try {
    const rows = await fetchTicketmasterInventory(mappings.map(mapping => mapping.external_id));
    const mappingMap = new Map(mappings.map(mapping => [mapping.external_id, mapping]));
    const affected = new Set<string>();
    for (const row of rows) {
      const externalId = String(row.eventId || row.eventid || "");
      const mapping = mappingMap.get(externalId);
      if (!mapping?.venue_id) continue;
      await saveBuzzSignals(db, mapping.venue_id, [ticketmasterInventorySignal(row)]);
      affected.add(mapping.venue_id);
      result.succeeded += 1;
      result.details.push({ venueId: mapping.venue_id, externalId, status: String(row.status || "unknown") });
    }
    const venues = await loadVenues([...affected]);
    await mapLimit(venues, 5, venue => recomputeBuzzScore(db, venue));
  } catch (refreshError) {
    result.failed = mappings.length;
    result.details.push({ status: "error", error: refreshError instanceof Error ? refreshError.message : "Unknown error" });
  }
  return result;
}

async function refreshPredictHQ(limit: number): Promise<RefreshResult> {
  const result: RefreshResult = { provider: "predicthq", attempted: 0, succeeded: 0, failed: 0, details: [] };
  if (!meteredProviderCallsEnabled("predicthq")) {
    result.details.push({ status: "skipped", error: "PredictHQ is disabled by the zero-cost provider policy" });
    return result;
  }
  if (!isPredictHQConfigured()) {
    result.details.push({ status: "skipped", error: "PREDICTHQ_ACCESS_TOKEN is not configured" });
    return result;
  }
  const { data, error } = await db.from("buzz_provider_venues").select("venue_id").eq("provider", "besttime").neq("coverage_status", "disabled").limit(limit);
  if (error) throw new Error(error.message);
  const venues = await loadVenues((data || []).map(row => row.venue_id));
  const usable = venues.filter(venue => Number.isFinite(Number(venue.lat)) && Number.isFinite(Number(venue.lng)));
  result.attempted = usable.length;

  await mapLimit(usable, 3, async venue => {
    try {
      const now = new Date();
      const payload = await fetchPredictedEvents({
        latitude: Number(venue.lat),
        longitude: Number(venue.lng),
        radiusMiles: 0.5,
        start: new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(),
        end: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
        limit: 10,
      });
      const best = [...(payload.results || [])].sort((a, b) => Number(b.local_rank ?? b.rank ?? 0) - Number(a.local_rank ?? a.rank ?? 0))[0];
      if (best) {
        await saveBuzzSignals(db, venue.id, [predictedAttendanceSignal(best)]);
        await recomputeBuzzScore(db, venue);
        result.succeeded += 1;
        result.details.push({ venueId: venue.id, externalId: best.id, status: "forecasted" });
      } else {
        result.details.push({ venueId: venue.id, status: "no_event" });
      }
    } catch (refreshError) {
      result.failed += 1;
      result.details.push({ venueId: venue.id, status: "error", error: refreshError instanceof Error ? refreshError.message : "Unknown error" });
    }
  });
  return result;
}

async function refreshFirstParty(limit: number): Promise<RefreshResult> {
  const result: RefreshResult = { provider: "first_party", attempted: 0, succeeded: 0, failed: 0, details: [] };
  const now = new Date();
  const [{ data: pulses, error: pulseError }, { data: reports, error: reportError }] = await Promise.all([
    db.from("venue_partner_pulses").select("venue_id,occupancy_band,occupancy_pct,wait_minutes,reservations_status,tickets_status,verified,observed_at,expires_at").gt("expires_at", now.toISOString()).order("observed_at", { ascending: false }).limit(limit * 5),
    db.from("buzz_user_reports").select("venue_id,user_id,device_hash,crowd_level,verified_nearby,observed_at,expires_at").eq("verified_nearby", true).gt("expires_at", now.toISOString()).order("observed_at", { ascending: false }).limit(limit * 20),
  ]);
  if (pulseError || reportError) throw new Error(pulseError?.message || reportError?.message);

  const affected = new Set<string>();
  const latestPulse = new Map<string, (typeof pulses)[number]>();
  for (const pulse of pulses || []) if (!latestPulse.has(pulse.venue_id)) latestPulse.set(pulse.venue_id, pulse);
  for (const [venueId, pulse] of latestPulse) {
    const value = pulse.occupancy_pct ?? crowdLevelValue(pulse.occupancy_band);
    const signal: BuzzSignal = {
      source: "venue_partner",
      family: "first_party_occupancy",
      type: "partner_pulse",
      value,
      isLive: true,
      confidence: pulse.verified ? 0.9 : 0.58,
      observedAt: pulse.observed_at,
      expiresAt: pulse.expires_at,
      metadata: { waitMinutes: pulse.wait_minutes, reservationsStatus: pulse.reservations_status, ticketStatus: pulse.tickets_status, verified: pulse.verified },
    };
    await saveBuzzSignals(db, venueId, [signal]);
    affected.add(venueId);
  }

  const grouped = new Map<string, (typeof reports)>();
  for (const report of reports || []) grouped.set(report.venue_id, [...(grouped.get(report.venue_id) || []), report]);
  for (const [venueId, venueReports] of grouped) {
    const summary = summarizeVerifiedCrowdReports(venueReports);
    if (!summary) continue;
    const uniqueUsers = summary.uniqueReporterCount;
    const signals: BuzzSignal[] = [{
      source: "lit757_users",
      family: "verified_users",
      type: "verified_presence",
      value: uniqueUsers,
      isLive: true,
      confidence: Math.min(0.9, 0.45 + uniqueUsers * 0.1),
      observedAt: summary.latestObservedAt,
      expiresAt: summary.expiresAt,
      metadata: { uniqueDevices: uniqueUsers, reportCount: summary.reports.length },
    }];
    if (uniqueUsers >= 2) signals.push({
      source: "lit757_users",
      family: "verified_users",
      type: "crowd_report",
      value: summary.average,
      isLive: true,
      confidence: Math.min(0.9, summary.consensus * (0.55 + Math.min(0.35, uniqueUsers * 0.05))),
      observedAt: summary.latestObservedAt,
      expiresAt: summary.expiresAt,
      metadata: { consensus: summary.consensus, reportCount: summary.reports.length, uniqueUsers },
    });
    await saveBuzzSignals(db, venueId, signals);
    affected.add(venueId);
  }

  const venueIds = [...affected].slice(0, limit);
  const venues = await loadVenues(venueIds);
  await mapLimit(venues, 5, venue => recomputeBuzzScore(db, venue));
  result.attempted = venueIds.length;
  result.succeeded = venues.length;
  result.details = venueIds.map(venueId => ({ venueId, status: "recomputed" }));
  return result;
}

async function run(request: Request) {
  if (!authorized(request)) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const provider = url.searchParams.get("provider") || "all";
  const action = url.searchParams.get("action") || "refresh";
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || (action === "bootstrap" ? 10 : 25))));
  const results: RefreshResult[] = [];

  try {
    if (provider === "all" || provider === "first_party") results.push(await refreshFirstParty(limit));
    if (provider === "all" || provider === "besttime") results.push(await refreshBestTime(limit, action === "bootstrap"));
    if (provider === "all" || provider === "ticketmaster") results.push(await refreshTicketmaster(limit));
    if (provider === "all" || provider === "predicthq") results.push(await refreshPredictHQ(Math.min(limit, 10)));
    return NextResponse.json({ success: true, action, provider, generatedAt: new Date().toISOString(), results });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Buzz refresh failed", results }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return run(request);
}

export async function POST(request: Request) {
  return run(request);
}
