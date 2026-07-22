import {
  parseCityCalendarIcs,
  type CityCalendarSource,
  type NormalizedCityEvent,
} from "./city-calendars";

const EASTERN_TIME_ZONE = "America/New_York";
const REQUEST_TIMEOUT_MS = 12_000;
const FETCH_ATTEMPTS = 2;
const HOST_CONCURRENCY = 4;
const BETWEEN_FEEDS_MS = 200;

export type CivicPlusCalendarFeed = {
  feedId: string;
  category: string;
  citySourceId: string;
  city: string;
  citySourceName: string;
  url: string;
  enabled: boolean;
  coverageNote?: string;
};

export type CivicPlusFeedResult = {
  feed: CivicPlusCalendarFeed;
  status: "ok" | "error";
  events: NormalizedCityEvent[];
  error: string | null;
  fetchedAt: string;
};

function feedUrl(origin: string, categoryId: number) {
  return `${origin}/common/modules/iCalendar/iCalendar.aspx?catID=${categoryId}&feed=calendar`;
}

export const CIVICPLUS_CALENDAR_FEEDS: CivicPlusCalendarFeed[] = [
  {
    feedId: "norfolk_arts_culture",
    category: "Arts & Culture Events",
    citySourceId: "norfolk_official",
    city: "Norfolk",
    citySourceName: "City of Norfolk Official Calendars",
    url: feedUrl("https://www.norfolk.gov", 24),
    enabled: true,
  },
  {
    feedId: "norfolk_community",
    category: "Community & Neighborhood Events",
    citySourceId: "norfolk_official",
    city: "Norfolk",
    citySourceName: "City of Norfolk Official Calendars",
    url: feedUrl("https://www.norfolk.gov", 75),
    enabled: true,
  },
  {
    feedId: "norfolk_arts",
    category: "Norfolk Arts",
    citySourceId: "norfolk_official",
    city: "Norfolk",
    citySourceName: "City of Norfolk Official Calendars",
    url: feedUrl("https://www.norfolk.gov", 166),
    enabled: true,
  },
  {
    feedId: "norfolk_parks",
    category: "Parks & Recreation",
    citySourceId: "norfolk_official",
    city: "Norfolk",
    citySourceName: "City of Norfolk Official Calendars",
    url: feedUrl("https://www.norfolk.gov", 163),
    enabled: true,
  },
  {
    feedId: "norfolk_slover",
    category: "The Slover",
    citySourceId: "norfolk_official",
    city: "Norfolk",
    citySourceName: "City of Norfolk Official Calendars",
    url: feedUrl("https://www.norfolk.gov", 147),
    enabled: true,
  },
  {
    feedId: "chesapeake_events",
    category: "Events & Activities",
    citySourceId: "chesapeake_official",
    city: "Chesapeake",
    citySourceName: "City of Chesapeake Official Calendars",
    url: feedUrl("https://www.cityofchesapeake.net", 14),
    enabled: true,
  },
  {
    feedId: "chesapeake_library",
    category: "Chesapeake Public Library",
    citySourceId: "chesapeake_official",
    city: "Chesapeake",
    citySourceName: "City of Chesapeake Official Calendars",
    url: feedUrl("https://www.cityofchesapeake.net", 43),
    enabled: true,
  },
  {
    feedId: "chesapeake_parks_programs",
    category: "Parks Programs & Events",
    citySourceId: "chesapeake_official",
    city: "Chesapeake",
    citySourceName: "City of Chesapeake Official Calendars",
    url: feedUrl("https://www.cityofchesapeake.net", 29),
    enabled: true,
  },
  {
    feedId: "chesapeake_parks_special",
    category: "Parks Special Events",
    citySourceId: "chesapeake_official",
    city: "Chesapeake",
    citySourceName: "City of Chesapeake Official Calendars",
    url: feedUrl("https://www.cityofchesapeake.net", 28),
    enabled: true,
  },
  {
    feedId: "portsmouth_main",
    category: "Main Calendar",
    citySourceId: "portsmouth_official",
    city: "Portsmouth",
    citySourceName: "City of Portsmouth Official Calendar",
    url: feedUrl("https://humanresources.portsmouthva.gov", 22),
    enabled: true,
    coverageNote: "Portsmouth currently exposes a limited CivicPlus main calendar on its official subdomain.",
  },
  {
    feedId: "hampton_main",
    category: "Main Calendar",
    citySourceId: "hampton_official",
    city: "Hampton",
    citySourceName: "City of Hampton Official Calendars",
    url: feedUrl("https://www.hampton.gov", 14),
    enabled: true,
  },
  {
    feedId: "hampton_community",
    category: "Community Calendar",
    citySourceId: "hampton_official",
    city: "Hampton",
    citySourceName: "City of Hampton Official Calendars",
    url: feedUrl("https://www.hampton.gov", 74),
    enabled: true,
  },
  {
    feedId: "hampton_parks_special",
    category: "Parks Special Events",
    citySourceId: "hampton_official",
    city: "Hampton",
    citySourceName: "City of Hampton Official Calendars",
    url: feedUrl("https://www.hampton.gov", 71),
    enabled: true,
  },
  {
    feedId: "hampton_arts",
    category: "Hampton Arts Classes & Events",
    citySourceId: "hampton_official",
    city: "Hampton",
    citySourceName: "City of Hampton Official Calendars",
    url: feedUrl("https://www.hampton.gov", 56),
    enabled: true,
  },
  {
    feedId: "hampton_history_museum",
    category: "Hampton History Museum",
    citySourceId: "hampton_official",
    city: "Hampton",
    citySourceName: "City of Hampton Official Calendars",
    url: feedUrl("https://www.hampton.gov", 119),
    enabled: true,
  },
  {
    feedId: "hampton_bluebird_gap_farm",
    category: "Bluebird Gap Farm",
    citySourceId: "hampton_official",
    city: "Hampton",
    citySourceName: "City of Hampton Official Calendars",
    url: feedUrl("https://www.hampton.gov", 59),
    enabled: true,
  },
  {
    feedId: "hampton_sandy_bottom",
    category: "Sandy Bottom Nature Park",
    citySourceId: "hampton_official",
    city: "Hampton",
    citySourceName: "City of Hampton Official Calendars",
    url: feedUrl("https://www.hampton.gov", 58),
    enabled: true,
  },
  {
    feedId: "hampton_air_space",
    category: "Virginia Air & Space Science Center",
    citySourceId: "hampton_official",
    city: "Hampton",
    citySourceName: "City of Hampton Official Calendars",
    url: feedUrl("https://www.hampton.gov", 62),
    enabled: true,
  },
  {
    feedId: "newport_news_community",
    category: "Community Outreach",
    citySourceId: "newport_news_official",
    city: "Newport News",
    citySourceName: "City of Newport News Official Calendars",
    url: feedUrl("https://www.nnva.gov", 49),
    enabled: true,
  },
  {
    feedId: "newport_news_festivals",
    category: "Events & Festivals",
    citySourceId: "newport_news_official",
    city: "Newport News",
    citySourceName: "City of Newport News Official Calendars",
    url: feedUrl("https://www.nnva.gov", 35),
    enabled: true,
  },
  {
    feedId: "suffolk_main",
    category: "Main Calendar",
    citySourceId: "suffolk_official",
    city: "Suffolk",
    citySourceName: "City of Suffolk Official Calendars",
    url: feedUrl("https://www.suffolkva.us", 14),
    enabled: true,
  },
  {
    feedId: "suffolk_parks_recreation",
    category: "Parks & Recreation",
    citySourceId: "suffolk_official",
    city: "Suffolk",
    citySourceName: "City of Suffolk Official Calendars",
    url: feedUrl("https://www.suffolkva.us", 56),
    enabled: true,
  },
  {
    feedId: "suffolk_art_gallery",
    category: "Suffolk Art Gallery",
    citySourceId: "suffolk_official",
    city: "Suffolk",
    citySourceName: "City of Suffolk Official Calendars",
    url: feedUrl("https://www.suffolkva.us", 44),
    enabled: true,
  },
  {
    feedId: "suffolk_parks_department",
    category: "Suffolk Parks & Recreation Department",
    citySourceId: "suffolk_official",
    city: "Suffolk",
    citySourceName: "City of Suffolk Official Calendars",
    url: feedUrl("https://www.suffolkva.us", 33),
    enabled: true,
  },
];

