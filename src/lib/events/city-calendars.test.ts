import assert from "node:assert/strict";
import test from "node:test";
import {
  CITY_CALENDAR_SOURCES,
  cityEventFingerprint,
  extractEventDetailLinks,
  parseCityCalendarIcs,
  parseCityCalendarJsonLd,
  parseVirginiaBeachEventDetail,
  parseVirginiaBeachEventListing,
  type CityCalendarSource,
} from "./city-calendars";

const icsSource: CityCalendarSource = {
  id: "test_ics",
  name: "Test ICS",
  city: "Virginia Beach",
  url: "https://example.com/events.ics",
  format: "ics",
  enabled: true,
  timeZone: "America/New_York",
};

const jsonLdSource: CityCalendarSource = {
  id: "test_jsonld",
  name: "Test JSON-LD",
  city: "Virginia Beach",
  url: "https://www.visitvirginiabeach.com/events/",
  format: "html-jsonld",
  enabled: true,
  timeZone: "America/New_York",
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

test("Virginia Beach uses the official city calendar provider", () => {
  const source = CITY_CALENDAR_SOURCES.find(candidate => candidate.city === "Virginia Beach");
  assert.equal(source?.format, "vb-city-html");
  assert.equal(source?.enabled, true);
  assert.equal(source?.url, "https://virginiabeach.gov/connect/events");
  assert.ok((source?.maxDetailPages || 0) <= 18);
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

test("ICS parser respects TZID instead of using the server timezone", () => {
  const events = parseCityCalendarIcs(`BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:vb-tzid\nSUMMARY:Evening Show\nDTSTART;TZID=America/New_York:20260725T190000\nDTEND;TZID=America/New_York:20260725T210000\nLOCATION:Oceanfront Park\nEND:VEVENT\nEND:VCALENDAR`, icsSource);

  assert.equal(events.length, 1);
  assert.equal(events[0].start_time, "2026-07-25T23:00:00.000Z");
  assert.equal(events[0].end_time, "2026-07-26T01:00:00.000Z");
});

test("ICS parser stores all-day dates at local midnight", () => {
  const events = parseCityCalendarIcs(`BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:vb-all-day\nSUMMARY:All-day Festival\nDTSTART;VALUE=DATE:20260725\nDTEND;VALUE=DATE:20260726\nLOCATION:Oceanfront\nEND:VEVENT\nEND:VCALENDAR`, icsSource);

  assert.equal(events.length, 1);
  assert.equal(events[0].start_time, "2026-07-25T04:00:00.000Z");
  assert.equal(events[0].end_time, "2026-07-26T04:00:00.000Z");
});

test("recurring ICS occurrences receive distinct source event ids", () => {
  const events = parseCityCalendarIcs(`BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:weekly-show\nRECURRENCE-ID;TZID=America/New_York:20260725T190000\nSUMMARY:Weekly Show\nDTSTART;TZID=America/New_York:20260725T190000\nLOCATION:Town Center\nEND:VEVENT\nBEGIN:VEVENT\nUID:weekly-show\nRECURRENCE-ID;TZID=America/New_York:20260801T190000\nSUMMARY:Weekly Show\nDTSTART;TZID=America/New_York:20260801T190000\nLOCATION:Town Center\nEND:VEVENT\nEND:VCALENDAR`, icsSource);

  assert.equal(events.length, 2);
  assert.notEqual(events[0].source_event_id, events[1].source_event_id);
});

test("RRULE series expand and respect EXDATE exclusions", () => {
  const events = parseCityCalendarIcs(`BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:weekly-series\nSUMMARY:Weekly Series\nDTSTART;TZID=America/New_York:20260725T190000\nDTEND;TZID=America/New_York:20260725T210000\nRRULE:FREQ=WEEKLY;COUNT=3\nEXDATE;TZID=America/New_York:20260801T190000\nLOCATION:Town Center\nEND:VEVENT\nEND:VCALENDAR`, icsSource);

  assert.equal(events.length, 2);
  assert.deepEqual(events.map(event => event.start_time), [
    "2026-07-25T23:00:00.000Z",
    "2026-08-08T23:00:00.000Z",
  ]);
  assert.notEqual(events[0].source_event_id, events[1].source_event_id);
});

test("daily RRULE honors BYDAY and counts only matching dates", () => {
  const events = parseCityCalendarIcs(`BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:weekday-program\nSUMMARY:Weekday Program\nDTSTART;TZID=America/New_York:20260727T190000\nDTEND;TZID=America/New_York:20260727T200000\nRRULE:FREQ=DAILY;COUNT=4;BYDAY=MO,WE,FR\nLOCATION:Community Center\nEND:VEVENT\nEND:VCALENDAR`, icsSource);

  assert.deepEqual(events.map(event => event.start_time), [
    "2026-07-27T23:00:00.000Z",
    "2026-07-29T23:00:00.000Z",
    "2026-07-31T23:00:00.000Z",
    "2026-08-03T23:00:00.000Z",
  ]);
});

test("long COUNT series retain current occurrences beyond the old cap", () => {
  const events = parseCityCalendarIcs(`BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:long-daily-series\nSUMMARY:Daily Community Program\nDTSTART;TZID=America/New_York:20200101T190000\nDTEND;TZID=America/New_York:20200101T200000\nRRULE:FREQ=DAILY;COUNT=10000\nLOCATION:Community Center\nEND:VEVENT\nEND:VCALENDAR`, icsSource);

  assert.ok(events.length > 0);
  assert.ok(events.length <= 2000);
  assert.ok(events.every(event => new Date(event.start_time).getTime() >= Date.now() - 2 * 24 * 60 * 60 * 1000));
});

test("detached cancellation removes its master occurrence and emits a deletion marker", () => {
  const events = parseCityCalendarIcs(`BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:cancellable-series\nSUMMARY:Neighborhood Meeting\nDTSTART;TZID=America/New_York:20260725T190000\nDTEND;TZID=America/New_York:20260725T200000\nRRULE:FREQ=WEEKLY;COUNT=2\nLOCATION:Community Center\nEND:VEVENT\nBEGIN:VEVENT\nUID:cancellable-series\nRECURRENCE-ID;TZID=America/New_York:20260801T190000\nSTATUS:CANCELLED\nSUMMARY:Neighborhood Meeting\nDTSTART;TZID=America/New_York:20260801T190000\nLOCATION:Community Center\nEND:VEVENT\nEND:VCALENDAR`, icsSource);

  const active = events.filter(event => !event.cancelled);
  const cancelled = events.filter(event => event.cancelled);
  assert.equal(active.length, 1);
  assert.equal(active[0].start_time, "2026-07-25T23:00:00.000Z");
  assert.equal(cancelled.length, 1);
  assert.equal(cancelled[0].start_time, "2026-08-01T23:00:00.000Z");
  assert.equal(cancelled[0].ticket_status, "cancelled");
  assert.notEqual(active[0].source_event_id, cancelled[0].source_event_id);
});

test("cancelled recurring master emits deletion markers for every occurrence", () => {
  const events = parseCityCalendarIcs(`BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:cancelled-master\nSTATUS:CANCELLED\nSUMMARY:Cancelled Series\nDTSTART;TZID=America/New_York:20260725T190000\nDTEND;TZID=America/New_York:20260725T200000\nRRULE:FREQ=WEEKLY;COUNT=2\nLOCATION:Community Center\nEND:VEVENT\nEND:VCALENDAR`, icsSource);

  assert.equal(events.length, 2);
  assert.ok(events.every(event => event.cancelled));
  assert.ok(events.every(event => event.ticket_status === "cancelled"));
  assert.deepEqual(events.map(event => event.start_time), [
    "2026-07-25T23:00:00.000Z",
    "2026-08-01T23:00:00.000Z",
  ]);
});

test("JSON-LD parser remains available for future tourism and venue sources", () => {
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

  const events = parseCityCalendarJsonLd(html, jsonLdSource);
  assert.equal(events.length, 1);
  assert.equal(events[0].name, "Oceanfront Concert");
  assert.equal(events[0].description, "Free & live music");
  assert.equal(events[0].venue_name, "17th Street Park");
  assert.equal(events[0].address, "1700 Atlantic Ave, Virginia Beach, VA, 23451");
  assert.equal(events[0].latitude, 36.85);
  assert.equal(events[0].longitude, -75.98);
  assert.equal(events[0].image_url, "https://example.com/concert.jpg");
});

test("generic event detail discovery stays scoped to its configured host", () => {
  const links = extractEventDetailLinks(`
    <a href="/event/oceanfront-concert/12345/">Concert</a>
    <a href="https://www.visitvirginiabeach.com/event/other-event/67890/?tracking=1">Other</a>
    <a href="https://example.com/event/not-official/999/">External</a>
  `, jsonLdSource);

  assert.deepEqual(links, [
    "https://www.visitvirginiabeach.com/event/oceanfront-concert/12345/",
    "https://www.visitvirginiabeach.com/event/other-event/67890/",
  ]);
});

test("Virginia Beach listing parser finds only dated official event links", () => {
  const source = CITY_CALENDAR_SOURCES[0];
  const events = parseVirginiaBeachEventListing(`
    <a href="/connect/events/community-meeting/2026-07-29">Community Meeting</a>
    <a href="https://virginiabeach.gov/connect/events/live-music/2026-08-01">Live Music</a>
    <a href="/connect/events">All Events</a>
    <a href="https://example.com/connect/events/external/2026-08-02">External</a>
  `, source);

  assert.deepEqual(events, [
    {
      name: "Community Meeting",
      date: "2026-07-29",
      url: "https://virginiabeach.gov/connect/events/community-meeting/2026-07-29",
    },
    {
      name: "Live Music",
      date: "2026-08-01",
      url: "https://virginiabeach.gov/connect/events/live-music/2026-08-01",
    },
  ]);
});

test("Virginia Beach detail parser normalizes time, venue, address and description", () => {
  const source = CITY_CALENDAR_SOURCES[0];
  const listing = {
    name: "Community Meeting",
    date: "2026-07-29",
    url: "https://virginiabeach.gov/connect/events/community-meeting/2026-07-29",
  };
  const event = parseVirginiaBeachEventDetail(`
    <h1>Community Meeting</h1>
    <h3>Date &amp; Time</h3>
    <div>Wednesday, July 29, 2026<br>6:00p.m. - 7:30p.m.</div>
    <h3>Location</h3>
    <div>Convention and Visitors Bureau Office<br>600 22nd St., Suite 200, Virginia Beach, Virginia 23451</div>
    <p><strong>Event Details:</strong></p>
    <p>Open to the public.</p>
    <h3>Event Contact</h3>
  `, listing, source);

  assert.equal(event.name, "Community Meeting");
  assert.equal(event.start_time, "2026-07-29T22:00:00.000Z");
  assert.equal(event.end_time, "2026-07-29T23:30:00.000Z");
  assert.equal(event.venue_name, "Convention and Visitors Bureau Office");
  assert.equal(event.address, "600 22nd St., Suite 200, Virginia Beach, Virginia 23451");
  assert.equal(event.description, "Open to the public.");
  assert.equal(event.source_url, listing.url);
});

test("fingerprint prefers external id and has deterministic fallback", () => {
  const externalA = cityEventFingerprint("vb", "123", "Title", "2026-07-25T23:00:00.000Z", "Park");
  const externalB = cityEventFingerprint("vb", "123", "Changed title", "2026-07-26T00:00:00.000Z", "Other");
  assert.equal(externalA, externalB);

  const fallbackA = cityEventFingerprint("vb", null, "Title", "2026-07-25T23:00:00.000Z", "Park");
  const fallbackB = cityEventFingerprint("vb", null, "Title", "2026-07-25T23:00:00.000Z", "Park");
  assert.equal(fallbackA, fallbackB);
});
