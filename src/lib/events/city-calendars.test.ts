import assert from "node:assert/strict";
import test from "node:test";
import {
  CITY_CALENDAR_SOURCES,
  cityEventFingerprint,
  parseCityCalendarIcs,
} from "./city-calendars";

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

test("parser normalizes an ICS event", () => {
  const source = CITY_CALENDAR_SOURCES[0];
  const events = parseCityCalendarIcs(`BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:vb-123\nSUMMARY:Oceanfront Concert\nDESCRIPTION:Free live music\nDTSTART:20260725T230000Z\nDTEND:20260726T010000Z\nLOCATION:17th Street Park, Virginia Beach, VA\nURL:https://example.com/event\nEND:VEVENT\nEND:VCALENDAR`, source);

  assert.equal(events.length, 1);
  assert.equal(events[0].name, "Oceanfront Concert");
  assert.equal(events[0].city, "Virginia Beach");
  assert.equal(events[0].venue_name, "17th Street Park, Virginia Beach, VA");
  assert.equal(events[0].source, "virginia_beach_official");
  assert.equal(events[0].source_url, "https://example.com/event");
});

test("fingerprint prefers external id and has deterministic fallback", () => {
  const externalA = cityEventFingerprint("vb", "123", "Title", "2026-07-25T23:00:00.000Z", "Park");
  const externalB = cityEventFingerprint("vb", "123", "Changed title", "2026-07-26T00:00:00.000Z", "Other");
  assert.equal(externalA, externalB);

  const fallbackA = cityEventFingerprint("vb", null, "Title", "2026-07-25T23:00:00.000Z", "Park");
  const fallbackB = cityEventFingerprint("vb", null, "Title", "2026-07-25T23:00:00.000Z", "Park");
  assert.equal(fallbackA, fallbackB);
});
