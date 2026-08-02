import assert from "node:assert/strict";
import test from "node:test";
import {
  meteredProviderCallsEnabled,
  meteredProviderOptInEnv,
  type MeteredProvider,
} from "./metered-providers";

const providers: MeteredProvider[] = [
  "besttime",
  "google_places",
  "mapbox_geocoding",
  "openai",
  "predicthq",
  "resend",
];

test("metered providers default to disabled even when their credentials exist", () => {
  const env = {
    BESTTIME_API_KEY_PRIVATE: "configured",
    GOOGLE_PLACES_API_KEY: "configured",
    NEXT_PUBLIC_MAPBOX_TOKEN: "configured",
    OPENAI_API_KEY: "configured",
    PREDICTHQ_ACCESS_TOKEN: "configured",
    RESEND_API_KEY: "configured",
  };

  for (const provider of providers) {
    assert.equal(meteredProviderCallsEnabled(provider, env), false, provider);
  }
});

test("each metered provider requires its own exact true opt-in", () => {
  for (const provider of providers) {
    const key = meteredProviderOptInEnv(provider);
    assert.equal(meteredProviderCallsEnabled(provider, { [key]: "false" }), false);
    assert.equal(meteredProviderCallsEnabled(provider, { [key]: "1" }), false);
    assert.equal(meteredProviderCallsEnabled(provider, { [key]: "TRUE" }), false);
    assert.equal(meteredProviderCallsEnabled(provider, { [key]: "true" }), true);
  }
});
