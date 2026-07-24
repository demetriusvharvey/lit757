import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { isCronAuthorized } from "../../../src/lib/cron-auth";

export const dynamic = "force-dynamic";

const supabaseAdmin = getSupabaseAdmin();

export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = Date.now();
  const weekAhead = new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString();
  const [venuesResult, eventsResult] = await Promise.all([
    supabaseAdmin
      .from("venues")
      .select("id,name,hours,google_rating,google_place_id,photo_source,website,enriched_at")
      .limit(1000),
    supabaseAdmin
      .from("events")
      .select("id,name,venue_name,start_time,source,created_at")
      .gte("start_time", new Date(now).toISOString())
      .lte("start_time", weekAhead)
      .order("start_time", { ascending: true })
      .limit(1000),
  ]);

  if (venuesResult.error || eventsResult.error) {
    return NextResponse.json(
      { error: venuesResult.error?.message || eventsResult.error?.message || "Audit failed" },
      { status: 500 }
    );
  }

  const venues = venuesResult.data || [];
  const events = eventsResult.data || [];
  const staleCutoff = now - 48 * 60 * 60 * 1000;
  const staleVenues = venues.filter((venue) => {
    const updated = venue.enriched_at ? new Date(venue.enriched_at).getTime() : 0;
    return !updated || updated < staleCutoff;
  });
  const missing = {
    hours: venues.filter((venue) => !venue.hours).length,
    rating: venues.filter((venue) => !venue.google_rating).length,
    storefront: venues.filter(
      (venue) => venue.photo_source !== "google_streetview" || !venue.google_place_id
    ).length,
    website: venues.filter((venue) => !venue.website).length,
  };
  const newestEventSync = events
    .map((event) => event.created_at ? new Date(event.created_at).getTime() : 0)
    .sort((left, right) => right - left)[0] || 0;
  const eventFeedAgeHours = newestEventSync ? (now - newestEventSync) / 3_600_000 : null;
  const issues: string[] = [];

  if (staleVenues.length > Math.max(20, venues.length * 0.1)) {
    issues.push(`${staleVenues.length} venues have not been enriched in 48 hours`);
  }
  if (eventFeedAgeHours === null || eventFeedAgeHours > 6) {
    issues.push("The event feed is stale or empty");
  }
  if (events.length < 10) issues.push("Fewer than 10 events are available for the next seven days");
  if (missing.storefront > venues.length * 0.15) issues.push("Storefront photo coverage fell below 85%");
  if (missing.hours > venues.length * 0.3) issues.push("Verified hours coverage fell below 70%");
  if (missing.rating > venues.length * 0.4) issues.push("Ratings coverage fell below 60%");

  const report = {
    healthy: issues.length === 0,
    checkedAt: new Date(now).toISOString(),
    totals: { venues: venues.length, nextSevenDaysEvents: events.length },
    coverage: {
      hours: venues.length ? Number(((venues.length - missing.hours) / venues.length).toFixed(3)) : 0,
      ratings: venues.length ? Number(((venues.length - missing.rating) / venues.length).toFixed(3)) : 0,
      storefronts: venues.length ? Number(((venues.length - missing.storefront) / venues.length).toFixed(3)) : 0,
      websites: venues.length ? Number(((venues.length - missing.website) / venues.length).toFixed(3)) : 0,
    },
    eventFeedAgeHours: eventFeedAgeHours === null ? null : Number(eventFeedAgeHours.toFixed(1)),
    staleVenueCount: staleVenues.length,
    issues,
  };

  if (issues.length) console.warn("757 data quality warning", report);
  return NextResponse.json(report, { headers: { "Cache-Control": "no-store" } });
}
