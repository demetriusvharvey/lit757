import {
  dedupeInstitutionEvents,
  fetchAllInstitutionCalendars,
} from "./institution-calendars";
import { fetchSimpleviewRssCalendar } from "./simpleview-rss";

export const VISIT_NEWPORT_NEWS_SOURCE = {
  id: "visit_newport_news_official",
  name: "Visit Newport News Events",
  kind: "tourism" as const,
  city: "Newport News",
  url: "https://www.visitnewportnews.com/event/rss/",
  format: "simpleview-rss" as const,
  enabled: true,
  coverageNote: "Official destination calendar via its public RSS feed and structured first-party event detail pages.",
};

async function fetchVisitNewportNewsSource() {
  const fetchedAt = new Date().toISOString();
  try {
    const events = dedupeInstitutionEvents(
      await fetchSimpleviewRssCalendar(VISIT_NEWPORT_NEWS_SOURCE),
    );
    return {
      source: VISIT_NEWPORT_NEWS_SOURCE,
      status: "ok" as const,
      events,
      error: null,
      fetchedAt,
    };
  } catch (error) {
    return {
      source: VISIT_NEWPORT_NEWS_SOURCE,
      status: "error" as const,
      events: [],
      error: error instanceof Error ? error.message : "Unknown Visit Newport News calendar error",
      fetchedAt,
    };
  }
}

export async function fetchAllInstitutionCalendarsWithExtensions() {
  const [base, visitNewportNews] = await Promise.all([
    fetchAllInstitutionCalendars(),
    fetchVisitNewportNewsSource(),
  ]);
  const results = [...base.results, visitNewportNews];
  const rawEvents = results.flatMap(result => result.events);
  const events = dedupeInstitutionEvents(rawEvents);
  const kinds = [...new Set(results.map(result => result.source.kind))];

  return {
    generatedAt: new Date().toISOString(),
    results,
    events,
    summary: {
      registeredSources: results.length,
      successfulSources: results.filter(result => result.status === "ok").length,
      failedSources: results.filter(result => result.status === "error").length,
      rawEvents: rawEvents.length,
      dedupedEvents: events.length,
      byKind: Object.fromEntries(kinds.map(kind => [
        kind,
        {
          registered: results.filter(result => result.source.kind === kind).length,
          successful: results.filter(result => result.source.kind === kind && result.status === "ok").length,
          events: results
            .filter(result => result.source.kind === kind)
            .reduce((sum, result) => sum + result.events.length, 0),
        },
      ])),
    },
  };
}
