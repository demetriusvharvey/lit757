import {
  BUZZING_PIN_MIN_SCORE,
  ON_FIRE_PIN_MIN_SCORE,
  type BuzzVenue,
} from "./buzz-map-model";

export {
  BUZZING_PIN_MIN_SCORE,
  ON_FIRE_PIN_MIN_SCORE,
} from "./buzz-map-model";

export const FEATURED_LOGO_MIN_ZOOM = 9.3;
export const ALL_LOGO_MIN_ZOOM = 11.7;
export const DENSE_LOGO_MIN_ZOOM = 14;
export const FEATURED_VENUE_LIMIT = 32;
export const EVENT_PULSE_LOOKBACK_MS = 60 * 60 * 1_000;
export const EVENT_PULSE_LEAD_MS = 6 * 60 * 60 * 1_000;

type MapVenueCandidate = {
  id: string;
  pulsePriority?: boolean;
  score: number;
};

export function isBuzzingPinScore(score: number) {
  return score >= BUZZING_PIN_MIN_SCORE;
}

export function isOnFirePinScore(score: number) {
  return score >= ON_FIRE_PIN_MIN_SCORE;
}

/**
 * A violet event beacon is allowed only near a listed start time. It does not
 * imply attendance or that the event is still running after the short grace
 * window.
 */
export function isVenueEventSoon(venue: BuzzVenue, now = Date.now()) {
  const startTime = venue.event?.startTime;
  if (!venue.event?.name || !startTime) return false;
  const start = new Date(startTime).getTime();
  if (!Number.isFinite(start)) return false;
  return start >= now - EVENT_PULSE_LOOKBACK_MS && start <= now + EVENT_PULSE_LEAD_MS;
}

/**
 * Keeps the medium-zoom map useful without covering it in pins. Near-term
 * events and the hottest venues win limited logo slots, while the selected
 * venue is always retained.
 */
export function selectFeaturedVenueIds(
  venues: MapVenueCandidate[],
  selectedVenueId?: string | null,
  limit = FEATURED_VENUE_LIMIT,
) {
  if (limit <= 0) return [];

  const ranked = [...venues].sort(
    (left, right) =>
      Number(Boolean(right.pulsePriority)) - Number(Boolean(left.pulsePriority)) ||
      right.score - left.score ||
      left.id.localeCompare(right.id),
  );
  const featured = ranked.slice(0, limit);
  const selected = selectedVenueId
    ? ranked.find((venue) => venue.id === selectedVenueId)
    : undefined;

  if (selected && !featured.some((venue) => venue.id === selected.id)) {
    featured[featured.length - 1] = selected;
  }

  return featured.map((venue) => venue.id);
}
