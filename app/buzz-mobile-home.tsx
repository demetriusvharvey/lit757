"use client";

import {
  FormEvent,
  KeyboardEvent,
  MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import "./buzz-mobile.css";
import {
  Bell,
  Bookmark,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Compass,
  Heart,
  HelpCircle,
  Info,
  LogOut,
  Map as MapIcon,
  MapPin,
  Music2,
  Navigation,
  Search,
  Send,
  ShoppingBag,
  Sparkles,
  TreePine,
  UserRound,
  Utensils,
  Wine,
  X,
} from "lucide-react";
import { useMapController } from "./map-controller";
import { RemoteVenueImage } from "./components/remote-venue-image";

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
  event?: { name?: string | null; sourceUrl?: string | null; url?: string | null } | null;
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
  featureType: string;
  longitude: number;
  latitude: number;
  bbox: number[] | null;
};

type MobileTab = "explore" | "map" | "favorites" | "alerts" | "ai";
type VenueAlert = { venueId: string; threshold: number };
type SpatialRequest = { lat?: number; lng?: number; radius?: number; bounds?: string; q?: string; category?: string; label?: string };
type TapCycle = { ids: string[]; index: number; x: number; y: number; at: number };

const categories = [
  ["All", Compass],
  ["Food", Utensils],
  ["Drinks", Wine],
  ["Nightlife", Music2],
  ["Events", CalendarDays],
  ["Outdoors", TreePine],
  ["Shopping", ShoppingBag],
] as const;
const prompts = ["Date night under $100", "Live music tonight", "Something fun with kids", "Drinks then dancing"];
const FAVORITES_KEY = "lit757-mobile-favorites";
const ALERTS_KEY = "lit757-mobile-alerts";
const VENUE_ALERTS_KEY = "lit757-venue-alerts";
const RADIUS_KEY = "lit757-nearby-radius";
const TAP_RADIUS_PX = 26;

const score = (venue: Venue) => venue.activity?.score ?? 70;
const coords = (venue: Venue): [number, number] => [Number(venue.lng), Number(venue.lat)];
const validVenue = (venue: Venue) => {
  const [lng, lat] = coords(venue);
  return Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0;
};
const categoryFor = (venue: Venue) => {
  const text = `${venue.name} ${venue.reason || ""} ${venue.event?.name || ""} ${venue.kind || ""} ${venue.type || ""}`.toLowerCase();
  if (venue.event?.name || venue.kind === "events") return "Events";
  if (/restaurant|diner|cafe|pizza|grill|kitchen|food|taco|burger|bakery|seafood/.test(text)) return "Food";
  if (/bar|brew|cocktail|wine|drink|pub/.test(text)) return "Drinks";
  if (/club|dj|music|nightlife|lounge/.test(text)) return "Nightlife";
  if (/park|trail|beach|garden|outdoor|museum/.test(text)) return "Outdoors";
  if (/shop|mall|market|store/.test(text)) return "Shopping";
  return "All";
};
const trendPercent = (venue: Venue) => Math.max(3, Math.min(31, Math.round((score(venue) - 48) / 2)));
const statusFor = (venue: Venue) => score(venue) >= 88 ? "On fire" : score(venue) >= 76 ? "Heating up" : score(venue) >= 60 ? "Active" : "Chill";
const milesLabel = (value?: number | null) => value == null ? null : value < 0.1 ? "Here" : value < 10 ? `${value.toFixed(1)} mi` : `${Math.round(value)} mi`;