function sourceForFeed(feed: CivicPlusCalendarFeed): CityCalendarSource {
  return {
    id: feed.citySourceId,
    name: feed.citySourceName,
    city: feed.city,
    url: feed.url,
    format: "ics",
    enabled: feed.enabled,
    timeZone: EASTERN_TIME_ZONE,
  };
}

async function wait(milliseconds: number) {
  await new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function wait(milliseconds: number) {
  await new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function fetchCalendarText(feed: CivicPlusCalendarFeed) {
  const failures: string[] = [];
  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(feed.url, {
        cache: "no-store",
        headers: {
          Accept: "text/calendar,text/plain;q=0.9,*/*;q=0.5",
          "User-Agent": "Buzz/1.0 (https://lit757.vercel.app; demetriusvharvey@gmail.com)",
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`Official calendar request failed (${response.status})`);
      const calendarText = await response.text();
      if (!calendarText.includes("BEGIN:VCALENDAR") && !calendarText.includes("BEGIN:VEVENT")) {
        throw new Error("Official calendar did not return iCalendar content");
      }
      return calendarText;
    } catch (error) {
      failures.push(error instanceof Error ? error.message : "Calendar request failed");
      if (attempt < FETCH_ATTEMPTS) await wait(500 * attempt);
    }
  }
  throw new Error(`Official calendar failed after ${FETCH_ATTEMPTS} attempts: ${failures.join(" | ")}`);
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

export function dedupeCivicPlusEvents(events: NormalizedCityEvent[]) {
  return [...new Map(events.map(event => [event.source_event_id, event])).values()];
}

export async function fetchCivicPlusFeed(feed: CivicPlusCalendarFeed): Promise<CivicPlusFeedResult> {
  const fetchedAt = new Date().toISOString();
  try {
    const text = await fetchCalendarText(feed);
    const events = parseCityCalendarIcs(text, sourceForFeed(feed));
    return { feed, status: "ok", events, error: null, fetchedAt };
  } catch (error) {
    return {
      feed,
      status: "error",
      events: [],
      error: error instanceof Error ? error.message : "Unknown calendar error",
      fetchedAt,
    };
  }
}

export function groupCivicPlusFeedsByOrigin(feeds: CivicPlusCalendarFeed[]) {
  const groups = new Map<string, CivicPlusCalendarFeed[]>();
  for (const feed of feeds) {
    const origin = new URL(feed.url).origin;
    groups.set(origin, [...(groups.get(origin) || []), feed]);
  }
  return [...groups.values()];
}

async function fetchFeedGroup(feeds: CivicPlusCalendarFeed[]) {
  const results: CivicPlusFeedResult[] = [];
  let consecutiveFailures = 0;
  for (let index = 0; index < feeds.length; index += 1) {
    const result = await fetchCivicPlusFeed(feeds[index]);
    results.push(result);
    consecutiveFailures = result.status === "error" ? consecutiveFailures + 1 : 0;
    if (consecutiveFailures >= 2) {
      for (const skipped of feeds.slice(index + 1)) {
        results.push({
          feed: skipped,
          status: "error",
          events: [],
          error: "Skipped after repeated failures from the same official calendar host",
          fetchedAt: new Date().toISOString(),
        });
      }
      break;
    }
    if (index < feeds.length - 1) await wait(BETWEEN_FEEDS_MS);
  }
  return results;
}

export async function fetchAllCivicPlusCalendars(
  feeds = CIVICPLUS_CALENDAR_FEEDS.filter(feed => feed.enabled),
) {
  const groups = groupCivicPlusFeedsByOrigin(feeds);
  const results = (await mapLimit(groups, HOST_CONCURRENCY, fetchFeedGroup)).flat();
  const events = dedupeCivicPlusEvents(results.flatMap(result => result.events));
  return {
    generatedAt: new Date().toISOString(),
    results,
    events,
    summary: {
      registeredFeeds: feeds.length,
      successfulFeeds: results.filter(result => result.status === "ok").length,
      failedFeeds: results.filter(result => result.status === "error").length,
      rawEvents: results.reduce((sum, result) => sum + result.events.length, 0),
      dedupedEvents: events.length,
    },
  };
}
