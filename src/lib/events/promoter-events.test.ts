import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  PROMOTER_EVENT_SOURCES,
  extractPromoterEventUrls,
  parsePoshEventPage,
  promoterAppearance,
} from "./promoter-events";

const source = PROMOTER_EVENT_SOURCES[0];

test("promoter landing pages accept only allowlisted event links", () => {
  const urls = extractPromoterEventUrls(`
    <a href="https://posh.vip/e/tde-picture-day-81">Tickets</a>
    <a href="https:\/\/posh.vip\/e\/next-traptastic-night">Next</a>
    <a href="https://evil.example/e/fake">Fake</a>
    <a href="javascript:alert(1)">Bad</a>
  `, source);
  assert.deepEqual(urls, [
    "https://posh.vip/e/tde-picture-day-81",
    "https://posh.vip/e/next-traptastic-night",
  ]);
});

test("Posh pages normalize promoter events and surface explicit featured appearances", () => {
  const html = String.raw`
    \"eventName\":\"TDE Picture Day 8/1\",
    \"eventId\":\"6a614a1341f73b0a4f9ea43c\",
    \"venueName\":\"Crocs\",
    \"start\":\"2026-08-02T02:00:00.000Z\",
    \"end\":\"2026-08-02T06:00:00.000Z\",
    \"description\":\"Happy Birthday Rodbaby. Featuring Malika Flood Vega\",
    \"imageUrl\":\"https://images.posh.vip/event.jpg\",
    \"streetAddress\": \"619 19th St, Virginia Beach, VA 23451, USA\",
    \"latitude\": 36.8462711,
    \"longitude\": -75.9825904,
    \"availability\": \"https://schema.org/InStock\"
  `;
  const event = parsePoshEventPage(
    html,
    source,
    "https://posh.vip/e/tde-picture-day-81",
    new Date("2026-08-02T04:00:00.000Z"),
  );
  assert.ok(event);
  assert.equal(event.venue_name, "Crocs 19th Street Bistro");
  assert.equal(event.start_time, "2026-08-02T02:00:00.000Z");
  assert.equal(event.end_time, "2026-08-02T06:00:00.000Z");
  assert.equal(event.latitude, 36.8462711);
  assert.equal(event.longitude, -75.9825904);
  assert.equal(event.ticket_status, "Tickets available · Featured: Malika Flood Vega");
  assert.equal(event.source, "promoter_posh");
});

test("appearance labels require explicit announcement language", () => {
  assert.deepEqual(promoterAppearance("Special guest: Artist One"), { label: "Special guest", names: "Artist One" });
  assert.deepEqual(promoterAppearance("Sounds by DJ One, DJ Two"), { label: "Sounds by", names: "DJ One, DJ Two" });
  assert.equal(promoterAppearance("A celebrity might be nearby"), null);
});

test("ended promoter events expire instead of remaining live context", () => {
  const html = String.raw`
    \"eventName\":\"Old Party\",\"eventId\":\"old\",\"venueName\":\"Crocs\",
    \"start\":\"2026-08-01T02:00:00.000Z\",\"end\":\"2026-08-01T06:00:00.000Z\"
  `;
  assert.equal(parsePoshEventPage(html, source, "https://posh.vip/e/old", new Date("2026-08-02T14:00:00.000Z")), null);
});

test("promoter sync route stays protected and preserves the forecast trust boundary", () => {
  const route = fs.readFileSync("app/api/events/promoter-calendars/route.ts", "utf8");
  assert.match(route, /isCronAuthorized\(request\)/);
  assert.match(route, /do not prove live venue occupancy/i);
  assert.match(route, /onConflict: "source_event_id"/);
  assert.doesNotMatch(route, /\.delete\s*\(/);
});
