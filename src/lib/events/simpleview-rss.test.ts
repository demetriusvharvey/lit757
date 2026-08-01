import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchSimpleviewRssCalendar,
  parseSimpleviewEventDetail,
  parseSimpleviewRestEvents,
  parseSimpleviewRssItems,
} from "./simpleview-rss";

const source = {
  id: "visit_newport_news_official",
  name: "Visit Newport News Events",
  city: "Newport News",
  url: "https://www.visitnewportnews.com/event/rss/",
  apiOrigin: "https://newportnewsva.simpleviewcms.com/",
};

const SIMPLEVIEW_EVENTS_PATH_FOR_TEST = "/includes/rest_v2/plugins_events_events_by_date/find/";

const rss = `<?xml version="1.0"?><rss version="2.0"><channel>
  <item>
    <title>Live Music - Zen Mojo</title>
    <link>https://www.visitnewportnews.com/event/live-music-zen-mojo/1911/</link>
    <guid ispermalink="false">event-1911</guid>
    <category><![CDATA[ Music ]]></category>
    <category><![CDATA[ Food &amp; Drink ]]></category>
    <description><![CDATA[
      <img src="https://assets.example/mojo.png"/>
      07/22/2026 to 07/22/2026 - <p>Good food, drinks, and live music.</p>
    ]]></description>
  </item>
</channel></rss>`;

const detail = `<html><script type="application/ld+json">{
  "@context":"http://schema.org",
  "@type":"MusicEvent",
  "name":"Live Music - Zen Mojo",
  "startDate":"2026-07-22",
  "endDate":"2026-07-22",
  "image":"https://assets.example/mojo-large.png",
  "url":"https://www.visitnewportnews.com/event/live-music-zen-mojo/1911/",
  "description":"Good food, drinks, and live music.",
  "location":{
    "@type":"Place",
    "name":"Juan's Mexican Café & Cantina",
    "address":{
      "@type":"PostalAddress",
      "addressLocality":"Newport News",
      "addressRegion":"VA",
      "postalCode":"23602",
      "streetAddress":"561 Bland Blvd."
    },
    "geo":{"@type":"GeoCoordinates","latitude":37.12713,"longitude":-76.51484}
  }
}</script></html>`;

const restResponse = {
  docs: {
    count: 1,
    docs: [{
      _id: "rest-event-id",
      recid: "1925",
      date: "2026-07-23T03:59:59.000Z",
      startTime: "19:30:00",
      endTime: "21:00:00",
      title: "Summer Concert & Fireworks",
      description: "<p>Live music on the lawn.</p>",
      location: "Victory Landing Park",
      address1: "50 25th Street",
      city: "Newport News",
      state: "VA",
      zip: "23607",
      loc: { type: "Point", coordinates: [-76.4282, 36.9788] },
      media_raw: [{ mediaurl: "https://assets.example/concert.jpg" }],
    }],
  },
};

test("parses official RSS items with categories, images, and date ranges", () => {
  const items = parseSimpleviewRssItems(rss);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "Live Music - Zen Mojo");
  assert.deepEqual(items[0].categories, ["Music", "Food & Drink"]);
  assert.equal(items[0].imageUrl, "https://assets.example/mojo.png");
  assert.equal(items[0].startDate, "2026-07-22");
  assert.equal(items[0].endDate, "2026-07-22");
});

test("accepts legitimate Schema.org Event subtypes and preserves venue geography", () => {
  const events = parseSimpleviewEventDetail(detail, source, "https://fallback.example/event");
  assert.equal(events.length, 1);
  assert.equal(events[0].name, "Live Music - Zen Mojo");
  assert.equal(events[0].venue_name, "Juan's Mexican Café & Cantina");
  assert.equal(events[0].address, "561 Bland Blvd., Newport News, VA, 23602");
  assert.equal(events[0].latitude, 37.12713);
  assert.equal(events[0].longitude, -76.51484);
  assert.equal(events[0].start_time, "2026-07-22T12:00:00-04:00");
  assert.equal(events[0].end_time, "2026-07-22T23:59:59-04:00");
});

test("normalizes the official Simpleview REST calendar response", () => {
  const events = parseSimpleviewRestEvents(restResponse, source);
  assert.equal(events.length, 1);
  assert.equal(events[0].name, "Summer Concert & Fireworks");
  assert.equal(events[0].venue_name, "Victory Landing Park");
  assert.equal(events[0].address, "50 25th Street, Newport News, VA, 23607");
  assert.equal(events[0].start_time, "2026-07-22T19:30:00-04:00");
  assert.equal(events[0].end_time, "2026-07-22T21:00:00-04:00");
  assert.equal(events[0].longitude, -76.4282);
  assert.equal(events[0].latitude, 36.9788);
  assert.equal(events[0].image_url, "https://assets.example/concert.jpg");
  assert.equal(events[0].source_url, "https://www.visitnewportnews.com/event/summer-concert-fireworks/1925/");
});

test("fetches RSS discovery and enriches every item from its official detail page", async () => {
  const originalFetch = global.fetch;
  global.fetch = async input => {
    const url = String(input);
    return new Response(url.endsWith("/event/rss/") ? rss : detail, {
      status: 200,
      headers: { "Content-Type": url.endsWith("/event/rss/") ? "application/rss+xml" : "text/html" },
    });
  };
  try {
    const events = await fetchSimpleviewRssCalendar(
      source,
      undefined,
      new Date("2026-07-22T12:00:00.000Z"),
    );
    assert.equal(events.length, 1);
    assert.equal(events[0].source, "visit_newport_news_official");
    assert.equal(events[0].source_url, "https://www.visitnewportnews.com/event/live-music-zen-mojo/1911/");
  } finally {
    global.fetch = originalFetch;
  }
});

test("falls back to the official Simpleview REST calendar when RSS is blocked", async () => {
  const originalFetch = global.fetch;
  const requestedUrls: string[] = [];
  global.fetch = async input => {
    const url = String(input);
    requestedUrls.push(url);
    if (url.endsWith("/event/rss/")) return new Response("Forbidden", { status: 403 });
    if (url.endsWith("/plugins/core/get_simple_token/")) return new Response("public-calendar-token", { status: 200 });
    if (url.includes("/includes/rest_v2/plugins_events_events_by_date/find/")) {
      return Response.json(restResponse);
    }
    return new Response("Not found", { status: 404 });
  };
  try {
    const events = await fetchSimpleviewRssCalendar(
      source,
      undefined,
      new Date("2026-07-22T20:00:00.000Z"),
    );
    assert.equal(events.length, 1);
    const tokenUrl = requestedUrls.find(url => url.endsWith("/plugins/core/get_simple_token/"));
    assert.ok(tokenUrl);
    assert.equal(new URL(tokenUrl).hostname, "newportnewsva.simpleviewcms.com");
    const restUrl = requestedUrls.find(url => url.includes(SIMPLEVIEW_EVENTS_PATH_FOR_TEST));
    assert.ok(restUrl);
    assert.equal(new URL(restUrl).hostname, "newportnewsva.simpleviewcms.com");
    assert.equal(new URL(restUrl).searchParams.get("token"), "public-calendar-token");
    const query = JSON.parse(new URL(restUrl).searchParams.get("json") || "null");
    assert.deepEqual(query.filter, { active: true });
  } finally {
    global.fetch = originalFetch;
  }
});
