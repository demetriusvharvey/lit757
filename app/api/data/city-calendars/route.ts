import { unstable_cache } from "next/cache";
import { NextResponse } from "next/server";
import { fetchAllCivicPlusCalendars } from "../../../../src/lib/events/civicplus-calendars";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const getCachedCityCalendarHealth = unstable_cache(
  fetchAllCivicPlusCalendars,
  ["buzz-civicplus-calendar-health-v2"],
  { revalidate: 1_800 },
);

export async function GET() {
  const data = await getCachedCityCalendarHealth();
  const cityHealth = Object.fromEntries(
    [...new Set(data.results.map(result => result.feed.city))].map(city => {
      const feeds = data.results.filter(result => result.feed.city === city);
      return [city, {
        registeredFeeds: feeds.length,
        successfulFeeds: feeds.filter(result => result.status === "ok").length,
        failedFeeds: feeds.filter(result => result.status === "error").length,
        eventCount: feeds.reduce((sum, result) => sum + result.events.length, 0),
      }];
    }),
  );
  const successfulFeeds = data.results.filter(result => result.status === "ok").length;

  return NextResponse.json({
    success: successfulFeeds > 0,
    partial: data.summary.failedFeeds > 0,
    provider: "Official Hampton Roads municipal calendars",
    generatedAt: data.generatedAt,
    summary: data.summary,
    cityHealth,
    feeds: data.results.map(result => ({
      feedId: result.feed.feedId,
      city: result.feed.city,
      category: result.feed.category,
      status: result.status,
      eventCount: result.events.length,
      error: result.error,
      coverageNote: result.feed.coverageNote || null,
    })),
    truthNote: "Calendar events are scheduled activity context, not proof of current venue occupancy.",
  }, {
    status: successfulFeeds ? 200 : 502,
    headers: { "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=3600" },
  });
}
