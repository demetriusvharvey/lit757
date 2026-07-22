import assert from "node:assert/strict";
import test from "node:test";
import {
  bestTimeSignals,
  createBestTimeForecast,
  fetchBestTimeLive,
  findBestTimeAccountVenue,
  resetBestTimeAccountVenueCacheForTests,
} from "./providers/besttime";
import type { VenueForBuzz } from "./types";

const venue: VenueForBuzz = {
  id: "venue-1",
  name: "The Harbor Club",
  address: "123 Main Street",
  city: "Virginia Beach",
};

function withKeys() {
  process.env.BESTTIME_API_KEY_PRIVATE = "pri_test";
  process.env.BESTTIME_API_KEY_PUBLIC = "pub_test";
}

test("matches an existing account forecast conservatively by name and address", () => {
  const match = findBestTimeAccountVenue(venue, [
    { venue_id: "wrong", venue_name: "The Harbor Club", venue_address: "999 Main Street, Norfolk", venue_forecasted: true },
    { venue_id: "right", venue_name: "Harbor Club", venue_address: "123 Main Street, Virginia Beach, VA", venue_forecasted: true },
  ]);
  assert.equal(match?.venue_id, "right");
});

test("reuses an existing forecast instead of spending a new forecast credit", async () => {
  const originalFetch = globalThis.fetch;
  withKeys();
  resetBestTimeAccountVenueCacheForTests();
  const calls: string[] = [];
  globalThis.fetch = (async input => {
    const url = String(input);
    calls.push(url);
    assert.match(url, /\/venues\?/);
    return new Response(JSON.stringify([{
      venue_id: "ven_existing",
      venue_name: "Harbor Club",
      venue_address: "123 Main Street, Virginia Beach, VA",
      venue_forecasted: true,
      epoch_analysis: 123,
    }]), { status: 200 });
  }) as typeof fetch;

  try {
    const mapping = await createBestTimeForecast(venue);
    assert.equal(mapping.providerVenueId, "ven_existing");
    assert.equal(mapping.metadata.reusedExistingForecast, true);
    assert.equal(calls.length, 1);
    assert.ok(!calls.some(url => url.includes("/forecasts?")));
  } finally {
    globalThis.fetch = originalFetch;
    resetBestTimeAccountVenueCacheForTests();
  }
});

test("does not retry a venue BestTime already marked as unforecastable", async () => {
  const originalFetch = globalThis.fetch;
  withKeys();
  resetBestTimeAccountVenueCacheForTests();
  const calls: string[] = [];
  globalThis.fetch = (async input => {
    calls.push(String(input));
    return new Response(JSON.stringify([{
      venue_id: "ven_unavailable",
      venue_name: "Harbor Club",
      venue_address: "123 Main Street, Virginia Beach, VA",
      venue_forecasted: false,
    }]), { status: 200 });
  }) as typeof fetch;

  try {
    await assert.rejects(() => createBestTimeForecast(venue), /does not have enough visitor history/i);
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    resetBestTimeAccountVenueCacheForTests();
  }
});

test("falls back to the public current-hour forecast when live data is unavailable", async () => {
  const originalFetch = globalThis.fetch;
  withKeys();
  const calls: string[] = [];
  globalThis.fetch = (async input => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/forecasts/live")) {
      return new Response(JSON.stringify({ status: "Error", message: "No live data available." }), { status: 200 });
    }
    if (url.includes("/forecasts/now/raw")) {
      assert.match(url, /api_key_public=pub_test/);
      return new Response(JSON.stringify({
        status: "OK",
        forecast_updated_on: "2026-07-22T22:00:00Z",
        analysis: {
          hour_raw: 72,
          hour_analysis: { hour: 20, intensity_txt: "Above average" },
        },
        venue_info: { venue_id: "ven_existing", venue_name: "Harbor Club" },
      }), { status: 200 });
    }
    throw new Error(`Unexpected URL: ${url}`);
  }) as typeof fetch;

  try {
    const payload = await fetchBestTimeLive("ven_existing");
    const signals = bestTimeSignals(payload, new Date("2026-07-22T23:45:00Z"));
    assert.equal(signals.length, 1);
    assert.equal(signals[0].type, "besttime_forecast");
    assert.equal(signals[0].value, 72);
    assert.equal(signals[0].isLive, false);
    assert.equal(signals[0].expiresAt, "2026-07-23T00:10:00.000Z");
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
