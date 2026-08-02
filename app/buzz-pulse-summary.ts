import {
  BUZZING_PIN_MIN_SCORE,
  venueScore,
  type BuzzVenue,
} from "./buzz-map-model";

export type BuzzPulseSummary = {
  eventListingCount: number;
  highForecastCount: number;
  liveCount: number;
  mode: "live" | "forecast";
  modeLabel: string;
  openCount: number;
  rankedCount: number;
};

export function pulseScopePhrase(scopeLabel: string) {
  const clean = scopeLabel.trim();
  if (!clean || /^(?:in\s+)?hampton roads$/i.test(clean)) {
    return "across Hampton Roads";
  }
  if (/^(in|near|around)\b/i.test(clean)) return clean;
  return `across ${clean}`;
}

/**
 * Summarizes only claims already present in the discovery response. It never
 * turns forecasts, opening-hours metadata, or event listings into a crowd
 * count, and it does not alter canonical activity scores.
 */
export function summarizeBuzzPulse(venues: BuzzVenue[]): BuzzPulseSummary {
  let eventListingCount = 0;
  let highForecastCount = 0;
  let liveCount = 0;
  let openCount = 0;

  for (const venue of venues) {
    const mode = venue.activity?.scoreMode === "live" ? "live" : "forecast";
    if (mode === "live") liveCount += 1;
    if (mode === "forecast" && venueScore(venue) >= BUZZING_PIN_MIN_SCORE) {
      highForecastCount += 1;
    }
    if (venue.openNow === true) openCount += 1;
    if (venue.event?.name) eventListingCount += 1;
  }

  return {
    eventListingCount,
    highForecastCount,
    liveCount,
    mode: liveCount > 0 ? "live" : "forecast",
    modeLabel: liveCount > 0
      ? `${liveCount} live ${liveCount === 1 ? "signal" : "signals"}`
      : "Forecast mode",
    openCount,
    rankedCount: venues.length,
  };
}
