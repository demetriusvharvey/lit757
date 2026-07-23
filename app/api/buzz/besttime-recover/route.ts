import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  bestTimeSignals,
  fetchBestTimeCurrentForecast,
  findBestTimeAccountVenue,
  isBestTimeAccountVenueForecasted,
  isBestTimeConfigured,
  isBestTimeForecastQueryConfigured,
  listBestTimeAccountVenues,
  mappingFromBestTimeAccountVenue,
} from "../../../../src/lib/buzz/providers/besttime";
import { recomputeBuzzScore, saveBuzzSignals } from "../../../../src/lib/buzz/repository";
import type { VenueForBuzz } from "../../../../src/lib/buzz/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

type VenueRow = VenueForBuzz & {
  lat?: number | null;
  lng?: number | null;
};

type RecoveryDetail = {
  venueId: string;
  localName: string;
  providerVenueId?: string;
  providerName?: string;
  status: "recovered" | "mapped_no_forecast" | "unsupported" | "not_in_account" | "error";
  error?: string;
};

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  return request.headers.get("authorization") === `Bearer ${secret}`
    || request.headers.get("x-cron-secret") === secret;
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

async function mapLimit<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>) {
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => run()));
}

async function recover(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!isBestTimeConfigured()) {
    return NextResponse.json({ success: false, error: "BESTTIME_API_KEY_PRIVATE is not configured" }, { status: 503 });
  }

  const url = new URL(request.url);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 25)));
  try {
    const [{ data: venueData, error: venueError }, { data: mappingData, error: mappingError }, accountVenues] = await Promise.all([
      db.from("venues").select("id,name,address,city,type,category,ai_score,lat,lng").not("address", "is", null).order("ai_score", { ascending: false }).limit(500),
      db.from("buzz_provider_venues").select("venue_id").eq("provider", "besttime"),
      listBestTimeAccountVenues(),
    ]);
    if (venueError || mappingError) throw new Error(venueError?.message || mappingError?.message);

    const mappedIds = new Set((mappingData || []).map(row => row.venue_id));
    const candidates = chooseDiverse((venueData || []) as VenueRow[], 100)
      .filter(venue => !mappedIds.has(venue.id))
      .slice(0, limit);
    const details: RecoveryDetail[] = [];

    await mapLimit(candidates, 3, async venue => {
      const accountVenue = findBestTimeAccountVenue(venue, accountVenues);
      if (!accountVenue) {
        details.push({ venueId: venue.id, localName: venue.name, status: "not_in_account" });
        return;
      }
      if (!isBestTimeAccountVenueForecasted(accountVenue) || !accountVenue.venue_id) {
        details.push({
          venueId: venue.id,
          localName: venue.name,
          providerVenueId: accountVenue.venue_id,
          providerName: accountVenue.venue_name,
          status: "unsupported",
        });
        return;
      }

      const mapping = mappingFromBestTimeAccountVenue(venue, accountVenue);
      const now = new Date().toISOString();
      const { error: upsertError } = await db.from("buzz_provider_venues").upsert({
        venue_id: venue.id,
        provider: "besttime",
        external_id: mapping.providerVenueId,
        coverage_status: "mapped",
        last_checked_at: now,
        last_success_at: null,
        metadata: {
          ...mapping.metadata,
          providerName: mapping.providerName,
          providerAddress: mapping.providerAddress,
          timezone: mapping.timezone,
          recoveredReadOnly: true,
        },
        updated_at: now,
      }, { onConflict: "venue_id,provider" });
      if (upsertError) {
        details.push({
          venueId: venue.id,
          localName: venue.name,
          providerVenueId: mapping.providerVenueId,
          providerName: mapping.providerName || undefined,
          status: "error",
          error: upsertError.message,
        });
        return;
      }

      if (!isBestTimeForecastQueryConfigured()) {
        details.push({
          venueId: venue.id,
          localName: venue.name,
          providerVenueId: mapping.providerVenueId,
          providerName: mapping.providerName || undefined,
          status: "mapped_no_forecast",
          error: "BESTTIME_API_KEY_PUBLIC is not configured",
        });
        return;
      }

      try {
        const payload = await fetchBestTimeCurrentForecast(mapping.providerVenueId);
        const signals = bestTimeSignals(payload);
        const coverage = signals.length ? "forecast_only" : "no_data";
        if (signals.length) await saveBuzzSignals(db, venue.id, signals);
        await recomputeBuzzScore(db, venue);
        await db.from("buzz_provider_venues").update({
          coverage_status: coverage,
          last_checked_at: now,
          last_success_at: signals.length ? now : null,
          updated_at: now,
        }).eq("venue_id", venue.id).eq("provider", "besttime");
        details.push({
          venueId: venue.id,
          localName: venue.name,
          providerVenueId: mapping.providerVenueId,
          providerName: mapping.providerName || undefined,
          status: signals.length ? "recovered" : "mapped_no_forecast",
        });
      } catch (error) {
        details.push({
          venueId: venue.id,
          localName: venue.name,
          providerVenueId: mapping.providerVenueId,
          providerName: mapping.providerName || undefined,
          status: "mapped_no_forecast",
          error: error instanceof Error ? error.message : "BestTime forecast query failed",
        });
      }
    });

    const recovered = details.filter(item => item.status === "recovered").length;
    const mappedWithoutForecast = details.filter(item => item.status === "mapped_no_forecast").length;
    const unsupported = details.filter(item => item.status === "unsupported").length;
    const notInAccount = details.filter(item => item.status === "not_in_account").length;
    const failed = details.filter(item => item.status === "error").length;

    return NextResponse.json({
      success: true,
      mode: "read_only_recovery",
      generatedAt: new Date().toISOString(),
      accountVenueCount: accountVenues.length,
      accountForecastedCount: accountVenues.filter(isBestTimeAccountVenueForecasted).length,
      accountSample: accountVenues.slice(0, 25).map(venue => ({
        venueId: venue.venue_id || null,
        name: venue.venue_name || null,
        address: venue.venue_address || null,
        forecasted: isBestTimeAccountVenueForecasted(venue),
      })),
      candidateCount: candidates.length,
      recovered,
      mappedWithoutForecast,
      unsupported,
      notInAccount,
      failed,
      details,
      truthNote: "This endpoint never creates or refreshes a BestTime forecast. It only maps forecasts already present in the account and stores public-key forecast evidence as non-live context.",
    }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    return NextResponse.json({
      success: false,
      mode: "read_only_recovery",
      error: error instanceof Error ? error.message : "BestTime read-only recovery failed",
    }, { status: 500, headers: { "Cache-Control": "no-store, max-age=0" } });
  }
}

export async function GET(request: Request) {
  return recover(request);
}

export async function POST(request: Request) {
  return recover(request);
}
