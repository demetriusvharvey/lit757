import assert from "node:assert/strict";
import test from "node:test";
import {
  CIVICPLUS_CALENDAR_FEEDS,
  dedupeCivicPlusEvents,
} from "./civicplus-calendars";
import {
  parseCityCalendarIcs,
  type CityCalendarSource,
  type NormalizedCityEvent,
} from "./city-calendars";

const expectedCities = new Set([
  "Norfolk",
  "Chesapeake",
  "Portsmouth",
  "Hampton",
  "Newport News",
  "Suffolk",
]);

test("remaining official calendar registry covers all six Hampton Roads cities", () => {
  assert.deepEqual(new Set(CIVICPLUS_CALENDAR_FEEDS.map(feed => feed.city)), expectedCities);
  assert.ok(CIVICPLUS_CALENDAR_FEEDS.every(feed => feed.enabled));
});

test("every CivicPlus source is an official HTTPS iCalendar feed", () => {
  for (const feed of CIVICPLUS_CALENDAR_FEEDS) {
    const url = new URL(feed.url);
    assert.equal(url.protocol, "https:");
    assert.match(url.pathname, /common\/modules\/iCalendar\/iCalendar\.aspx/i);
    assert.ok(url.searchParams.get("catID"));
    assert.equal(url.searchParams.get("feed"), "calendar");
  }
});

test("categories in the same city share a source identity for cross-category deduplication", () => {
  for (const city of expectedCities) {
    const identities = new Set(
      CIVICPLUS_CALENDAR_FEEDS
        .filter(feed => feed.city === city)
        .map(feed => feed.citySourceId),
    );
    assert.equal(identities.size, 1, `${city} should use one source identity`);
  }
});

test("shared event UIDs dedupe across category feeds", () => {
  const source: CityCalendarSource = {
    id: "norfolk_official",
    name: "City of Norfolk Official Calendars",
    city: "Norfolk",
    url: "https://www.norfolk.gov/common/modules/iCalendar/iCalendar.aspx?catID=24&feed=calendar",
    format: "ics",
    enabled: true,
    timeZone: "America/New_York",
  };
  const sample = `BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:shared-norfolk-event\nSUMMARY:Downtown Festival\nDTSTART;TZID=America/New_York:20260801T180000\nDTEND;TZID=America/New_York:20260801T220000\nLOCATION:Town Point Park\nURL:https://www.norfolk.gov/Calendar.aspx?EID=123\nEND:VEVENT\nEND:VCALENDAR`;
  const first = parseCityCalendarIcs(sample, source);
  const second = parseCityCalendarIcs(sample, { ...source, url: source.url.replace("24", "75") });
  const deduped = dedupeCivicPlusEvents([...first, ...second]);
  assert.equal(first.length, 1);
  assert.equal(second.length, 1);
  assert.equal(deduped.length, 1);
});

test("dedupe keeps distinct events", () => {
  const base: NormalizedCityEvent = {
    source_event_id: "norfolk_official_a",
    name: "Festival A",
    description: null,
    venue_name: "Town Point Park",
    address: null,
    city: "Norfolk",
    latitude: null,
    longitude: null,
    start_time: "2026-08-01T22:00:00.000Z",
    end_time: null,
    source: "norfolk_official",
    source_name: "City of Norfolk Official Calendars",
    source_url: null,
    image_url: null,
    ticket_status: null,
  };
  const deduped = dedupeCivicPlusEvents([
    base,
    { ...base },
    { ...base, source_event_id: "norfolk_official_b", name: "Festival B" },
  ]);
  assert.equal(deduped.length, 2);
});
