import assert from "node:assert/strict";
import test from "node:test";
import {
  INSTITUTION_CALENDAR_SOURCES,
  dedupeInstitutionEvents,
  extractInstitutionDetailLinks,
  fetchInstitutionSource,
  institutionEventSignature,
  parseInstitutionDateHeading,
  parseMarinersMuseumDetail,
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

test("parses official institution date headings in Hampton Roads local time", () => {
  assert.deepEqual(
    parseInstitutionDateHeading("Wednesday, August 5, 2026 | 6:30PM"),
    { start: "2026-08-05T18:30:00-04:00", end: null },
  );
  assert.deepEqual(
    parseInstitutionDateHeading("Saturday, August 1, 2026 - Monday, August 31, 2026 | 9AM"),
    { start: "2026-08-01T09:00:00-04:00", end: "2026-08-31T23:59:59-04:00" },
  );
});

test("Nauticus HTML fallback preserves its official venue, address, and date", async () => {
  const originalFetch = global.fetch;
  global.fetch = async input => {
    const url = String(input);
    if (url.endsWith("/calendar/")) {
      return response('<a href="/events/sunset-yoga-on-bb-64-3/">Sunset Yoga</a>', "text/html");
    }
    return response(`
      <meta property="og:description" content="Yoga on the Battleship Wisconsin." />
      <meta property="og:image" content="https://nauticus.example/yoga.jpg" />
      <h1 class="event-page-title">Sunset Yoga on BB-64</h1>
      <h3 class="post-date">Wednesday, August 5, 2026 <span>|</span> 6:30PM</h3>
      <div><strong>LOCATION</strong><p> Battleship Wisconsin</p></div>
      <a href="https://tickets.example">Buy Tickets</a>
    `, "text/html");
  };
  try {
    const source: InstitutionCalendarSource = {
      id: "nauticus_official",
      name: "Nauticus & Battleship Wisconsin Events",
      kind: "museum",
      city: "Norfolk",
      url: "https://nauticus.example/calendar/",
      format: "venue-html",
      enabled: true,
      venueName: "Nauticus",
      address: "One Waterside Drive, Norfolk, VA 23510",
      detailPathPrefix: "/events/",
    };
    const result = await fetchInstitutionSource(source);
    assert.equal(result.status, "ok");
    assert.equal(result.events.length, 1);
    assert.equal(result.events[0].name, "Sunset Yoga on BB-64");
    assert.equal(result.events[0].start_time, "2026-08-05T18:30:00-04:00");
    assert.equal(result.events[0].venue_name, "Battleship Wisconsin");
    assert.equal(result.events[0].address, "One Waterside Drive, Norfolk, VA 23510");
    assert.equal(result.events[0].ticket_status, "available");
  } finally {
    global.fetch = originalFetch;
  }
});

test("Portsmouth Museums parser enriches official recurring event details", async () => {
  const originalFetch = global.fetch;
  global.fetch = async input => {
    const url = String(input);
    if (url.endsWith("/events")) {
      return response(`
        <h2>August 2026</h2>
        <a href="/events/48776">Game Night at the Museum</a>
      `, "text/html");
    }
    return response(`
      <meta property="og:title" content="Game Night at the Museum" />
      <main>
        <div>Other Dates August 14th @ 5:00 pm August 21st @ 5:00 pm View More</div>
        <img src="https://portsmouth.example/game-night.jpg" alt="Game Night at the Museum" />
        <h1>Game Night at the Museum</h1>
        <div>August 7th @ 5:00 pm - 8:00 pm</div>
        <div><h4>Location</h4><div><h5>Portsmouth Art &amp; Cultural Center</h5>
          <div>400 High Street</div><div>Portsmouth 23704</div>
        </div></div>
        <div><h4>Description</h4><div><p>Games, creativity, and community after hours.</p></div></div>
        <a href="https://tickets.example">Get Tickets</a>
      </main>
    `, "text/html");
  };
  try {
    const source: InstitutionCalendarSource = {
      id: "portsmouth_museums_official",
      name: "Portsmouth Museums Events",
      kind: "museum",
      city: "Portsmouth",
      url: "https://portsmouth.example/events",
      format: "portsmouth-html",
      enabled: true,
      venueName: "Portsmouth Museums",
      detailPathPrefix: "/events/",
    };
    const result = await fetchInstitutionSource(source);
    assert.equal(result.status, "ok");
    assert.equal(result.events.length, 3);
    assert.deepEqual(result.events.map(event => event.start_time), [
      "2026-08-07T17:00:00-04:00",
      "2026-08-14T17:00:00-04:00",
      "2026-08-21T17:00:00-04:00",
    ]);
    assert.ok(result.events.every(event => event.end_time?.endsWith("20:00:00-04:00")));
    assert.equal(result.events[0].venue_name, "Portsmouth Art & Cultural Center");
    assert.equal(result.events[0].address, "400 High Street, Portsmouth, VA 23704");
    assert.equal(result.events[0].description, "Games, creativity, and community after hours.");
    assert.equal(result.events[0].image_url, "https://portsmouth.example/game-night.jpg");
    assert.equal(result.events[0].ticket_status, "available");
  } finally {
    global.fetch = originalFetch;
  }
});

test("Mariners Museum detail parser preserves official time, address, image, and registration", () => {
  const source: InstitutionCalendarSource = {
    id: "mariners_museum_official",
    name: "The Mariners' Museum and Park Events",
    kind: "museum",
    city: "Newport News",
    url: "https://mariners.example/events-exhibits/",
    format: "mariners-wp",
    enabled: true,
    venueName: "The Mariners' Museum and Park",
    address: "100 Museum Drive, Newport News, VA 23606",
  };
  const event = parseMarinersMuseumDetail(source, `
    <meta property="og:description" content="A free maritime history lecture." />
    <meta property="og:image" content="https://mariners.example/michigan.jpg" />
    <article id="post-28207">
      <h1 class="entry-title">USS <em>Michigan</em>: The US Navy's First Iron Ship</h1>
      <div class="date-format">
        <p>Friday, September 11, 2026</p>
        <p>12:00 PM to 1:00 PM EDT</p>
        <p>In Person | Virtual</p>
      </div>
      <h2>Attend this Event</h2><a href="https://tickets.example">Register</a>
    </article>
  `, "https://mariners.example/event/uss-michigan/");

  assert.ok(event);
  assert.equal(event.name, "USS Michigan: The US Navy's First Iron Ship");
  assert.equal(event.start_time, "2026-09-11T12:00:00-04:00");
  assert.equal(event.end_time, "2026-09-11T13:00:00-04:00");
  assert.equal(event.venue_name, "The Mariners' Museum and Park");
  assert.equal(event.address, "100 Museum Drive, Newport News, VA 23606");
  assert.equal(event.description, "A free maritime history lecture.");
  assert.equal(event.image_url, "https://mariners.example/michigan.jpg");
  assert.equal(event.ticket_status, "available");

  const winter = parseMarinersMuseumDetail(source, `
    <article><h1 class="entry-title">Friendly Hours</h1>
      <div class="date-format"><p>Sunday, December 13, 2026</p><p>9:00 AM to 11:00 AM EST</p></div>
    </article>
  `, "https://mariners.example/event/friendly-hours/");
  assert.equal(winter?.start_time, "2026-12-13T09:00:00-05:00");
  assert.equal(winter?.end_time, "2026-12-13T11:00:00-05:00");
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
