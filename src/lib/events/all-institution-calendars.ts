import {
  dedupeInstitutionEvents,
  fetchAllInstitutionCalendars,
} from "./institution-calendars";
import { fetchSimpleviewRssCalendar } from "./simpleview-rss";
import type { NormalizedCityEvent } from "./city-calendars";

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

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  quot: '"',
  nbsp: " ",
  eacute: "é",
  Eacute: "É",
  aacute: "á",
  Aacute: "Á",
  iacute: "í",
  Iacute: "Í",
  oacute: "ó",
  Oacute: "Ó",
  uacute: "ú",
  Uacute: "Ú",
  ntilde: "ñ",
  Ntilde: "Ñ",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  ndash: "–",
  mdash: "—",
};

function cleanDisplayText(value: string | null) {
  if (!value) return value;
  return value
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&([a-zA-Z]+);/g, (entity, name: string) => NAMED_ENTITIES[name] ?? entity)
    .replace(/\s+/g, " ")
    .trim();
}

function cleanEventDisplayFields(event: NormalizedCityEvent): NormalizedCityEvent {
  return {
    ...event,
    name: cleanDisplayText(event.name) || event.name,
    description: cleanDisplayText(event.description),
    venue_name: cleanDisplayText(event.venue_name) || event.venue_name,
    address: cleanDisplayText(event.address),
  };
}

async function fetchVisitNewportNewsSource() {
  const fetchedAt = new Date().toISOString();
  try {
    const events = dedupeInstitutionEvents(
      (await fetchSimpleviewRssCalendar(VISIT_NEWPORT_NEWS_SOURCE)).map(cleanEventDisplayFields),
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
