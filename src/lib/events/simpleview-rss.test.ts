import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchSimpleviewRssCalendar,
  parseSimpleviewEventDetail,
  parseSimpleviewRssItems,
} from "./simpleview-rss";

const source = {
  id: "visit_newport_news_official",
  name: "Visit Newport News Events",
  city: "Newport News",
  url: "https://www.visitnewportnews.com/event/rss/",
};

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
