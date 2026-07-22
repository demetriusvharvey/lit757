import { mkdir, writeFile } from "node:fs/promises";

const outputDir = "tourism-source-probe";
await mkdir(outputDir, { recursive: true });

const sources = [
  {
    id: "visit_virginia_beach",
    page: "https://www.visitvirginiabeach.com/events/",
    candidates: [
      "https://www.visitvirginiabeach.com/events/",
      "https://www.visitvirginiabeach.com/event/rss/",
      "https://www.visitvirginiabeach.com/events/rss/",
      "https://www.visitvirginiabeach.com/includes/rest_v2/plugins_events_events/find/?skip=0&take=5&sort=date",
      "https://www.visitvirginiabeach.com/includes/rest_v2/plugins_events_events/find/?skip=0&take=5&sort=rank",
      "https://www.visitvirginiabeach.com/wp-json/tribe/events/v1/events?per_page=5",
      "https://www.visitvirginiabeach.com/wp-json/wp/v2/tribe_events?per_page=5",
    ],
  },
  {
    id: "visit_newport_news",
    page: "https://www.visitnewportnews.com/events-and-festivals/",
    candidates: [
      "https://www.visitnewportnews.com/events-and-festivals/",
      "https://www.visitnewportnews.com/event/rss/",
      "https://www.visitnewportnews.com/events/rss/",
      "https://www.visitnewportnews.com/wp-json/tribe/events/v1/events?per_page=5",
      "https://www.visitnewportnews.com/wp-json/wp/v2/tribe_events?per_page=5",
      "https://www.visitnewportnews.com/includes/rest_v2/plugins_events_events/find/?skip=0&take=5&sort=date",
      "https://www.visitnewportnews.com/includes/rest_v2/plugins_events_events/find/?skip=0&take=5&sort=rank",
    ],
  },
];

function markerSummary(body) {
  const markers = [
    "rest_v2",
    "plugins_events_events",
    "tribe/events",
    "tribe_events",
    "application/ld+json",
    '"@type":"Event"',
    '"@type": "Event"',
    "__NEXT_DATA__",
    "eventsData",
    "event-list",
    "<rss",
    "<item",
    "/event/",
    "/events/",
  ];
  return Object.fromEntries(markers.map(marker => [marker, body.toLowerCase().includes(marker.toLowerCase())]));
}

function links(body, origin) {
  const found = [];
  for (const match of body.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    try {
      const url = new URL(match[1], origin);
      if (url.origin !== new URL(origin).origin) continue;
      if (!/event|festival|calendar/i.test(url.pathname)) continue;
      url.hash = "";
      found.push(url.toString());
    } catch {
      // Ignore malformed links.
    }
  }
  return [...new Set(found)].slice(0, 80);
}

async function probe(url) {
  const started = Date.now();
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(45_000),
      headers: {
        "User-Agent": "BuzzOfficialTourismProbe/1.0",
        Accept: "application/rss+xml,application/xml,text/xml,application/json,text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
      },
    });
    const body = await response.text();
    let parsed = null;
    try { parsed = JSON.parse(body); } catch { /* not JSON */ }
    return {
      requestedUrl: url,
      finalUrl: response.url,
      status: response.status,
      ok: response.ok,
      contentType: response.headers.get("content-type"),
      length: body.length,
      durationMs: Date.now() - started,
      markers: markerSummary(body),
      sameOriginEventLinks: links(body, response.url),
      rssItemCount: [...body.matchAll(/<item\b/gi)].length,
      jsonShape: parsed == null ? null : {
        array: Array.isArray(parsed),
        keys: Array.isArray(parsed) ? [] : Object.keys(parsed || {}).slice(0, 30),
        arrayLength: Array.isArray(parsed) ? parsed.length : null,
        eventsLength: Array.isArray(parsed?.events) ? parsed.events.length : null,
      },
      preview: body.slice(0, 2500),
      body,
    };
  } catch (error) {
    return {
      requestedUrl: url,
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - started,
    };
  }
}

const report = { generatedAt: new Date().toISOString(), sources: [] };
for (const source of sources) {
  const sourceReport = { id: source.id, page: source.page, probes: [] };
  for (const url of source.candidates) {
    const result = await probe(url);
    sourceReport.probes.push({ ...result, body: undefined });
    if (result.body) {
      const safe = Buffer.from(url).toString("base64url").slice(0, 80);
      await writeFile(`${outputDir}/${source.id}-${safe}.txt`, result.body.slice(0, 1_500_000));
    }
    console.log(JSON.stringify({
      source: source.id,
      url,
      status: result.status,
      contentType: result.contentType,
      length: result.length,
      rssItemCount: result.rssItemCount,
      jsonShape: result.jsonShape,
      markers: result.markers,
      eventLinks: result.sameOriginEventLinks?.slice(0, 10),
      error: result.error,
    }, null, 2));
  }
  report.sources.push(sourceReport);
}

await writeFile(`${outputDir}/report.json`, JSON.stringify(report, null, 2));
