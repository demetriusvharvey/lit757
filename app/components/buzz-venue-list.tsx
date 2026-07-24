"use client";

import {
  ChevronDown,
  ChevronUp,
  Heart,
  List,
  Search,
} from "lucide-react";
import type { MouseEvent } from "react";
import {
  milesLabel,
  venueCategory,
  venueScore,
  venueStatus,
  type BuzzCategory,
  type BuzzVenue,
} from "../buzz-map-model";
import { RemoteVenueImage } from "./remote-venue-image";

type VenueVibe = {
  label: string;
  truth: string;
};

type BuzzVenueListProps = {
  activeCategory: BuzzCategory;
  venues: BuzzVenue[];
  selectedVenueId?: string | null;
  favoriteIds: Set<string>;
  expanded: boolean;
  loading: boolean;
  scopeLabel: string;
  logoUrlFor: (venue: BuzzVenue) => string;
  vibeFor: (venue: BuzzVenue) => VenueVibe;
  onToggleExpanded: () => void;
  onSelectVenue: (venueId: string) => void;
  onToggleFavorite: (
    event: MouseEvent<HTMLButtonElement>,
    venue: BuzzVenue,
  ) => void;
};

/**
 * Shared responsive list: CSS changes its position and scrolling behavior at
 * the desktop/mobile breakpoint, while this component keeps its semantics and
 * interactions identical in both layouts.
 */
export function BuzzVenueList({
  activeCategory,
  venues,
  selectedVenueId,
  favoriteIds,
  expanded,
  loading,
  scopeLabel,
  logoUrlFor,
  vibeFor,
  onToggleExpanded,
  onSelectVenue,
  onToggleFavorite,
}: BuzzVenueListProps) {
  return (
    <aside className={`buzz-map-list${expanded ? " expanded" : ""}`}>
      <button
        type="button"
        className="buzz-mobile-list-handle"
        onClick={onToggleExpanded}
        aria-expanded={expanded}
      >
        <span><List /> Top Buzz</span>
        {expanded ? <ChevronDown /> : <ChevronUp />}
      </button>
      <div className="buzz-map-list-head">
        <div>
          <small>HIGHEST BUZZ FIRST</small>
          <h1>{activeCategory === "All" ? "Places buzzing now" : activeCategory}</h1>
          <p>{loading ? "Updating activity…" : `${venues.length} places ${scopeLabel}`}</p>
        </div>
        <span className="buzz-heat-key"><i /> Heat map <b>→</b> logo pins</span>
      </div>
      <div className="buzz-map-list-scroll">
        {venues.map((venue, index) => {
          const vibe = vibeFor(venue);
          const saved = favoriteIds.has(venue.id);
          return (
            <article
              key={venue.id}
              className={selectedVenueId === venue.id ? "selected" : ""}
              onClick={() => onSelectVenue(venue.id)}
            >
              <div className="buzz-list-photo">
                <RemoteVenueImage
                  src={logoUrlFor(venue)}
                  alt={`${venue.name} logo`}
                  fallback={venue.name.slice(0, 1)}
                  width={96}
                  height={96}
                  sizes="64px"
                />
              </div>
              <div className="buzz-list-copy">
                <small>
                  {index === 0 ? "BEST NOW" : `#${index + 1}`} · {venueCategory(venue)} ·{" "}
                  {milesLabel(venue.distanceMiles) || venue.city || "Nearby"}
                </small>
                <strong>{venue.name}</strong>
                <span className={`buzz-vibe-tag ${vibe.truth}`}>
                  {vibe.label}<b>{vibe.truth === "live" ? "LIVE" : "FORECAST"}</b>
                </span>
                <p>{venue.event?.name || venue.reason || "Available right now"}</p>
                <span className={`buzz-status s${Math.floor(venueScore(venue) / 20)}`}>
                  {venueStatus(venue)}
                  {venue.activity?.scoreMode === "live" ? " · Live" : " · Forecast"}
                </span>
              </div>
              <button
                type="button"
                className={saved ? "saved" : ""}
                onClick={(event) => onToggleFavorite(event, venue)}
                aria-label={saved ? `Remove ${venue.name} from saved places` : `Save ${venue.name}`}
              >
                <Heart fill={saved ? "currentColor" : "none"} />
              </button>
            </article>
          );
        })}
        {!loading && !venues.length && (
          <div className="buzz-map-empty">
            <Search />
            <strong>No places match this filter</strong>
            <p>Try All or zoom to another area.</p>
          </div>
        )}
      </div>
    </aside>
  );
}
