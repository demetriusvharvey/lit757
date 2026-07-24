import {
  BUZZING_PIN_MIN_SCORE,
  ON_FIRE_PIN_MIN_SCORE,
} from "./buzz-map-model";

export {
  BUZZING_PIN_MIN_SCORE,
  ON_FIRE_PIN_MIN_SCORE,
} from "./buzz-map-model";

export const FEATURED_LOGO_MIN_ZOOM = 9.3;
export const ALL_LOGO_MIN_ZOOM = 11.7;
export const DENSE_LOGO_MIN_ZOOM = 14;
export const FEATURED_VENUE_LIMIT = 32;

type MapVenueCandidate = {
  id: string;
  score: number;
};

export function isBuzzingPinScore(score: number) {
  return score >= BUZZING_PIN_MIN_SCORE;
}

export function isOnFirePinScore(score: number) {
  return score >= ON_FIRE_PIN_MIN_SCORE;
}

/**
 * Keeps the medium-zoom map useful without covering it in pins. The hottest
 * venues win limited logo slots, while the selected venue is always retained.
 */
export function selectFeaturedVenueIds(
  venues: MapVenueCandidate[],
  selectedVenueId?: string | null,
  limit = FEATURED_VENUE_LIMIT,
) {
  if (limit <= 0) return [];

  const ranked = [...venues].sort(
    (left, right) =>
      right.score - left.score || left.id.localeCompare(right.id),
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
