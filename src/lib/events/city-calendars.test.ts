import assert from "node:assert/strict";
import test from "node:test";
import {
  CITY_CALENDAR_SOURCES,
  cityEventFingerprint,
  extractEventDetailLinks,
  parseCityCalendarIcs,
  parseCityCalendarJsonLd,
  type CityCalendarSource,
} from "./city-calendars";

const icsSource: CityCalendarSource = {
  id: "test_ics",
  name: "Test ICS",
  city: "Virginia Beach",
  url: "https://example.com/events.ics",
  format: "ics",
  enabled: true,
};

test("registry includes all seven Hampton Roads cities", () => {
  const cities = new Set(CITY_CALENDAR_SOURCES.map(source => source.city));
  assert.deepEqual(cities, new Set([
    "Virginia Beach",
    "Norfolk",
    "Chesapeake",
    "Portsmouth",
    "Hampton",
    "Newport News",
    "Suffolk",
  ]));
});

test("Virginia Beach uses the official tourism calendar HTML provider", () => {
  const source = CITY_CALENDAR_SOURCES.find(candidate => candidate.city === "Virginia Beach");
  assert.equal(source?.format, "html-jsonld");
  assert.equal(source?.enabled, true);
  assert.equal(source?.url, "https://www.visitvirginiabeach.com/events/");
});

test("parser normalizes an ICS event", () => {
  const events = parseCityCalendarIcs(`BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:vb-123\nSUMMARY:Oceanfront Concert\nDESCRIPTION:Free live music\nDTSTART:20260725T230000Z\nDTEND:20260726T010000Z\nLOCATION:17th Street Park, Virginia Beach, VA\nURL:https://example.com/event\nEND:VEVENT\nEND:VCALENDAR`, icsSource);

  assert.equal(events.length, 1);
  assert.equal(events[0].name, "Oceanfront Concert");
  assert.equal(events[0].city, "Virginia Beach");
  assert.equal(events[0].venue_name, "17th Street Park, Virginia Beach, VA");
  assert.equal(events[0].source, "test_ics");
  assert.equal(events[0].source_url, "https://example.com/event");
});

test("JSON-LD parser normalizes Visit Virginia Beach event metadata", () => {
  const source = CITY_CALENDAR_SOURCES[0];
  const html = `<script type="application/ld+json">{
    "@context": "https://schema.org",
    "@type": "Event",
    "name": "Oceanfront Concert",
    "description": "<p>Free &amp; live music</p>",
    "startDate": "2026-07-25T19:00:00-04:00",
    "endDate": "2026-07-25T21:00:00-04:00",
    "url": "https://www.visitvirginiabeach.com/event/oceanfront-concert/12345/",
    "image": ["https://example.com/concert.jpg"],
    "location": {
      "@type": "Place",
      "name": "17th Street Park",
      "address": {
        "streetAddress": "1700 Atlantic Ave",
        "addressLocality": "Virginia Beach",
        "addressRegion": "VA",
        "postalCode": "23451"
      },
      "geo": { "latitude": 36.85, "longitude": -75.98 }
    }
  }</script>`;

  const events = parseCityCalendarJsonLd(html, source);
  assert.equal(events.length, 1);
  assert.equal(events[0].name, "Oceanfront Concert");
  assert.equal(events[0].description, "Free & live music");
  assert.equal(events[0].venue_name, "17th Street Park");
  assert.equal(events[0].address, "1700 Atlantic Ave, Virginia Beach, VA, 23451");
  assert.equal(events[0].latitude, 36.85);
  assert.equal(events[0].longitude, -75.98);
  assert.equal(events[0].image_url, "https://example.com/concert.jpg");
});

test("event detail link discovery keeps only official event pages", () => {
  const source = CITY_CALENDAR_SOURCES[0];
  const links = extractEventDetailLinks(`
    <a href="/event/oceanfront-concert/12345/">Concert</a>
    <a href="https://www.visitvirginiabeach.com/event/other-event/67890/?tracking=1">Other</a>
    <a href="https://example.com/event/not-official/999/">External</a>
  `, source);

  assert.deepEqual(links, [
    "https://www.visitvirginiabeach.com/event/oceanfront-concert/12345/",
    "https://www.visitvirginiabeach.com/event/other-event/67890/",
  ]);
});

test("fingerprint prefers external id and has deterministic fallback", () => {
  const externalA = cityEventFingerprint("vb", "123", "Title", "2026-07-25T23:00:00.000Z", "Park");
  const externalB = cityEventFingerprint("vb", "123", "Changed title", "2026-07-26T00:00:00.000Z", "Other");
  assert.equal(externalA, externalB);

  const fallbackA = cityEventFingerprint("vb", null, "Title", "2026-07-25T23:00:00.000Z", "Park");
  const fallbackB = cityEventFingerprint("vb", null, "Title", "2026-07-25T23:00:00.000Z", "Park");
  assert.equal(fallbackA, fallbackB);
});