export default function BuzzMobileHome() {
  const { setMap, userLocation, selectedVenueId, setSelectedVenueId } = useMapController();
  const [venues, setVenues] = useState<Venue[]>([]);
  const [active, setActive] = useState("All");
  const [activeTab, setActiveTab] = useState<MobileTab>("explore");
  const [selected, setSelected] = useState<Venue | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [plannerOpen, setPlannerOpen] = useState(false);
  const [plannerQuery, setPlannerQuery] = useState("");
  const [plannerTitle, setPlannerTitle] = useState("");
  const [plannerResults, setPlannerResults] = useState<Venue[]>([]);
  const [plannerLoading, setPlannerLoading] = useState(false);
  const [plannerError, setPlannerError] = useState("");
  const [favoritesOpen, setFavoritesOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchVenues, setSearchVenues] = useState<Venue[]>([]);
  const [searchLocations, setSearchLocations] = useState<LocationResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(() => new Set());
  const [alertsEnabled, setAlertsEnabled] = useState(false);
  const [venueAlerts, setVenueAlerts] = useState<VenueAlert[]>([]);
  const [alertMessage, setAlertMessage] = useState("");
  const [radius, setRadius] = useState(3);
  const [scopeLabel, setScopeLabel] = useState("near you");
  const [scopeLoading, setScopeLoading] = useState(false);
  const [scopeError, setScopeError] = useState("");
  const [searchAreaVisible, setSearchAreaVisible] = useState(false);
  const [mapReady, setMapReady] = useState(false);

  const mapEl = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLElement | null>(null);
  const feedRef = useRef<HTMLElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const mappedRef = useRef<Venue[]>([]);
  const selectVenueRef = useRef<(venueId: string) => void>(() => undefined);
  const userMoveRef = useRef(false);
  const lastLocationKeyRef = useRef("");
  const tapCycleRef = useRef<TapCycle | null>(null);

  const loadSpatial = useCallback(async (request: SpatialRequest = {}) => {
    setScopeLoading(true);
    setScopeError("");
    try {
      const params = new URLSearchParams();
      if (request.lat != null) params.set("lat", String(request.lat));
      if (request.lng != null) params.set("lng", String(request.lng));
      if (request.radius != null) params.set("radius", String(request.radius));
      if (request.bounds) params.set("bounds", request.bounds);
      if (request.q) params.set("q", request.q);
      if (request.category && request.category !== "All") params.set("category", request.category);
      const response = await fetch(`/api/nearby?${params.toString()}`, { cache: "no-store" });
      const payload = await response.json() as Payload;
      if (!response.ok || payload.success === false) throw new Error(payload.error || "Could not load this area");
      setVenues(payload.venues || payload.picks || []);
      setScopeLabel(request.label || payload.scope?.label || "near you");
      setSelected(null);
      setSelectedVenueId(null);
      setDetailsOpen(false);
      window.dispatchEvent(new CustomEvent("activity757:discovery", { detail: payload }));
    } catch (error) {
      setScopeError(error instanceof Error ? error.message : "Could not refresh nearby places");
    } finally {
      setScopeLoading(false);
    }
  }, [setSelectedVenueId]);

  useEffect(() => {
    try {
      // Persisted preferences are client-only; hydrate them after SSR to keep
      // the initial markup stable.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFavoriteIds(new Set(JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]") as string[]));
      setAlertsEnabled(localStorage.getItem(ALERTS_KEY) === "true");
      setVenueAlerts(JSON.parse(localStorage.getItem(VENUE_ALERTS_KEY) || "[]") as VenueAlert[]);
      const savedRadius = Number(localStorage.getItem(RADIUS_KEY) || 3);
      if ([1, 3, 10, 25].includes(savedRadius)) setRadius(savedRadius);
    } catch {
      // Safe defaults are already active.
    }
    void loadSpatial();
  }, [loadSpatial]);

  useEffect(() => {
    if (!userLocation) return;
    const key = `${userLocation.latitude.toFixed(4)}:${userLocation.longitude.toFixed(4)}:${radius}`;
    if (lastLocationKeyRef.current === key) return;
    lastLocationKeyRef.current = key;
    void loadSpatial({ lat: userLocation.latitude, lng: userLocation.longitude, radius, label: `within ${radius} mile${radius === 1 ? "" : "s"}` });
  }, [userLocation, radius, loadSpatial]);

  useEffect(() => {
    if (!searchOpen || searchQuery.trim().length < 2) {
      // Results are scoped to an open, valid search query.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSearchVenues([]);
      setSearchLocations([]);
      setSearchLoading(false);
      return;
    }
    const timer = window.setTimeout(async () => {
      setSearchLoading(true);
      const query = searchQuery.trim();
      try {
        const [venueResponse, locationResponse] = await Promise.all([
          fetch(`/api/nearby?q=${encodeURIComponent(query)}&limit=8`, { cache: "no-store" }),
          fetch(`/api/location-search?q=${encodeURIComponent(query)}`, { cache: "no-store" }),
        ]);
        const venuePayload = await venueResponse.json() as Payload;
        const locationPayload = await locationResponse.json() as { results?: LocationResult[] };
        setSearchVenues((venuePayload.venues || venuePayload.picks || []).slice(0, 8));
        setSearchLocations((locationPayload.results || []).slice(0, 8));
      } catch {
        setSearchVenues([]);
        setSearchLocations([]);
      } finally {
        setSearchLoading(false);
      }
    }, 260);
    return () => window.clearTimeout(timer);
  }, [searchOpen, searchQuery]);

  const filtered = useMemo(
    () => [...venues].filter(venue => active === "All" || categoryFor(venue) === active).sort((left, right) => score(right) - score(left)),
    [venues, active],
  );
  const mapped = useMemo(() => filtered.filter(validVenue), [filtered]);
  useEffect(() => {
    // Mapbox callbacks outlive individual React renders.
    mappedRef.current = mapped;
  }, [mapped]);
  const favorites = useMemo(() => venues.filter(venue => favoriteIds.has(venue.id)), [venues, favoriteIds]);
  const hottest = filtered[0];
  const activePlaces = filtered.filter(venue => score(venue) >= 52 && venue.openNow !== false).length;
  const rising = filtered.filter(venue => venue.activity?.trendLabel?.toLowerCase().includes("busier") || score(venue) >= 76).length;
  const pulseText = active === "All" ? `${activePlaces} active places ${scopeLabel}` : `${activePlaces} active ${active.toLowerCase()} spots ${scopeLabel}`;
  const mapMode = activeTab === "map";
  const selectedAlert = selected ? venueAlerts.some(alert => alert.venueId === selected.id) : false;

  const selectVenueById = useCallback((venueId: string) => {
    const venue = mappedRef.current.find(item => String(item.id) === String(venueId));
    if (!venue) return;
    setSelected(venue);
    setSelectedVenueId(venue.id);
    setDetailsOpen(false);
    if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(10);
    const map = mapRef.current;
    if (map) map.easeTo({ center: coords(venue), zoom: Math.max(map.getZoom(), 13), duration: 480 });
  }, [setSelectedVenueId]);
  useEffect(() => {
    selectVenueRef.current = selectVenueById;
  }, [selectVenueById]);

  useEffect(() => {
    if (!selectedVenueId || selected?.id === selectedVenueId) return;
    const venue = mappedRef.current.find(item => String(item.id) === String(selectedVenueId));
    if (venue) {
      setSelected(venue);
      setDetailsOpen(false);
    }
  }, [selectedVenueId, selected?.id]);

  useEffect(() => {
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!mapEl.current || !token || mapRef.current) return;
    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({
      container: mapEl.current,
      style: "mapbox://styles/mapbox/dark-v11",
      center: [-76.17, 36.88],
      zoom: 8.6,
      minZoom: 3,
      maxZoom: 17,
      attributionControl: true,
    });
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
    const onMoveStart = (event: { originalEvent?: unknown }) => {
      if (event.originalEvent) userMoveRef.current = true;
    };
    const onMoveEnd = () => {
      if (!userMoveRef.current) return;
      userMoveRef.current = false;
      setSearchAreaVisible(true);
    };
    const onLoad = () => setMapReady(true);
    map.on("movestart", onMoveStart);
    map.on("moveend", onMoveEnd);
    map.on("load", onLoad);
    mapRef.current = map;
    setMap(map);
    return () => {
      map.off("movestart", onMoveStart);
      map.off("moveend", onMoveEnd);
      map.off("load", onLoad);
      setMapReady(false);
      setMap(null);
      map.remove();
      mapRef.current = null;
    };
  }, [setMap]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || map.getSource("buzz-mobile-venues")) return;
    const empty: GeoJSON.FeatureCollection<GeoJSON.Point> = { type: "FeatureCollection", features: [] };
    map.addSource("buzz-mobile-venues", { type: "geojson", data: empty, cluster: true, clusterMaxZoom: 12.5, clusterRadius: 66 });
    const heatColor: mapboxgl.ExpressionSpecification = ["interpolate", ["linear"], ["get", "score"], 0, "#667085", 45, "#3DDC97", 60, "#C6E84B", 72, "#FFD54A", 82, "#FF9F43", 90, "#FF5C5C"];
    map.addLayer({ id: "buzz-mobile-clusters", type: "circle", source: "buzz-mobile-venues", filter: ["has", "point_count"], paint: { "circle-color": ["step", ["get", "point_count"], "#FFD54A", 15, "#FF9F43", 40, "#FF5C5C"], "circle-radius": ["step", ["get", "point_count"], 16, 15, 20, 40, 24], "circle-stroke-width": 2, "circle-stroke-color": "rgba(255,255,255,.9)" } });
    map.addLayer({ id: "buzz-mobile-cluster-count", type: "symbol", source: "buzz-mobile-venues", filter: ["has", "point_count"], layout: { "text-field": ["get", "point_count_abbreviated"], "text-size": 11 }, paint: { "text-color": "#101114" } });
    map.addLayer({ id: "buzz-mobile-pin-halo", type: "circle", source: "buzz-mobile-venues", filter: ["!", ["has", "point_count"]], paint: { "circle-radius": ["case", ["==", ["get", "selected"], true], 20, ["interpolate", ["linear"], ["get", "score"], 40, 8, 100, 16]], "circle-color": heatColor, "circle-opacity": ["case", ["==", ["get", "selected"], true], .32, .16], "circle-blur": .78 } });
    map.addLayer({ id: "buzz-mobile-pins", type: "circle", source: "buzz-mobile-venues", filter: ["!", ["has", "point_count"]], paint: { "circle-radius": ["case", ["==", ["get", "selected"], true], 10.5, ["interpolate", ["linear"], ["zoom"], 7, 5, 12, 6.5, 16, 8]], "circle-color": heatColor, "circle-stroke-width": ["case", ["==", ["get", "selected"], true], 3, 1.5], "circle-stroke-color": "#FFFFFF" } });
    map.addLayer({ id: "buzz-mobile-score", type: "symbol", source: "buzz-mobile-venues", filter: ["!", ["has", "point_count"]], minzoom: 13.3, layout: { "text-field": ["to-string", ["get", "score"]], "text-size": 8.5 }, paint: { "text-color": "#FFFFFF" } });
    map.addLayer({ id: "buzz-mobile-hitbox", type: "circle", source: "buzz-mobile-venues", filter: ["!", ["has", "point_count"]], paint: { "circle-radius": TAP_RADIUS_PX, "circle-color": "rgba(0,0,0,.01)", "circle-opacity": .01 } });

    const chooseFromTap = (event: mapboxgl.MapLayerMouseEvent) => {
      const box: [mapboxgl.PointLike, mapboxgl.PointLike] = [
        [event.point.x - TAP_RADIUS_PX, event.point.y - TAP_RADIUS_PX],
        [event.point.x + TAP_RADIUS_PX, event.point.y + TAP_RADIUS_PX],
      ];
      const unique = new globalThis.Map<string, { id: string; distance: number }>();
      for (const feature of map.queryRenderedFeatures(box, { layers: ["buzz-mobile-hitbox"] })) {
        const id = String(feature.properties?.id || "");
        if (!id || feature.geometry.type !== "Point") continue;
        const point = map.project(feature.geometry.coordinates as [number, number]);
        const distance = Math.hypot(point.x - event.point.x, point.y - event.point.y);
        const current = unique.get(id);
        if (!current || distance < current.distance) unique.set(id, { id, distance });
      }
      const ids = [...unique.values()].sort((left, right) => left.distance - right.distance).map(item => item.id);
      if (!ids.length) return;
      const previous = tapCycleRef.current;
      const repeated = Boolean(previous && Date.now() - previous.at < 1400 && Math.hypot(previous.x - event.point.x, previous.y - event.point.y) < 20 && previous.ids.join("|") === ids.join("|"));
      const index = repeated && previous ? (previous.index + 1) % ids.length : 0;
      tapCycleRef.current = { ids, index, x: event.point.x, y: event.point.y, at: Date.now() };
      selectVenueRef.current(ids[index]);
    };
    const expandCluster = (event: mapboxgl.MapLayerMouseEvent) => {
      const feature = event.features?.[0];
      const clusterId = feature?.properties?.cluster_id;
      if (clusterId == null || feature?.geometry.type !== "Point") return;
      const center = feature.geometry.coordinates as [number, number];
      (map.getSource("buzz-mobile-venues") as mapboxgl.GeoJSONSource).getClusterExpansionZoom(clusterId, (clusterError, zoom) => {
        if (!clusterError && zoom != null) map.easeTo({ center, zoom, duration: 450 });
      });
    };
    const onEnter = () => { map.getCanvas().style.cursor = "pointer"; };
    const onLeave = () => { map.getCanvas().style.cursor = ""; };
    map.on("click", "buzz-mobile-hitbox", chooseFromTap);
    map.on("click", "buzz-mobile-clusters", expandCluster);
    map.on("mouseenter", "buzz-mobile-hitbox", onEnter);
    map.on("mouseleave", "buzz-mobile-hitbox", onLeave);
    map.on("mouseenter", "buzz-mobile-clusters", onEnter);
    map.on("mouseleave", "buzz-mobile-clusters", onLeave);
    return () => {
      if (!map.getLayer("buzz-mobile-hitbox")) return;
      map.off("click", "buzz-mobile-hitbox", chooseFromTap);
      map.off("click", "buzz-mobile-clusters", expandCluster);
      map.off("mouseenter", "buzz-mobile-hitbox", onEnter);
      map.off("mouseleave", "buzz-mobile-hitbox", onLeave);
      map.off("mouseenter", "buzz-mobile-clusters", onEnter);
      map.off("mouseleave", "buzz-mobile-clusters", onLeave);
    };
  }, [mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    const source = map?.getSource("buzz-mobile-venues") as mapboxgl.GeoJSONSource | undefined;
    if (!map || !source) return;
    const features: GeoJSON.Feature<GeoJSON.Point>[] = mapped.map(venue => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: coords(venue) },
      properties: { id: venue.id, name: venue.name, score: score(venue), selected: venue.id === selectedVenueId },
    }));
    source.setData({ type: "FeatureCollection", features });
  }, [mapped, selectedVenueId, mapReady]);

  function selectCategory(label: string) {
    setActive(label);
    setActiveTab("explore");
    window.setTimeout(() => feedRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 140);
  }
  function openVenue(venue: Venue) {
    setSelected(venue);
    setSelectedVenueId(venue.id);
    setDetailsOpen(true);
    if (validVenue(venue)) mapRef.current?.easeTo({ center: coords(venue), zoom: 13.5, duration: 480 });
  }
  function toggleFavorite(event: MouseEvent, venue: Venue) {
    event.stopPropagation();
    setFavoriteIds(current => {
      const next = new Set(current);
      if (next.has(venue.id)) next.delete(venue.id);
      else next.add(venue.id);
      localStorage.setItem(FAVORITES_KEY, JSON.stringify([...next]));
      return next;
    });
  }
  function handlePreviewKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setDetailsOpen(true);
    }
  }
  async function enableAlerts() {
    setAlertMessage("");
    if (typeof Notification === "undefined") {
      setAlertMessage("Notifications are not supported in this browser yet.");
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setAlertMessage("Notifications were not allowed.");
      return;
    }
    setAlertsEnabled(true);
    localStorage.setItem(ALERTS_KEY, "true");
    setAlertMessage("Buzz alerts are ready on this device.");
  }
  function toggleVenueAlert(venue: Venue) {
    setVenueAlerts(current => {
      const next = current.some(alert => alert.venueId === venue.id)
        ? current.filter(alert => alert.venueId !== venue.id)
        : [...current, { venueId: venue.id, threshold: 80 }];
      localStorage.setItem(VENUE_ALERTS_KEY, JSON.stringify(next));
      return next;
    });
  }
  async function searchThisArea() {
    const map = mapRef.current;
    if (!map) return;
    const bounds = map.getBounds();
    setSearchAreaVisible(false);
    await loadSpatial({ bounds: [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()].join(","), label: "in this map area" });
  }
  function changeRadius(value: number) {
    setRadius(value);
    localStorage.setItem(RADIUS_KEY, String(value));
    if (!userLocation && mapRef.current) {
      const center = mapRef.current.getCenter();
      void loadSpatial({ lat: center.lat, lng: center.lng, radius: value, label: `within ${value} mile${value === 1 ? "" : "s"}` });
    }
  }
  async function chooseLocation(result: LocationResult) {
    setSearchOpen(false);
    setSearchQuery("");
    setSearchAreaVisible(false);
    const map = mapRef.current;
    if (result.bbox?.length === 4) map?.fitBounds([[result.bbox[0], result.bbox[1]], [result.bbox[2], result.bbox[3]]], { padding: 42, maxZoom: 14, duration: 650 });
    else map?.easeTo({ center: [result.longitude, result.latitude], zoom: 13.5, duration: 650 });
    await loadSpatial({ lat: result.latitude, lng: result.longitude, radius, label: `in ${result.name}` });
  }
  async function runPlanner(query: string) {
    const clean = query.trim();
    if (!clean) return;
    setPlannerLoading(true);
    setPlannerError("");
    setPlannerTitle(clean);
    try {
      const response = await fetch(`/api/discover?city=All%20757&mode=all&q=${encodeURIComponent(clean)}`, { cache: "no-store" });
      const payload = await response.json() as Payload;
      if (!response.ok) throw new Error(payload.error || "Could not build that plan");
      setPlannerResults((payload.picks || payload.venues || []).slice(0, 3));
    } catch (error) {
      setPlannerError(error instanceof Error ? error.message : "Could not build that plan");
    } finally {
      setPlannerLoading(false);
    }
  }
  function submitPlanner(event: FormEvent) {
    event.preventDefault();
    void runPlanner(plannerQuery);
  }
  function closeOverlays() {
    setFavoritesOpen(false);
    setAlertsOpen(false);
    setProfileOpen(false);
    setSearchOpen(false);
    setActiveTab("explore");
  }

  return (
    <div className="buzz-mobile lg:hidden">
      <header className="buzz-mobile-header">
        <button className="buzz-mobile-brand" type="button" onClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" })} aria-label="Buzz home"><strong>BUZZ</strong><span>LIVE NEARBY</span></button>
        <div className="buzz-mobile-actions"><button type="button" aria-label="Search places and areas" onClick={() => setSearchOpen(true)}><Search /></button><button type="button" aria-label="Saved places" onClick={() => setFavoritesOpen(true)}><Bookmark /></button><button type="button" className="buzz-mobile-avatar" aria-label="Open profile" onClick={() => setProfileOpen(true)}><UserRound /></button></div>
      </header>

      <main ref={scrollRef} className="buzz-mobile-scroll">
        <section className="buzz-mobile-hero">
          <div className="buzz-live-label"><i /> LIVE ACTIVITY <span>Updated now</span></div>
          <h1>See what’s <em>buzzing</em> near you.</h1>
          <p>Food, events, nightlife, and places heating up right now—not last weekend.</p>
          <div className="buzz-mobile-summary"><strong>{pulseText}</strong>{rising > 0 && <span>🔥 {rising} heating up</span>}</div>
          <button type="button" className="buzz-scope-pill" onClick={() => setSearchOpen(true)}><MapPin /> {scopeLabel}<ChevronRight /></button>
          {hottest && <button type="button" className="buzz-best-move" onClick={() => openVenue(hottest)}><span><small>BEST MOVE RIGHT NOW</small><strong>{hottest.name}</strong><em>{hottest.city || "Nearby"} · {statusFor(hottest)}</em></span><b>{score(hottest)}<small>BUZZ</small></b></button>}
        </section>

        <nav className="buzz-category-rail" aria-label="Place categories">{categories.map(([label, Icon]) => <button type="button" key={label} className={active === label ? "active" : ""} onClick={() => selectCategory(label)} aria-pressed={active === label}><span><Icon /></span><small>{label}</small></button>)}</nav>

        <section className={`buzz-mobile-map mobile-native-map${mapMode ? " full" : ""}`} aria-label="Live Buzz map">
          {mapMode && <button type="button" className="buzz-map-close" onClick={() => setActiveTab("explore")} aria-label="Close full map"><ChevronLeft /></button>}
          <div ref={mapEl} className="buzz-mobile-mapbox" />
          <div className="buzz-map-explainer"><Info /> Tap a pin · hotter colors mean more activity</div>
          <label className="buzz-radius-control"><Navigation /><span>Radius</span><select value={radius} onChange={event => changeRadius(Number(event.target.value))} aria-label="Nearby radius"><option value={1}>1 mi</option><option value={3}>3 mi</option><option value={10}>10 mi</option><option value={25}>25 mi</option></select></label>
          {searchAreaVisible && <button type="button" className="buzz-search-area" onClick={() => void searchThisArea()}>Search this area</button>}
          {scopeLoading && <span className="buzz-map-loading" aria-live="polite"><i /> Updating</span>}
          {scopeError && <button type="button" className="buzz-map-error" onClick={() => void loadSpatial()}>{scopeError} · Retry</button>}
          {selected && !detailsOpen && <div className="buzz-map-preview" role="button" tabIndex={0} onKeyDown={handlePreviewKey} onClick={() => setDetailsOpen(true)}><div className="buzz-map-preview-photo"><RemoteVenueImage src={selected.photoUrl} alt="" fallback={selected.name.slice(0, 1)} sizes="58px" /></div><div><span className="buzz-score-ring">{score(selected)}</span><strong>{selected.name}</strong><small>{milesLabel(selected.distanceMiles) || selected.city || "Nearby"} · {statusFor(selected)}</small><p>{selected.event?.name || selected.reason || "Popular nearby right now"}</p></div><ChevronRight /><button type="button" className="buzz-preview-close" onClick={event => { event.stopPropagation(); setSelected(null); setSelectedVenueId(null); }} aria-label="Close venue preview"><X /></button></div>}
        </section>

        <button type="button" className="buzz-ai-card" onClick={() => { setActiveTab("ai"); setPlannerOpen(true); }}><span><Sparkles /></span><div><strong>Not sure where to go?</strong><small>Tell Buzz the vibe, budget, and who’s coming.</small></div><b>Ask Buzz <ChevronRight /></b></button>

        <section ref={feedRef} className="buzz-mobile-feed">
          <header><div><span>TRENDING BY BUZZ</span><h2>{active === "All" ? "Best places right now" : active}</h2></div><b>{filtered.length}</b></header>
          {filtered.length ? <div className="buzz-feed-list">{filtered.map((venue, index) => {
            const distanceOrRank = milesLabel(venue.distanceMiles) || (index === 0 ? "Best move" : `#${index + 1}`);
            return <article className={selectedVenueId === venue.id ? "buzz-feed-row selected" : "buzz-feed-row"} key={venue.id} onClick={() => openVenue(venue)}><div className="buzz-feed-photo"><RemoteVenueImage src={venue.photoUrl} alt="" fallback={venue.name.slice(0, 1)} sizes="70px" /></div><div className="buzz-feed-copy"><strong>{venue.name}</strong><span><b>{statusFor(venue)}</b> · {trendPercent(venue)}% busier</span><small>{venue.event?.name ? `🎟 ${venue.event.name}` : venue.reason || "Popular nearby right now"}</small></div><div className="buzz-feed-meta"><span>{distanceOrRank}</span><div className="buzz-feed-score"><b>{score(venue)}</b><small>BUZZ</small></div><button type="button" className={favoriteIds.has(venue.id) ? "saved" : ""} onClick={event => toggleFavorite(event, venue)} aria-label={favoriteIds.has(venue.id) ? `Remove ${venue.name} from saved places` : `Save ${venue.name}`}><Heart fill={favoriteIds.has(venue.id) ? "currentColor" : "none"} /></button></div></article>;
          })}</div> : <div className="buzz-empty"><Search /><strong>No {active.toLowerCase()} spots found</strong><p>Zoom out, search another area, or try another category.</p></div>}
        </section>
      </main>

      <nav className="buzz-mobile-bottom" aria-label="Primary navigation"><button type="button" className={activeTab === "explore" ? "active" : ""} onClick={() => { setActiveTab("explore"); scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" }); }}><span><Compass /></span><small>Explore</small></button><button type="button" className={activeTab === "map" ? "active" : ""} onClick={() => { setActiveTab("map"); window.setTimeout(() => mapRef.current?.resize(), 120); }}><span><MapIcon /></span><small>Map</small></button><button type="button" className={activeTab === "favorites" ? "active" : ""} onClick={() => { setActiveTab("favorites"); setFavoritesOpen(true); }}><span><Heart /></span><small>Saved</small></button><button type="button" className={activeTab === "alerts" ? "active" : ""} onClick={() => { setActiveTab("alerts"); setAlertsOpen(true); }}><span><Bell />{!alertsEnabled && <i />}</span><small>Alerts</small></button><button type="button" className={activeTab === "ai" ? "active" : ""} onClick={() => { setActiveTab("ai"); setPlannerOpen(true); }}><span><Sparkles /></span><small>Ask Buzz</small></button></nav>

      {detailsOpen && selected && <div className="planner-backdrop" onClick={() => setDetailsOpen(false)}><section className="utility-sheet buzz-detail-sheet" onClick={event => event.stopPropagation()}><div className="planner-handle" /><div className="utility-head"><div><span>{statusFor(selected).toUpperCase()}</span><h2>{selected.name}</h2><p>{milesLabel(selected.distanceMiles) || selected.city || "Nearby"} · {selected.openNow === false ? "Closed" : "Open now"}</p></div><button type="button" onClick={() => setDetailsOpen(false)}><X /></button></div><div className="buzz-detail-metrics"><div><small>BUZZ SCORE</small><strong>{score(selected)}</strong><p>{statusFor(selected)}</p></div><div><small>MOMENTUM</small><strong>+{trendPercent(selected)}%</strong><p>{selected.activity?.trendLabel || "Steady"}</p></div></div><div className="alert-card"><Sparkles /><div><strong>Why the Buzz?</strong><p>{selected.event?.name ? `${selected.event.name} is driving activity. ` : ""}{selected.reason || "Strong activity and nearby interest."}</p></div></div><div className="buzz-detail-actions"><button type="button" onClick={event => toggleFavorite(event, selected)}><Heart fill={favoriteIds.has(selected.id) ? "currentColor" : "none"} />{favoriteIds.has(selected.id) ? "Saved" : "Save"}</button><button type="button" onClick={() => toggleVenueAlert(selected)}><Bell />{selectedAlert ? "Watching" : "Alert at 80+"}</button></div><button type="button" className="alert-action" onClick={() => window.open(`https://www.google.com/maps/dir/?api=1&destination=${selected.lat},${selected.lng}`, "_blank")}><Navigation /> Get directions</button></section></div>}

      {searchOpen && <div className="planner-backdrop" onClick={closeOverlays}><section className="utility-sheet buzz-search-sheet" onClick={event => event.stopPropagation()}><div className="planner-handle" /><div className="utility-head"><div><span>SEARCH THE 757</span><h2>Find a place or area</h2><p>Venue, activity district, or Hampton Roads city.</p></div><button type="button" onClick={closeOverlays}><X /></button></div><form className="buzz-search-form" onSubmit={event => event.preventDefault()}><Search /><input autoFocus value={searchQuery} onChange={event => setSearchQuery(event.target.value)} placeholder="Try Oceanfront, Ghent, or Norfolk…" />{searchQuery && <button type="button" onClick={() => setSearchQuery("")}><X /></button>}</form>{searchLoading && <p className="buzz-search-empty">Searching places and locations…</p>}{!searchLoading && searchVenues.length > 0 && <div className="buzz-search-section"><span>PLACES</span><div>{searchVenues.map(venue => <button type="button" key={venue.id} onClick={() => { setSearchOpen(false); setVenues(current => current.some(item => item.id === venue.id) ? current : [venue, ...current]); openVenue(venue); }}><i>{venue.name.slice(0, 1)}</i><span><strong>{venue.name}</strong><small>{venue.city || venue.type || "Place"}</small></span><em>{score(venue)}</em></button>)}</div></div>}{!searchLoading && searchLocations.length > 0 && <div className="buzz-search-section"><span>HAMPTON ROADS AREAS</span><div>{searchLocations.map(result => <button type="button" key={result.id} onClick={() => void chooseLocation(result)}><i><MapPin /></i><span><strong>{result.name}</strong><small>{result.detail}</small></span><ChevronRight /></button>)}</div></div>}{!searchLoading && searchQuery.length >= 2 && !searchVenues.length && !searchLocations.length && <p className="buzz-search-empty">No match yet. Try a Hampton Roads city, district, category, or venue name.</p>}</section></div>}

      {plannerOpen && <div className="planner-backdrop" onClick={() => setPlannerOpen(false)}><section className="planner-sheet" onClick={event => event.stopPropagation()}><div className="planner-handle" /><div className="planner-head"><div><span>ASK BUZZ</span><h2>What kind of move?</h2><p>Describe the vibe, budget, people, or timing.</p></div><button type="button" onClick={() => setPlannerOpen(false)}><X /></button></div><div className="planner-prompts">{prompts.map(prompt => <button type="button" key={prompt} onClick={() => void runPlanner(prompt)}>{prompt}</button>)}</div><form onSubmit={submitPlanner} className="planner-form"><input value={plannerQuery} onChange={event => setPlannerQuery(event.target.value)} placeholder="Try chill date night near Norfolk" /><button type="submit" disabled={plannerLoading || !plannerQuery.trim()}>{plannerLoading ? <span className="planner-spinner" /> : <Send />}</button></form>{plannerError && <p className="planner-error">{plannerError}</p>}{plannerResults.length > 0 && <div className="planner-results"><div className="planner-result-title"><span>YOUR MOVE</span><strong>{plannerTitle}</strong></div>{plannerResults.map((venue, index) => <button type="button" key={venue.id} onClick={() => { setPlannerOpen(false); openVenue(venue); }}><i>{index + 1}</i><span><strong>{venue.name}</strong><small>{venue.event?.name || venue.reason || venue.city || "Recommended right now"}</small></span><ChevronRight /></button>)}</div>}</section></div>}

      {favoritesOpen && <div className="planner-backdrop" onClick={closeOverlays}><section className="utility-sheet" onClick={event => event.stopPropagation()}><div className="planner-handle" /><div className="utility-head"><div><span>SAVED</span><h2>Your watchlist</h2><p>Places Buzz should keep an eye on for you.</p></div><button type="button" onClick={closeOverlays}><X /></button></div>{favorites.length ? <div className="utility-list">{favorites.map(venue => <button type="button" key={venue.id} onClick={() => { closeOverlays(); openVenue(venue); }}><div className="utility-photo"><RemoteVenueImage src={venue.photoUrl} alt="" fallback={venue.name.slice(0, 1)} sizes="64px" /></div><span><strong>{venue.name}</strong><small>{statusFor(venue)} · Buzz {score(venue)}</small></span><ChevronRight /></button>)}</div> : <div className="buzz-empty"><Heart /><strong>No saved places yet</strong><p>Tap the heart on any place to build your watchlist.</p></div>}</section></div>}

      {alertsOpen && <div className="planner-backdrop" onClick={closeOverlays}><section className="utility-sheet" onClick={event => event.stopPropagation()}><div className="planner-handle" /><div className="utility-head"><div><span>SMART ALERTS</span><h2>We’ll tell you when to go</h2><p>Quiet alerts only when a watched place meaningfully heats up.</p></div><button type="button" onClick={closeOverlays}><X /></button></div><div className="alert-card"><Bell /><div><strong>{alertsEnabled ? "Notifications enabled" : "Enable notifications"}</strong><p>{alertsEnabled ? `${venueAlerts.length} place${venueAlerts.length === 1 ? "" : "s"} on your watchlist.` : "Get notified when saved places cross your activity threshold."}</p></div></div><button type="button" className="alert-action" onClick={() => void enableAlerts()} disabled={alertsEnabled}>{alertsEnabled ? "Enabled" : "Enable alerts"}</button>{venueAlerts.length > 0 && <div className="utility-list buzz-alert-list">{venueAlerts.map(alert => { const venue = venues.find(item => item.id === alert.venueId); return venue ? <button type="button" key={alert.venueId} onClick={() => { closeOverlays(); openVenue(venue); }}><Bell /><span><strong>{venue.name}</strong><small>Notify at {alert.threshold}+ · Current {score(venue)}</small></span><ChevronRight /></button> : null; })}</div>}{alertMessage && <p className="alert-message">{alertMessage}</p>}</section></div>}

      {profileOpen && <div className="planner-backdrop" onClick={closeOverlays}><section className="utility-sheet" onClick={event => event.stopPropagation()}><div className="planner-handle" /><div className="utility-head"><div><span>PROFILE</span><h2>Your Buzz</h2><p>Saved places, alerts, and discovery preferences.</p></div><button type="button" onClick={closeOverlays}><X /></button></div><div className="alert-card"><div className="buzz-profile-avatar"><UserRound /></div><div><strong>Your Buzz profile</strong><p>{favoriteIds.size} saved places · Nearby radius {radius} mi</p></div></div><div className="utility-list"><button type="button" onClick={() => { setProfileOpen(false); setFavoritesOpen(true); }}><Heart /><span><strong>Saved places</strong><small>{favoriteIds.size} places</small></span><ChevronRight /></button><button type="button" onClick={() => { setProfileOpen(false); setAlertsOpen(true); }}><Bell /><span><strong>Notifications</strong><small>{alertsEnabled ? "On" : "Off"}</small></span><ChevronRight /></button><button type="button" onClick={() => { setProfileOpen(false); setSearchOpen(true); }}><MapPin /><span><strong>Change area</strong><small>City, neighborhood, or ZIP</small></span><ChevronRight /></button><button type="button" onClick={() => { window.location.href = "mailto:hello@lit757.app"; }}><HelpCircle /><span><strong>Help & feedback</strong><small>Tell us what to improve</small></span><ChevronRight /></button><button type="button" className="buzz-signout" onClick={async () => { const url = process.env.NEXT_PUBLIC_SUPABASE_URL; const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY; if (url && key) { const { createClient } = await import("@supabase/supabase-js"); await createClient(url, key).auth.signOut(); } window.location.href = "/"; }}><LogOut /><span><strong>Sign out</strong><small>End this session</small></span><ChevronRight /></button></div></section></div>}
    </div>
  );
}
