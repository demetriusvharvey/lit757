import assert from "node:assert/strict";
import test from "node:test";
import { BUZZ_INTEGRATIONS, integrationConfigured } from "../integration-catalog";

const requiredNames = [
  "Mapbox",
  "Google Places API",
  "Google Street View API",
  "OpenStreetMap / Overpass",
  "TomTom",
  "BestTime",
  "Brandfetch",
  "Supabase",
  "Vercel",
  "Ticketmaster Discovery API",
  "Eventbrite",
  "SeatGeek",
  "Official city event calendars",
  "Official university calendars",
  "Official venue calendars",
  "Tourism and destination calendars",
  "ICS calendar feeds",
  "National Weather Service",
  "NOAA CO-OPS",
  "AirNow",
  "National Park Service API",
  "Hampton Roads Transit GTFS",
  "HRT GTFS-Realtime",
  "HRT vehicle positions",
  "GBFS bike and scooter feeds",
  "GDELT",
  "User live reports",
  "Anonymous nearby activity signals",
  "Favorites and saved venues",
  "Push notifications",
  "Web Share API",
  "Instagram Sharing to Stories",
  "TikTok Share Kit",
  "SMS and deep-link sharing",
  "Referral tracking",
  "AI recommendations",
  "AI city summaries",
  "Vercel AI Gateway",
  "Event Agent",
  "Ticket Agent",
  "Website Agent",
  "Hours Agent",
  "Reservation Agent",
  "Social Buzz Agent",
  "Provider health monitoring",
  "Analytics and conversion tracking",
];

test("catalog includes every required LIT757 / Buzz integration", () => {
  const names = new Set(BUZZ_INTEGRATIONS.map(integration => integration.name));
  for (const name of requiredNames) assert.ok(names.has(name), `Missing integration: ${name}`);
});

test("integration IDs are unique and every source has a truth role", () => {
  const ids = BUZZ_INTEGRATIONS.map(integration => integration.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(BUZZ_INTEGRATIONS.every(integration => integration.role && integration.detail));
});

test("billing-capable integrations are not configured by credentials alone", () => {
  const google = BUZZ_INTEGRATIONS.find(integration => integration.id === "google-places");
  assert.ok(google);
  assert.equal(integrationConfigured(google, { GOOGLE_PLACES_API_KEY: "configured" }), false);
  assert.equal(integrationConfigured(google, {
    GOOGLE_PLACES_API_KEY: "configured",
    ALLOW_METERED_GOOGLE_PLACES: "false",
  }), false);
  assert.equal(integrationConfigured(google, {
    GOOGLE_PLACES_API_KEY: "configured",
    ALLOW_METERED_GOOGLE_PLACES: "true",
  }), true);
});
