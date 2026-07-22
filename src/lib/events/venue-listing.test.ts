import assert from "node:assert/strict";
import test from "node:test";
import { parseVenueListingEvents } from "./venue-listing";
import type { InstitutionCalendarSource } from "./institution-calendars";

const source: InstitutionCalendarSource = {
  id: "sandler_test",
  name: "Sandler Center",
  kind: "arts",
  city: "Virginia Beach",
  url: "https://venue.example/events",
  format: "venue-html",
  enabled: true,
  venueName: "Sandler Center",
  detailPathPrefix: "/events/detail/",
};

test("venue listing parser extracts Carbonhouse dates, times, titles, and links", () => {
  const events = parseVenueListingEvents(`
    <section class="event-item">
      <div>Wednesday | Aug 19, 2026</div>
      <h3><a href="/events/detail/tidewater-drive">Ynot Wednesday with Tidewater Drive</a></h3>
      <p>Event Starts 5:00 PM</p>
      <a href="/events/detail/tidewater-drive">More Info</a>
    </section>
    <section class="event-item">
      <div>Saturday | Aug 29, 2026</div>
      <h3><a href="/events/detail/motown-mania">Motown Mania</a></h3>
      <p>Event Starts 7:30 PM</p>
      <a href="/events/detail/motown-mania">Buy Tickets</a>
    </section>
  `, source);

  assert.equal(events.length, 2);
  assert.equal(events[0].name, "Ynot Wednesday with Tidewater Drive");
  assert.equal(events[0].start_time, "2026-08-19T21:00:00.000Z");
  assert.equal(events[1].start_time, "2026-08-29T23:30:00.000Z");
  assert.equal(events[1].ticket_status, "available");
  assert.equal(events[1].source_url, "https://venue.example/events/detail/motown-mania");
});

test("venue listing parser ignores external and action-only links", () => {
  const events = parseVenueListingEvents(`
    <div>Thursday | Aug 20, 2026</div>
    <a href="https://other.example/events/detail/external">External Show</a>
    <a href="/events/detail/local">More Info</a>
  `, source);
  assert.equal(events.length, 0);
});
