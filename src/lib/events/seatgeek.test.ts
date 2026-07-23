import assert from "node:assert/strict";
import test from "node:test";
import {
  isHamptonRoadsSeatGeekEvent,
  normalizeSeatGeekEvent,
  seatGeekDemandMetadata,
  seatGeekHasMorePages,
  seatGeekTicketStatus,
} from "./seatgeek";

test("accepts SeatGeek events only in Hampton Roads cities", () => {
  assert.equal(isHamptonRoadsSeatGeekEvent({ venue: { city: "Newport News" } }), true);
  assert.equal(isHamptonRoadsSeatGeekEvent({ venue: { city: "Virginia Beach" } }), true);
  assert.equal(isHamptonRoadsSeatGeekEvent({ venue: { city: "Richmond" } }), false);
});

test("normalizes SeatGeek demand as scheduled event context", () => {
  const row = normalizeSeatGeekEvent({
    id: 123,
    title: "Major Concert",
    url: "https://seatgeek.com/major-concert-tickets",
    datetime_utc: "2026-08-02T00:00:00Z",
    venue: { id: 9, name: "Hampton Coliseum", city: "Hampton", state: "VA" },
    stats: { listing_count: 54, lowest_price: 42, average_price: 88, highest_price: 190 },
    score: 0.82,
  }, "2026-07-23T00:00:00Z");

  assert.ok(row);
  assert.equal(row.source_event_id, "seatgeek:123");
  assert.equal(row.source, "seatgeek");
  assert.equal(row.ticket_status, "Tickets from $42");
  assert.equal(row.start_time, "2026-08-02T00:00:00.000Z");
});

test("rejects incomplete and out-of-market SeatGeek events", () => {
  assert.equal(normalizeSeatGeekEvent({ id: 1, title: "Missing time", venue: { city: "Norfolk" } }), null);
  assert.equal(normalizeSeatGeekEvent({ id: 2, title: "Richmond Show", datetime_utc: "2026-08-02T00:00:00Z", venue: { city: "Richmond" } }), null);
});

test("extracts bounded demand metadata without claiming occupancy", () => {
  const metadata = seatGeekDemandMetadata({
    score: 0.6,
    time_tbd: true,
    venue: { id: 5, name: "Scope Arena", city: "Norfolk" },
    stats: { listing_count: 20, lowest_price: 30, average_price: 70, highest_price: 150 },
  });
  assert.deepEqual(metadata, {
    providerVenueId: "5",
    providerVenueName: "Scope Arena",
    providerCity: "Norfolk",
    listingCount: 20,
    averagePrice: 70,
    lowestPrice: 30,
    highestPrice: 150,
    popularityScore: 0.6,
    timeTbd: true,
  });
});

test("handles ticket and pagination status", () => {
  assert.equal(seatGeekTicketStatus({ stats: { listing_count: 0 } }), "No Listings");
  assert.equal(seatGeekTicketStatus({ stats: { listing_count: 2, lowest_price: 15 } }), "Tickets from $15");
  assert.equal(seatGeekHasMorePages({ meta: { page: 1, per_page: 100, total: 201 } }), true);
  assert.equal(seatGeekHasMorePages({ meta: { page: 3, per_page: 100, total: 201 } }), false);
});
