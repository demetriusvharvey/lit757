export const PLAYWRIGHT_MAPBOX_TOKEN = "e2e-mapbox-placeholder";

/**
 * The browser suite exercises the responsive UI with deterministic API
 * fixtures. Its sentinel token intentionally leaves Mapbox unmounted so CI
 * never depends on Mapbox availability or consumes provider quota.
 */
export function canInitializeMapbox(token: string | undefined): token is string {
  return Boolean(token && token !== PLAYWRIGHT_MAPBOX_TOKEN);
}
