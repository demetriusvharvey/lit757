"use client";

import { MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import "./buzz-desktop.css";
import "./buzz-desktop-map-first.css";
import "./buzz-area-picker.css";
import {
  Bell,
  CalendarDays,
  ChevronRight,
  Compass,
  Heart,
  LocateFixed,
  MapPin,
  MapPinned,
  Music2,
  Navigation,
  Search,
  ShoppingBag,
  Sparkles,
  TreePine,
  UserRound,
  Utensils,
  Wine,
  X,
} from "lucide-react";

type Venue = {
  id: string;
  name: string;
  city?: string;
  address?: string | null;
  kind?: string;
  type?: string;
  lat: number | string;
  lng: number | string;
  photoUrl?: string | null;
  reason?: string;
  openNow?: boolean | null;
  distanceMiles?: number | null;
  event?: { name?: string | null } | null;
  activity?: { score: number; label: string; trendLabel: string };
};

type Payload = {
  success?: boolean;
  venues?: Venue[];
  picks?: Venue[];
  scope?: { label?: string };
  error?: string;
};

type LocationResult = {
  id: string;
  name: string;
  detail: string;
  longitude: number;
  latitude: number;
  bbox: number[] | null;
};

type District = {
  id: string;
  shortName: string;
  label: string;
  score: number;
  arrivalLabel: string;
  radiusMiles: number;
  center: { lat: number; lng: number };
};

type LoadRequest = { lat?: number; lng?: number; radius?: number; label?: string; bounds?: string };

const categories = [
  ["All", Compass],
  ["Food", Utensils],
  ["Drinks", Wine],
  ["Nightlife", Music2],
  ["Events", CalendarDays],
  ["Outdoors", TreePine],
  ["Shopping", ShoppingBag],
] as const;

const FAVORITES_KEY = "lit757-mobile-favorites";
const DEFAULT_CENTER: [number, number] = [-76.17, 36.88];
const score = (venue: Venue) => venue.activity?.score ?? 70;
const coords = (venue: Venue): [number, number] => [Number(venue.lng), Number(venue.lat)];
const valid = (venue: Venue) => {
  const [lng, lat] = coords(venue);
  return Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0;
};
const categoryFor = (venue: Venue) => {
  const text = `${venue.name} ${venue.kind || ""} ${venue.type || ""} ${venue.reason || ""} ${venue.event?.name || ""}`.toLowerCase();
  if (venue.event?.name || venue.kind === "events") return "Events";
  if (/restaurant|food|cafe|pizza|grill|seafood|bakery|burger/.test(text)) return "Food";
  if (/bar|brew|wine|drink|pub|cocktail/.test(text)) return "Drinks";
  if (/club|music|nightlife|dj|lounge/.test(text)) return "Nightlife";
  if (/park|trail|beach|garden|museum|outdoor/.test(text)) return "Outdoors";
  if (/shop|mall|market|store/.test(text)) return "Shopping";
  return "All";
};
const statusFor = (venue: Venue) => score(venue) >= 88 ? "On fire" : score(venue) >= 76 ? "Heating up" : score(venue) >= 60 ? "Active" : "Chill";
const distanceLabel = (value?: number | null) => value == null ? null : value < 0.1 ? "Here" : value < 10 ? `${value.toFixed(1)} mi` : `${Math.round(value)} mi`;
const areaStatus = (district: District) => district.score >= 84 ? "Hot" : district.score >= 70 ? "Busy" : district.score >= 54 ? "Building" : "Calm";

export default function BuzzDesktopHome() {
  const [venues, setVenues] = useState<Venue[]>([]);
  const [districts, setDistricts] = useState<District[]>([]);
  const [selectedDistrictId, setSelectedDistrictId] = useState<string | null>(null);
  const [active, setActive] = useState("All");
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [locationResults, setLocationResults] = useState<LocationResult[]>([]);
  const [searchingLocations, setSearchingLocations] = useState(false);
  const [selected, setSelected] = useState<Venue | null>(null);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(() => new Set());
  const [scopeLabel, setScopeLabel] = useState("available places");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [mapReady, setMapReady] = useState(false);

  const mapEl = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const listRef = useRef<HTMLElement | null>(null);
  const mapSectionRef = useRef<HTMLDivElement | null>(null);
  const selectedRef = useRef<(venueId: string) => void>(() => undefined);

  const selectedDistrict = useMemo(
    () => districts.find(district => district.id === selectedDistrictId) || null,
    [districts, selectedDistrictId],
  );

  const loadNearby = useCallback(async (request: LoadRequest = {}) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ limit: "300" });
      if (request.lat != null) params.set("lat", String(request.lat));
      if (request.lng != null) params.set("lng", String(request.lng));
      if (request.radius != null) params.set("radius", String(request.radius));
      if (request.bounds) params.set("bounds", request.bounds);
      const response = await fetch(`/api/nearby?${params.toString()}`, { cache: "no-store" });
      const payload = await response.json() as Payload;
      if (!response.ok || payload.success === false) throw new Error(payload.error || "Could not load places");
      setVenues(payload.venues || payload.picks || []);
      setScopeLabel(request.label || payload.scope?.label || "available places");
      setSelected(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load places");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    try {
      setFavoriteIds(new Set(JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]") as string[]));
    } catch {
      setFavoriteIds(new Set());
    }
    void loadNearby();
  }, [loadNearby]);

  useEffect(() => {
    let mounted = true;
    const loadDistricts = async () => {
      try {
        const response = await fetch("/api/districts", { cache: "no-store" });
        const payload = await response.json() as { districts?: District[] };
        if (mounted) setDistricts(payload.districts || []);
      } catch {
        if (mounted) setDistricts([]);
      }
    };
    void loadDistricts();
    const interval = window.setInterval(loadDistricts, 5 * 60 * 1000);
    return () => {
      mounted = false;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!searchOpen || query.trim().length < 2) {
      setLocationResults([]);
      setSearchingLocations(false);
      return;
    }
    const timer = window.setTimeout(async () => {
      setSearchingLocations(true);
      try {
        const response = await fetch(`/api/location-search?q=${encodeURIComponent(query.trim())}`, { cache: "no-store" });
        const payload = await response.json() as { results?: LocationResult[] };
        setLocationResults((payload.results || []).slice(0, 6));
      } catch {
        setLocationResults([]);
      } finally {
        setSearchingLocations(false);
      }
    }, 260);
    return () => window.clearTimeout(timer);
  }, [query, searchOpen]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return venues
      .filter(venue => active === "All" || categoryFor(venue) === active)
      .filter(venue => !normalized || `${venue.name} ${venue.city || ""} ${venue.kind || ""} ${venue.type || ""} ${venue.event?.name || ""}`.toLowerCase().includes(normalized))
      .sort((left, right) => score(right) - score(left));
  }, [venues, active, query]);
  const hottest = filtered[0] || venues[0];

  const selectVenue = useCallback((venueId: string) => {
    const venue = venues.find(item => String(item.id) === String(venueId));
    if (!venue) return;
    setSelected(venue);
    if (valid(venue)) mapRef.current?.easeTo({ center: coords(venue), zoom: Math.max(mapRef.current.getZoom(), 13.5), duration: 520 });
  }, [venues]);
  selectedRef.current = selectVenue;

  useEffect(() => {
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!mapEl.current || !token || mapRef.current) return;
    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({
      container: mapEl.current,
      style: "mapbox://styles/mapbox/dark-v11",
      center: DEFAULT_CENTER,
      zoom: 9,
      minZoom: 3,
      maxZoom: 17,
    });
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
    map.on("load", () => setMapReady(true));
    mapRef.current = map;
    return () => {
      setMapReady(false);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || map.getSource("buzz-desktop-venues")) return;
    const empty: GeoJSON.FeatureCollection<GeoJSON.Point> = { type: "FeatureCollection", features: [] };
    map.addSource("buzz-desktop-venues", { type: "geojson", data: empty, cluster: true, clusterMaxZoom: 12.5, clusterRadius: 68 });
    const heatColor: any = ["interpolate", ["linear"], ["get", "score"], 0, "#667085", 45, "#3DDC97", 60, "#C6E84B", 72, "#FFD54A", 82, "#FF9F43", 90, "#FF5C5C"];
    map.addLayer({ id: "buzz-desktop-clusters", type: "circle", source: "buzz-desktop-venues", filter: ["has", "point_count"], paint: { "circle-color": ["step", ["get", "point_count"], "#FFD54A", 18, "#FF9F43", 45, "#FF5C5C"], "circle-radius": ["step", ["get", "point_count"], 18, 18, 22, 45, 27], "circle-stroke-width": 2, "circle-stroke-color": "#fff" } });
    map.addLayer({ id: "buzz-desktop-cluster-count", type: "symbol", source: "buzz-desktop-venues", filter: ["has", "point_count"], layout: { "text-field": ["get", "point_count_abbreviated"], "text-size": 11 }, paint: { "text-color": "#101114" } });
    map.addLayer({ id: "buzz-desktop-halo", type: "circle", source: "buzz-desktop-venues", filter: ["!", ["has", "point_count"]], paint: { "circle-radius": ["case", ["==", ["get", "selected"], true], 22, ["interpolate", ["linear"], ["get", "score"], 40, 9, 100, 17]], "circle-color": heatColor, "circle-opacity": ["case", ["==", ["get", "selected"], true], .34, .16], "circle-blur": .8 } });
    map.addLayer({ id: "buzz-desktop-pins", type: "circle", source: "buzz-desktop-venues", filter: ["!", ["has", "point_count"]], paint: { "circle-radius": ["case", ["==", ["get", "selected"], true], 12, 8], "circle-color": heatColor, "circle-stroke-width": ["case", ["==", ["get", "selected"], true], 3, 1.5], "circle-stroke-color": "#fff" } });
    map.addLayer({ id: "buzz-desktop-score", type: "symbol", source: "buzz-desktop-venues", filter: ["!", ["has", "point_count"]], minzoom: 12.8, layout: { "text-field": ["to-string", ["get", "score"]], "text-size": 9 }, paint: { "text-color": "#fff" } });
    map.addLayer({ id: "buzz-desktop-hitbox", type: "circle", source: "buzz-desktop-venues", filter: ["!", ["has", "point_count"]], paint: { "circle-radius": 22, "circle-color": "rgba(0,0,0,.01)", "circle-opacity": .01 } });

    const onVenueClick = (event: mapboxgl.MapLayerMouseEvent) => {
      const id = String(event.features?.[0]?.properties?.id || "");
      if (id) selectedRef.current(id);
    };
    const onClusterClick = (event: mapboxgl.MapLayerMouseEvent) => {
      const feature = event.features?.[0];
      const clusterId = feature?.properties?.cluster_id;
      if (clusterId == null || feature?.geometry.type !== "Point") return;
      (map.getSource("buzz-desktop-venues") as mapboxgl.GeoJSONSource).getClusterExpansionZoom(clusterId, (clusterError, zoom) => {
        if (!clusterError && zoom != null) map.easeTo({ center: feature.geometry.coordinates as [number, number], zoom, duration: 460 });
      });
    };
    const enter = () => { map.getCanvas().style.cursor = "pointer"; };
    const leave = () => { map.getCanvas().style.cursor = ""; };
    map.on("click", "buzz-desktop-hitbox", onVenueClick);
    map.on("click", "buzz-desktop-clusters", onClusterClick);
    map.on("mouseenter", "buzz-desktop-hitbox", enter);
    map.on("mouseleave", "buzz-desktop-hitbox", leave);
    map.on("mouseenter", "buzz-desktop-clusters", enter);
    map.on("mouseleave", "buzz-desktop-clusters", leave);
    return () => {
      if (!map.getLayer("buzz-desktop-hitbox")) return;
      map.off("click", "buzz-desktop-hitbox", onVenueClick);
      map.off("click", "buzz-desktop-clusters", onClusterClick);
      map.off("mouseenter", "buzz-desktop-hitbox", enter);
      map.off("mouseleave", "buzz-desktop-hitbox", leave);
      map.off("mouseenter", "buzz-desktop-clusters", enter);
      map.off("mouseleave", "buzz-desktop-clusters", leave);
    };
  }, [mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    const source = map?.getSource("buzz-desktop-venues") as mapboxgl.GeoJSONSource | undefined;
    if (!map || !source) return;
    const features: GeoJSON.Feature<GeoJSON.Point>[] = filtered.filter(valid).map(venue => ({ type: "Feature", geometry: { type: "Point", coordinates: coords(venue) }, properties: { id: venue.id, name: venue.name, score: score(venue), selected: venue.id === selected?.id } }));
    source.setData({ type: "FeatureCollection", features });
  }, [filtered, selected?.id, mapReady]);

  function toggleFavorite(event: MouseEvent, venue: Venue) {
    event.stopPropagation();
    setFavoriteIds(current => {
      const next = new Set(current);
      next.has(venue.id) ? next.delete(venue.id) : next.add(venue.id);
      localStorage.setItem(FAVORITES_KEY, JSON.stringify([...next]));
      return next;
    });
  }

  async function chooseDistrict(district: District | null) {
    setSelectedDistrictId(district?.id || null);
    setActive("All");
    setQuery("");
    setSearchOpen(false);
    if (!district) {
      mapRef.current?.easeTo({ center: DEFAULT_CENTER, zoom: 9, duration: 650 });
      await loadNearby();
      return;
    }
    mapRef.current?.easeTo({ center: [district.center.lng, district.center.lat], zoom: 12.1, duration: 650 });
    await loadNearby({
      lat: district.center.lat,
      lng: district.center.lng,
      radius: Math.max(2, district.radiusMiles),
      label: `in ${district.shortName}`,
    });
  }

  function useLocation() {
    if (!navigator.geolocation) {
      setError("Location is not available in this browser.");
      return;
    }
    setLoading(true);
    setSelectedDistrictId(null);
    navigator.geolocation.getCurrentPosition(
      position => {
        const latitude = position.coords.latitude;
        const longitude = position.coords.longitude;
        mapRef.current?.easeTo({ center: [longitude, latitude], zoom: 13.5, duration: 700 });
        void loadNearby({ lat: latitude, lng: longitude, radius: 10, label: "within 10 miles" });
      },
      () => {
        setLoading(false);
        setError("We could not access your location. Search a city or ZIP instead.");
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    );
  }

  async function chooseLocation(result: LocationResult) {
    setSearchOpen(false);
    setQuery("");
    setSelectedDistrictId(null);
    if (result.bbox?.length === 4) {
      mapRef.current?.fitBounds([[result.bbox[0], result.bbox[1]], [result.bbox[2], result.bbox[3]]], { padding: 70, maxZoom: 13.5, duration: 700 });
    } else {
      mapRef.current?.easeTo({ center: [result.longitude, result.latitude], zoom: 13.5, duration: 700 });
    }
    await loadNearby({ lat: result.latitude, lng: result.longitude, radius: 10, label: `in ${result.name}` });
  }

  function searchThisMap() {
    const bounds = mapRef.current?.getBounds();
    if (!bounds) return;
    setSelectedDistrictId(null);
    void loadNearby({ bounds: [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()].join(","), label: "in this map area" });
  }

  function openDirections(venue: Venue) {
    const destination = venue.address || `${venue.lat},${venue.lng}`;
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`, "_blank");
  }

  return (
    <div className="buzz-desktop">
      <header className="buzz-desktop-header">
        <button type="button" className="buzz-desktop-logo" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}><b>BUZZ</b><span>THINGS TO DO NOW</span></button>
        <div className="buzz-desktop-search"><Search /><input value={query} onChange={event => { setQuery(event.target.value); setSearchOpen(true); }} onFocus={() => setSearchOpen(true)} placeholder="Search places, events, neighborhoods, or ZIP codes" /><button type="button" onClick={useLocation}><LocateFixed /> Near me</button></div>
        <nav><button type="button" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>Explore</button><button type="button" onClick={() => { setActive("Events"); listRef.current?.scrollIntoView({ behavior: "smooth" }); }}>Events</button><button type="button" onClick={() => listRef.current?.scrollIntoView({ behavior: "smooth" })}>Trending</button><button type="button" onClick={() => mapSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })}>Map</button><button type="button" aria-label="Buzz alerts"><Bell /></button><button type="button" className="buzz-desktop-avatar" aria-label="Profile"><UserRound /></button></nav>
      </header>

      {searchOpen && (
        <div className="buzz-desktop-search-panel">
          <div className="buzz-search-panel-head"><div><strong>{query ? `Search “${query}”` : "Popular right now"}</strong><small>Places and areas</small></div><button type="button" onClick={() => setSearchOpen(false)}><X /></button></div>
          {filtered.slice(0, 6).map(venue => <button type="button" key={venue.id} onClick={() => { selectVenue(venue.id); setSearchOpen(false); }}><i>{venue.name.slice(0, 1)}</i><span><strong>{venue.name}</strong><small>{venue.city || "Nearby"} · {venue.event?.name || venue.reason || categoryFor(venue)}</small></span><b>{score(venue)}</b></button>)}
          {searchingLocations && <p>Searching areas…</p>}
          {locationResults.length > 0 && <div className="buzz-location-results"><em>AREAS & ZIP CODES</em>{locationResults.map(result => <button type="button" key={result.id} onClick={() => void chooseLocation(result)}><MapPin /><span><strong>{result.name}</strong><small>{result.detail}</small></span><ChevronRight /></button>)}</div>}
          {!searchingLocations && query.length >= 2 && !filtered.length && !locationResults.length && <p>No match yet. Try a city, ZIP, venue, or category.</p>}
        </div>
      )}

      <main>
        <section className="buzz-desktop-hero">
          <div><span className="buzz-eyebrow"><i /> LIVE ACTIVITY AROUND YOU</span><h1>See where the energy is—<em>right now.</em></h1><p>Buzz helps you discover things to do in the moment.</p><div className="buzz-hero-actions"><button type="button" onClick={() => setSearchOpen(true)}><Search /> Search what’s happening</button><button type="button" onClick={useLocation}><LocateFixed /> Use my location</button></div></div>
          <button type="button" className="buzz-desktop-best" onClick={() => hottest && selectVenue(hottest.id)} disabled={!hottest}><span>BEST MOVE RIGHT NOW</span><strong>{hottest?.name || "Finding your move…"}</strong><small>{hottest?.city || scopeLabel} · {hottest ? statusFor(hottest) : "Loading"}</small><b>{hottest ? score(hottest) : "--"}<em>BUZZ</em></b><ChevronRight /></button>
        </section>

        <section className="buzz-desktop-value"><div><Sparkles /><span><strong>Buzz Score</strong><small>How active a place feels right now</small></span></div><div><MapPin /><span><strong>Location-first</strong><small>Search any city, neighborhood, or ZIP</small></span></div><div><Bell /><span><strong>Smart alerts</strong><small>Know when saved places heat up</small></span></div></section>

        <section className="buzz-desktop-categories" aria-label="Place categories">{categories.map(([name, Icon]) => <button type="button" key={name} className={active === name ? "active" : ""} onClick={() => setActive(name)} aria-pressed={active === name}><span><Icon /></span><strong>{name}</strong></button>)}</section>

        {error && <button type="button" className="buzz-desktop-error" onClick={() => void loadNearby()}>{error} · Retry</button>}

        <section className="buzz-desktop-discovery">
          <section ref={listRef} className="buzz-desktop-list">
            {districts.length > 0 && (
              <div className="buzz-area-picker">
                <div className="buzz-area-picker-head"><span><MapPinned /> PICK AN AREA</span><small>Choose an area to see places there.</small></div>
                <div className="buzz-area-picker-rail">
                  <button type="button" className={!selectedDistrict ? "active" : ""} onClick={() => void chooseDistrict(null)}><strong>All 757</strong><small>Everywhere</small></button>
                  {districts.map(district => (
                    <button type="button" key={district.id} className={selectedDistrictId === district.id ? "active" : ""} onClick={() => void chooseDistrict(district)}>
                      <strong>{district.shortName}</strong><small>{areaStatus(district)}</small>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="buzz-section-heading"><div><span>{selectedDistrict ? "IN THIS AREA" : "HAPPENING NOW"}</span><h2>{selectedDistrict?.shortName || "Things to do nearby"}</h2><p>{loading ? "Refreshing activity…" : `${filtered.length} places ${scopeLabel}`}</p></div><button type="button" onClick={() => setSearchOpen(true)}>Search all <ChevronRight /></button></div>
            {filtered.length ? <div className="buzz-desktop-card-grid">{filtered.slice(0, 12).map((venue, index) => <article key={venue.id} onClick={() => selectVenue(venue.id)}><div className="buzz-card-photo">{venue.photoUrl ? <img src={venue.photoUrl} alt="" /> : <span>{venue.name[0]}</span>}<div><b>{score(venue)}</b><small>BUZZ</small></div>{index === 0 && <em>BEST NOW</em>}</div><div className="buzz-card-copy"><small>{categoryFor(venue)} · {distanceLabel(venue.distanceMiles) || venue.city || "Nearby"}</small><h3>{venue.name}</h3><p>{venue.event?.name || venue.reason || "Available to do right now"}</p><span>{statusFor(venue)} · {venue.activity?.trendLabel || "Steady"}</span></div><button type="button" className={favoriteIds.has(venue.id) ? "saved" : ""} onClick={event => toggleFavorite(event, venue)} aria-label={favoriteIds.has(venue.id) ? `Remove ${venue.name} from saved places` : `Save ${venue.name}`}><Heart fill={favoriteIds.has(venue.id) ? "currentColor" : "none"} /></button></article>)}</div> : <div className="buzz-desktop-empty"><Search /><strong>No places match this view</strong><p>Try another category, clear the search, or choose a different area.</p></div>}
          </section>

          <div ref={mapSectionRef} className="buzz-desktop-map-wrap"><div className="buzz-map-toolbar"><button type="button" onClick={useLocation}><LocateFixed /> Near me</button><button type="button" onClick={searchThisMap}><Search /> Search this map</button><span>{selectedDistrict?.shortName || `${filtered.length} places`}</span></div><div className="buzz-desktop-map-hint">Click a place to see what is happening now</div><div ref={mapEl} className="buzz-desktop-map" /></div>
        </section>
      </main>

      {selected && (
        <aside className="buzz-desktop-detail">
          <button type="button" className="buzz-detail-close" onClick={() => setSelected(null)}><X /></button>
          <span>{statusFor(selected).toUpperCase()}</span><h2>{selected.name}</h2><p>{distanceLabel(selected.distanceMiles) || selected.city || "Nearby"} · {selected.openNow === false ? "Closed" : "Open now"}</p>
          <div className="buzz-detail-score"><b>{score(selected)}</b><small>BUZZ SCORE</small><em>{selected.activity?.trendLabel || "Steady"}</em></div>
          <div className="buzz-detail-why"><Sparkles /><div><strong>Why the Buzz?</strong><p>{selected.event?.name ? `${selected.event.name} is driving activity. ` : ""}{selected.reason || "Strong live activity and nearby interest."}</p></div></div>
          <div className="buzz-desktop-detail-actions"><button type="button" onClick={event => toggleFavorite(event, selected)}><Heart fill={favoriteIds.has(selected.id) ? "currentColor" : "none"} />{favoriteIds.has(selected.id) ? "Saved" : "Save"}</button><button type="button" onClick={() => openDirections(selected)}><Navigation /> Get directions</button></div>
        </aside>
      )}
    </div>
  );
}
