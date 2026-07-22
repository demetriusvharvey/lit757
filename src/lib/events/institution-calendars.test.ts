import assert from "node:assert/strict";
import test from "node:test";
import {
  INSTITUTION_CALENDAR_SOURCES,
  dedupeInstitutionEvents,
  extractInstitutionDetailLinks,
  fetchInstitutionSource,
  institutionEventSignature,
  type InstitutionCalendarSource,
} from "./institution-calendars";
import type { NormalizedCityEvent } from "./city-calendars";

function response(body: unknown, contentType = "application/json") {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": contentType },
  });
}

test("institution registry covers universities, arenas, arts, museums, festivals, attractions, and tourism", () => {
  const kinds = new Set(INSTITUTION_CALENDAR_SOURCES.map(source => source.kind));
  assert.deepEqual(kinds, new Set(["university", "arena", "arts", "museum", "festival", "attraction", "tourism"]));
  assert.ok(INSTITUTION_CALENDAR_SOURCES.every(source => source.enabled));
  assert.ok(INSTITUTION_CALENDAR_SOURCES.every(source => new URL(source.url).protocol === "https:"));
  assert.ok(INSTITUTION_CALENDAR_SOURCES.some(source => (
    source.id === "visit_norfolk_official"
    && source.kind === "tourism"
    && source.format === "embedded-json"
  )));
});

test("Localist provider expands event instances and preserves institution metadata", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => response({
    events: [{ event: {
      id: 42,
      title: "Campus Concert",
      description_text: "Live music on campus",
      localist_url: "https://calendar.example.edu/event/campus_concert",
      location_name: "Ogden Hall",
      address: "100 University Drive",
      geo: { latitude: 37.02, longitude: -76.34 },
      event_instances: [{ event_instance: {
        id: 99,
        start: "2026-08-01T19:00:00-04:00",
        end: "2026-08-01T21:00:00-04:00",
      } }],
    } }],
    page: { total_pages: 1 },
  });
  try {
    const source: InstitutionCalendarSource = {
      id: "test_university",
      name: "Test University",
      kind: "university",
      city: "Hampton",
      url: "https://calendar.example.edu",
      format: "localist-api",
      enabled: true,
    };
    const result = await fetchInstitutionSource(source);
    assert.equal(result.status, "ok");
    assert.equal(result.events.length, 1);
    assert.equal(result.events[0].name, "Campus Concert");
    assert.equal(result.events[0].venue_name, "Ogden Hall");
    assert.equal(result.events[0].start_time, "2026-08-01T23:00:00.000Z");
    assert.equal(result.events[0].latitude, 37.02);
  } finally {
    global.fetch = originalFetch;
  }
});

test("Tribe provider normalizes official WordPress event fields", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => response({
    events: [{
      id: 12,
      title: "<b>Adult Night</b>",
      description: "<p>Evening zoo program</p>",
      start_date: "2026-08-08 17:00:00",
      end_date: "2026-08-08 20:00:00",
      url: "https://zoo.example.org/event/adult-night/",
      cost: "$20",
      image: { url: "https://zoo.example.org/adult-night.jpg" },
      venue: {
        venue: "Example Zoo",
        address: "3500 Granby St",
        city: "Norfolk",
        stateprovince: "VA",
        zip: "23504",
        geo_lat: 36.87,
        geo_lng: -76.28,
      },
    }],
    total_pages: 1,
  });
  try {
    const source: InstitutionCalendarSource = {
      id: "test_zoo",
      name: "Example Zoo Events",
      kind: "attraction",
      city: "Norfolk",
      url: "https://zoo.example.org/events/",
      format: "tribe-api",
      enabled: true,
    };
    const result = await fetchInstitutionSource(source);
    assert.equal(result.status, "ok");
    assert.equal(result.events[0].name, "Adult Night");
    assert.equal(result.events[0].description, "Evening zoo program");
    assert.equal(result.events[0].venue_name, "Example Zoo");
    assert.equal(result.events[0].address, "3500 Granby St, Norfolk, VA, 23504");
    assert.equal(result.events[0].ticket_status, "available");
  } finally {
    global.fetch = originalFetch;
  }
});

test("venue provider discovers same-origin detail pages and parses Event JSON-LD", async () => {
  const originalFetch = global.fetch;
  global.fetch = async input => {
    const url = String(input);
    if (url.endsWith("/events")) {
      return response(`
        <a href="/events/detail/summer-show">Summer Show</a>
        <a href="https://other.example/events/detail/external">External</a>
      `, "text/html");
    }
    return response(`<script type="application/ld+json">{
      "@context": "https://schema.org",
      "@type": "Event",
      "identifier": "summer-show",
      "name": "Summer Show",
      "startDate": "2026-08-19T19:30:00-04:00",
      "endDate": "2026-08-19T21:30:00-04:00",
      "url": "https://venue.example/events/detail/summer-show",
      "location": { "@type": "Place", "name": "Main Hall" }
    }</script>`, "text/html");
  };
  try {
    const source: InstitutionCalendarSource = {
      id: "test_venue",
      name: "Test Venue",
      kind: "arts",
      city: "Virginia Beach",
      url: "https://venue.example/events",
      format: "venue-html",
      enabled: true,
      venueName: "Test Venue",
      detailPathPrefix: "/events/detail/",
    };
    const links = extractInstitutionDetailLinks(
      '<a href="/events/detail/a">A</a><a href="https://bad.example/events/detail/b">B</a>',
      source,
    );
    assert.deepEqual(links, ["https://venue.example/events/detail/a"]);
    const result = await fetchInstitutionSource(source);
    assert.equal(result.status, "ok");
    assert.equal(result.events.length, 1);
    assert.equal(result.events[0].name, "Summer Show");
    assert.equal(result.events[0].start_time, "2026-08-19T23:30:00.000Z");
  } finally {
    global.fetch = originalFetch;
  }
});

test("institution dedupe collapses equivalent cross-source events", () => {
  const base: NormalizedCityEvent = {
    source_event_id: "official_a",
    name: "The Summer Concert!",
    description: null,
    venue_name: "The Main Hall",
    address: null,
    city: "Norfolk",
    latitude: null,
    longitude: null,
    start_time: "2026-08-19T23:30:00.000Z",
    end_time: null,
    source: "official_a",
    source_name: "Official A",
    source_url: null,
    image_url: null,
    ticket_status: null,
  };
  const duplicate = {
    ...base,
    source_event_id: "official_b",
    source: "official_b",
    source_name: "Official B",
    name: "Summer Concert",
    venue_name: "Main Hall",
  };
  assert.equal(institutionEventSignature(base), institutionEventSignature(duplicate));
  assert.equal(dedupeInstitutionEvents([base, duplicate]).length, 1);
});
