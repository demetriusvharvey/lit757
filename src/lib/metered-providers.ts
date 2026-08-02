export type MeteredProvider =
  | "besttime"
  | "google_places"
  | "mapbox_geocoding"
  | "openai"
  | "predicthq"
  | "resend";

const OPT_IN_ENV: Record<MeteredProvider, string> = {
  besttime: "ALLOW_METERED_BESTTIME",
  google_places: "ALLOW_METERED_GOOGLE_PLACES",
  mapbox_geocoding: "ALLOW_METERED_MAPBOX_GEOCODING",
  openai: "ALLOW_METERED_OPENAI",
  predicthq: "ALLOW_METERED_PREDICTHQ",
  resend: "ALLOW_METERED_RESEND",
};

/**
 * Metered providers are disabled even when credentials exist. Each provider
 * requires a separate, explicit production opt-in so adding a key cannot
 * silently create billable traffic.
 */
export function meteredProviderCallsEnabled(
  provider: MeteredProvider,
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  return env[OPT_IN_ENV[provider]] === "true";
}

export function meteredProviderOptInEnv(provider: MeteredProvider) {
  return OPT_IN_ENV[provider];
}
