"use client";

import { MapPin, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { LocationSearchResult } from "../../src/lib/location-search";
import {
  venueCategory,
  venueScore,
  type BuzzVenue,
} from "../buzz-map-model";

type LocationSearchState = {
  query: string;
  results: LocationSearchResult[];
  loading: boolean;
};

type BuzzMapSearchProps = {
  query: string;
  venues: BuzzVenue[];
  onQueryChange: (query: string) => void;
  onSelectVenue: (venueId: string) => void;
  onSelectLocation: (location: LocationSearchResult) => Promise<void>;
};

export function BuzzMapSearch({
  query,
  venues,
  onQueryChange,
  onSelectVenue,
  onSelectLocation,
}: BuzzMapSearchProps) {
  const [focused, setFocused] = useState(false);
  const [locationSearch, setLocationSearch] = useState<LocationSearchState>({
    query: "",
    results: [],
    loading: false,
  });

  useEffect(() => {
    const clean = query.trim();
    if (!focused || clean.length < 2) return;

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLocationSearch({ query: clean, results: [], loading: true });
      void fetch(`/api/location-search?q=${encodeURIComponent(clean)}`, {
        cache: "no-store",
        signal: controller.signal,
      })
        .then(response => response.ok ? response.json() : null)
        .then(payload => {
          if (controller.signal.aborted) return;
          setLocationSearch({
            query: clean,
            results: (payload?.results || []).slice(0, 6) as LocationSearchResult[],
            loading: false,
          });
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setLocationSearch({ query: clean, results: [], loading: false });
          }
        });
    }, 240);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [focused, query]);

  const venueResults = useMemo(() => {
    const clean = query.trim().toLowerCase();
    if (clean.length < 2) return [];
    return [...venues]
      .filter(venue => `${venue.name} ${venue.city || ""} ${venue.address || ""} ${venue.type || ""} ${venue.category || ""} ${venue.area?.shortName || ""} ${venue.event?.name || ""}`.toLowerCase().includes(clean))
      .sort((left, right) => venueScore(right) - venueScore(left) || (left.distanceMiles ?? 999) - (right.distanceMiles ?? 999))
      .slice(0, 6);
  }, [query, venues]);

  const cleanQuery = query.trim();
  const locationResults = locationSearch.query === cleanQuery ? locationSearch.results : [];
  const searchingLocations = cleanQuery.length >= 2 && locationSearch.query !== cleanQuery
    ? true
    : locationSearch.loading;
  const expanded = focused && cleanQuery.length >= 2;

  return (
    <div
      className="buzz-map-search-wrap"
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        const nextTarget = event.relatedTarget;
        if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) setFocused(false);
      }}
    >
      <label className="buzz-map-search">
        <Search />
        <input
          value={query}
          onChange={event => onQueryChange(event.target.value)}
          onKeyDown={event => { if (event.key === "Escape") setFocused(false); }}
          onFocus={() => setFocused(true)}
          placeholder="Search places or 757 areas"
          aria-label="Search places and Hampton Roads areas"
          role="combobox"
          aria-expanded={expanded}
          aria-controls={expanded ? "buzz-map-search-results" : undefined}
          aria-haspopup="dialog"
          autoComplete="off"
        />
        {query && <button type="button" onClick={() => onQueryChange("")} aria-label="Clear search"><X /></button>}
      </label>
      {expanded && (
        <div id="buzz-map-search-results" className="buzz-map-search-results" role="dialog" aria-label="Search suggestions">
          {venueResults.length > 0 && (
            <section>
              <small>PLACES</small>
              {venueResults.map(venue => (
                <button type="button" key={venue.id} onClick={() => { setFocused(false); onSelectVenue(venue.id); }}>
                  <i>{venue.name.slice(0, 1)}</i>
                  <span><strong>{venue.name}</strong><small>{venue.city || venue.area?.shortName || venueCategory(venue)}</small></span>
                  <b>{venueScore(venue)}</b>
                </button>
              ))}
            </section>
          )}
          {locationResults.length > 0 && (
            <section>
              <small>HAMPTON ROADS AREAS</small>
              {locationResults.map(result => (
                <button type="button" key={result.id} onClick={() => { setFocused(false); void onSelectLocation(result); }}>
                  <i><MapPin /></i>
                  <span><strong>{result.name}</strong><small>{result.detail}</small></span>
                  <b>→</b>
                </button>
              ))}
            </section>
          )}
          {searchingLocations && <p><i /> Searching 757 areas…</p>}
          {!searchingLocations && !venueResults.length && !locationResults.length && (
            <p>No match yet. Try a venue, city, or activity district.</p>
          )}
        </div>
      )}
    </div>
  );
}
