import assert from "node:assert/strict";
import test from "node:test";
import {
  eventbriteHasMorePages,
  eventbriteOrganizationIds,
  eventbriteTicketStatus,
  isHamptonRoadsEvent,
  normalizeEventbriteEvent,
} from "./eventbrite";

test("extracts organization IDs from authenticated account payloads", () => {
  assert.deepEqual(eventbriteOrganizationIds({ organizations: [{ id: "10" }, { id: 20 }, {}] }), ["10", "20"]);
  assert.deepEqual(eventbriteOrganizationIds({ organizations: null }), []);
});

test("accepts only Hampton Roads venue geography", () => {
  assert.equal(isHamptonRoadsEvent({ venue: { address: { city: "Virginia Beach" } } }), true);
  assert.equal(isHamptonRoadsEvent({ venue: { address: { localized_address_display: "Granby St, Norfolk, VA" } } }), true);
  assert.equal(isHamptonRoadsEvent({ venue: { address: { city: "Richmond" } } }), false);
});

test("normalizes an official account event without claiming live occupancy", () => {
  const row = normalizeEventbriteEvent({
    id: "123",
    name: { text: "Oceanfront Night Market" },
    url: "https://www.eventbrite.com/e/oceanfront-night-market-tickets-123",
    start: { utc: "2026-08-01T23:00:00Z" },
    end: { utc: "2026-08-02T02:00:00Z" },
    venue: {
      name: "17th Street Park",
      address: { city: "Virginia Beach", localized_address_display: "Virginia Beach, VA" },
    },
    ticket_availability: { has_available_tickets: true, minimum_ticket_price: { value: 10 } },
  }, "2026-07-23T00:00:00Z");

  assert.ok(row);
  assert.equal(row.source_event_id, "eventbrite:123");
  assert.equal(row.source, "eventbrite");
  assert.equal(row.ticket_status, "Tickets Available");
  assert.equal(row.start_time, "2026-08-01T23:00:00.000Z");
});

test("rejects incomplete and out-of-market events", () => {
  assert.equal(normalizeEventbriteEvent({ id: "1", name: { text: "Missing start" }, venue: { address: { city: "Norfolk" } } }), null);
  assert.equal(normalizeEventbriteEvent({ id: "2", name: { text: "Richmond Event" }, start: { utc: "2026-08-01T23:00:00Z" }, venue: { address: { city: "Richmond" } } }), null);
});

test("normalizes Eventbrite ticket availability and pagination", () => {
  assert.equal(eventbriteTicketStatus({ is_free: true }), "Free Entry");
  assert.equal(eventbriteTicketStatus({ ticket_availability: { has_available_tickets: false } }), "Sold Out");
  assert.equal(eventbriteHasMorePages({ pagination: { has_more_items: true } }), true);
  assert.equal(eventbriteHasMorePages({ pagination: { has_more_items: false } }), false);
});
