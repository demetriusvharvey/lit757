"use client";

import {
  MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import "./buzz-map-app.css";
import {
  Bell,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  Compass,
  Heart,
  List,
  LocateFixed,
  MapPin,
  Music2,
  Navigation,
  Phone,
  Search,
  ShoppingBag,
  Sparkles,
  TreePine,
  UserRound,
  Utensils,
  Wine,
  X,
} from "lucide-react";

type CrowdLevel = "quiet" | "steady" | "busy" | "packed";
type Venue = {
  id: string;
  name: string;
  city?: string;
  address?: string | null;
  kind?: string;
  type?: string;
  category?: string;
  lat: number | string;
  lng: number | string;
  photoUrl?: string | null;
  reason?: string;
  openNow?: boolean | null;
  phone?: string | null;
  website?: string | null;
  distanceMiles?: number | null;
  area?: { shortName?: string; status?: string; traffic?: number; eventsActive?: number; eventsSoon?: number } | null;
  event?: { name?: string | null; startTime?: string | null; sourceUrl?: string | null; ticketStatus?: string | null } | null;
  activity?: {
    score: number;
    label: string;
    trendLabel: string;
    confidence?: string;
    scoreMode?: "live" | "forecast";
    updatedAt?: string;
  };
};

type VenueDetail = {
  hours?: unknown;
  phone?: string | null;
  website?: string | null;
  address?: string | null;
  upcomingEvents?: Array<{ id: string; name?: string | null; start_time?: string | null; source_url?: string | null }>;
};

type NearbyPayload = {
  success?: boolean;
  venues?: Venue[];
  picks?: Venue[];
  scope?: { label?: string };
  error?: string;
};

type VotePayload = {
  success?: boolean;
  error?: string;
  verifiedNearby?: boolean;
  reportCount?: number;
  pointsAwarded?: number;
  totalPoints?: number | null;
  buzz?: { score?: number; label?: string; mode?: string; confidence?: string };
  message?: string;
};

type LoadRequest = { lat?: number; lng?: number; radius?: number; bounds?: string; label?: string };

type Category = typeof categories[number][0];

const categories = [
  ["All", Compass],
  ["Food", Utensils],
  ["Drinks", Wine],
  ["Nightlife", Music2],
  ["Events", CalendarDays],
  ["Outdoors", TreePine],
  ["Shopping", ShoppingBag],
] as const;

const crowdOptions: Array<{ level: CrowdLevel; label: string; emoji: string }> = [
  { level: "quiet", label: "Quiet", emoji: "😌" },
  { level: "steady", label: "Steady", emoji: "🙂" },
  { level: "busy", label: "Busy", emoji: "🔥" },
  { level: "packed", label: "Packed", emoji: "🚨" },
];

const FAVORITES_KEY = "lit757-mobile-favorites";
const VENUE_ALERTS_KEY = "lit757-venue-alerts";
const DEFAULT_CENTER: [number, number] = [-76.17, 36.88];
const score = (venue: Venue) => Math.max(0, Math.min(100, Number(venue.activity?.score ?? 35)));
const coordinates = (venue: Venue): [number, number] => [Number(venue.lng), Number(venue.lat)];
const validVenue = (venue: Venue) => {
  const [lng, lat] = coordinates(venue);
  return Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0;
};
const statusFor = (venue: Venue) => score(venue) >= 88 ? "On fire" : score(venue) >= 76 ? "Heating up" : score(venue) >= 60 ? "Active" : "Chill";
const milesLabel = (value?: number | null) => value == null ? null : value < 0.1 ? "Here" : value < 10 ? `${value.toFixed(1)} mi` : `${Math.round(value)} mi`;
const categoryFor = (venue: Venue): Category => {
  const text = `${venue.name} ${venue.kind || ""} ${venue.type || ""} ${venue.category || ""} ${venue.reason || ""} ${venue.event?.name || ""}`.toLowerCase();
  if (venue.event?.name || venue.kind === "events") return "Events";
  if (/restaurant|food|cafe|pizza|grill|seafood|bakery|burger|brunch|kitchen/.test(text)) return "Food";
  if (/bar|brew|wine|drink|pub|cocktail/.test(text)) return "Drinks";
  if (/club|music|nightlife|dj|lounge|concert/.test(text)) return "Nightlife";
  if (/park|trail|beach|garden|museum|outdoor/.test(text)) return "Outdoors";
  if (/shop|mall|market|store/.test(text)) return "Shopping";
  return "All";
};

function formatEventTime(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" }).format(date);
}

function todayHours(hours: unknown) {
  if (!hours) return "Hours not available";
  if (typeof hours === "string") return hours;
  if (Array.isArray(hours)) return hours.map(String).join(" · ");
  if (typeof hours !== "object") return "Hours not available";
  const row = hours as Record<string, unknown>;
  const day = new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(new Date());
  const keys = [day, day.toLowerCase(), day.slice(0, 3), day.slice(0, 3).toLowerCase()];
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string") return `Today: ${value}`;
    if (Array.isArray(value)) return `Today: ${value.map(String).join(", ")}`;
  }
  return "Hours available on venue page";
}

function getPosition() {
  return new Promise<GeolocationPosition>((resolve, reject) => {
    if (!navigator.geolocation) reject(new Error("Location is not available on this device."));
    else navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 15_000, maximumAge: 15_000 });
  });
}

export default function BuzzMapApp() {
  const [venues, setVenues] = useState<Venue[]>([]);
  const [active, setActive] = useState<Category>("All");
  const [query, setQuery] = useState("");
  const [scopeLabel, setScopeLabel] = useState("Hampton Roads");
  const [selected, setSelected] = useState<Venue | null>(null);
  const [detail, setDetail] = useState<VenueDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [mapReady, setMapReady] = useState(false);
  const [mapZoom, setMapZoom] = useState(8.8);
  const [listExpanded, setListExpanded] = useState(false);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(() => new Set());
  const [watchedIds, setWatchedIds] = useState<Set<string>>(() => new Set());
  const [session, setSession] = useState<Session | null>(null);
  const [voting, setVoting] = useState(false);
  const [voteMessage, setVoteMessage] = useState("");
  const [reward, setReward] = useState<{ points: number; total: number | null } | null>(null);

  const mapEl = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const selectedRef = useRef<(id: string) => void>(() => undefined);
  const authRef = useRef<SupabaseClient | null>(null);

  const loadNearby = useCallback(async (request: LoadRequest = {}) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ limit: "400" });
      if (request.lat != null) params.set("lat", String(request.lat));
      if (request.lng != null) params.set("lng", String(request.lng));
      if (request.radius != null) params.set("radius", String(request.radius));
      if (request.bounds) params.set("bounds", request.bounds);
      const response = await fetch(`/api/nearby?${params.toString()}`, { cache: "no-store" });
      const payload = await response.json() as NearbyPayload;
      if (!response.ok || payload.success === false) throw new Error(payload.error || "Could not load places");
      setVenues(payload.venues || payload.picks || []);
      setScopeLabel(request.label || payload.scope?.label || "Hampton Roads");
      window.dispatchEvent(new CustomEvent("activity757:discovery", { detail: payload }));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load places");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    document.body.classList.add("buzz-map-active");
    try {
      setFavoriteIds(new Set(JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]") as string[]));
      const alerts = JSON.parse(localStorage.getItem(VENUE_ALERTS_KEY) || "[]") as Array<{ venueId: string }>;
      setWatchedIds(new Set(alerts.map(item => item.venueId)));
    } catch {
      // Safe defaults.
    }

    void loadNearby();
    void getPosition().then(position => {
      const latitude = position.coords.latitude;
      const longitude = position.coords.longitude;
      mapRef.current?.easeTo({ center: [longitude, latitude], zoom: 12.2, duration: 700 });
      void loadNearby({ lat: latitude, lng: longitude, radius: 10, label: "near you" });
    }).catch(() => undefined);

    let unsubscribe: (() => void) | null = null;
    const bootAuth = async () => {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!url || !key) return;
      const { createClient } = await import("@supabase/supabase-js");
      const client = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
      authRef.current = client;
      const { data } = await client.auth.getSession();
      setSession(data.session);
      const listener = client.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
      unsubscribe = () => listener.data.subscription.unsubscribe();
    };
    void bootAuth();

    return () => {
      document.body.classList.remove("buzz-map-active");
      unsubscribe?.();
    };
  }, [loadNearby]);

  const filtered = useMemo(() => {
    const clean = query.trim().toLowerCase();
    return [...venues]
      .filter(venue => active === "All" || categoryFor(venue) === active)
      .filter(venue => !clean || `${venue.name} ${venue.city || ""} ${venue.type || ""} ${venue.category || ""} ${venue.event?.name || ""}`.toLowerCase().includes(clean))
      .sort((left, right) => score(right) - score(left) || (left.distanceMiles ?? 999) - (right.distanceMiles ?? 999));
  }, [venues, active, query]);

  const selectVenue = useCallback((id: string) => {
    const venue = venues.find(item => String(item.id) === String(id));
    if (!venue) return;
    setSelected(venue);
    setVoteMessage("");
    if (validVenue(venue)) mapRef.current?.easeTo({ center: coordinates(venue), zoom: Math.max(13.2, mapRef.current.getZoom()), duration: 500 });
  }, [venues]);
  selectedRef.current = selectVenue;

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    void fetch(`/api/venue-detail?id=${encodeURIComponent(selected.id)}`, { cache: "no-store" })
      .then(response => response.ok ? response.json() : null)
      .then(payload => { if (!cancelled && payload?.venue) setDetail(payload.venue as VenueDetail); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [selected?.id]);

  useEffect(() => {
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!mapEl.current || !token || mapRef.current) return;
    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({
      container: mapEl.current,
      style: "mapbox://styles/mapbox/dark-v11",
      center: DEFAULT_CENTER,
      zoom: 8.8,
      minZoom: 3,
      maxZoom: 18,
      attributionControl: true,
    });
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
    map.on("load", () => setMapReady(true));
    map.on("zoom", () => setMapZoom(map.getZoom()));
    mapRef.current = map;
    return () => {
      setMapReady(false);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || map.getSource("buzz-map-venues")) return;
    const empty: GeoJSON.FeatureCollection<GeoJSON.Point> = { type: "FeatureCollection", features: [] };
    map.addSource("buzz-map-venues", { type: "geojson", data: empty });

    const buzzColor: any = [
      "interpolate", ["linear"], ["get", "score"],
      0, "#64748b",
      45, "#34d399",
      60, "#a3e635",
      72, "#facc15",
      82, "#fb923c",
      90, "#ef4444",
    ];

    map.addLayer({
      id: "buzz-area-heat",
      type: "heatmap",
      source: "buzz-map-venues",
      maxzoom: 12,
      paint: {
        "heatmap-weight": ["interpolate", ["linear"], ["get", "score"], 0, 0.03, 45, 0.18, 65, 0.48, 80, 0.8, 100, 1],
        "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 4, 0.5, 9, 1.05, 11.8, 1.8],
        "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 4, 18, 8, 32, 11.8, 58],
        "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 4, 0.78, 10.5, 0.94, 12, 0],
        "heatmap-color": [
          "interpolate", ["linear"], ["heatmap-density"],
          0, "rgba(15,23,42,0)",
          0.15, "rgba(52,211,153,.35)",
          0.35, "rgba(163,230,53,.55)",
          0.58, "rgba(250,204,21,.72)",
          0.78, "rgba(251,146,60,.88)",
          1, "rgba(239,68,68,1)",
        ],
      },
    });

    map.addLayer({
      id: "buzz-pin-glow",
      type: "circle",
      source: "buzz-map-venues",
      minzoom: 10.5,
      paint: {
        "circle-radius": ["case", ["==", ["get", "selected"], true], 25, ["interpolate", ["linear"], ["get", "score"], 20, 10, 100, 21]],
        "circle-color": buzzColor,
        "circle-opacity": ["case", ["==", ["get", "selected"], true], 0.45, 0.22],
        "circle-blur": 0.82,
      },
    });
    map.addLayer({
      id: "buzz-venue-pins",
      type: "circle",
      source: "buzz-map-venues",
      minzoom: 10.5,
      paint: {
        "circle-radius": ["case", ["==", ["get", "selected"], true], 13, ["interpolate", ["linear"], ["zoom"], 10.5, 7, 15, 11]],
        "circle-color": buzzColor,
        "circle-stroke-width": ["case", ["==", ["get", "selected"], true], 3.5, 2],
        "circle-stroke-color": "#ffffff",
      },
    });
    map.addLayer({
      id: "buzz-pin-score",
      type: "symbol",
      source: "buzz-map-venues",
      minzoom: 11.6,
      layout: { "text-field": ["to-string", ["get", "score"]], "text-size": 9.5, "text-font": ["DIN Pro Bold", "Arial Unicode MS Bold"] },
      paint: { "text-color": "#ffffff" },
    });
    map.addLayer({
      id: "buzz-pin-hitbox",
      type: "circle",
      source: "buzz-map-venues",
      minzoom: 10.2,
      paint: { "circle-radius": 25, "circle-color": "rgba(0,0,0,.01)", "circle-opacity": 0.01 },
    });

    const onVenueClick = (event: mapboxgl.MapLayerMouseEvent) => {
      const id = String(event.features?.[0]?.properties?.id || "");
      if (id) selectedRef.current(id);
    };
    const onHeatClick = (event: mapboxgl.MapLayerMouseEvent) => {
      if (map.getZoom() >= 10.5) return;
      map.easeTo({ center: event.lngLat, zoom: Math.min(12, map.getZoom() + 2.3), duration: 520 });
    };
    const enter = () => { map.getCanvas().style.cursor = "pointer"; };
    const leave = () => { map.getCanvas().style.cursor = ""; };
    map.on("click", "buzz-pin-hitbox", onVenueClick);
    map.on("click", "buzz-area-heat", onHeatClick);
    map.on("mouseenter", "buzz-pin-hitbox", enter);
    map.on("mouseleave", "buzz-pin-hitbox", leave);
    map.on("mouseenter", "buzz-area-heat", enter);
    map.on("mouseleave", "buzz-area-heat", leave);
    return () => {
      if (!map.getLayer("buzz-pin-hitbox")) return;
      map.off("click", "buzz-pin-hitbox", onVenueClick);
      map.off("click", "buzz-area-heat", onHeatClick);
      map.off("mouseenter", "buzz-pin-hitbox", enter);
      map.off("mouseleave", "buzz-pin-hitbox", leave);
      map.off("mouseenter", "buzz-area-heat", enter);
      map.off("mouseleave", "buzz-area-heat", leave);
    };
  }, [mapReady]);

  useEffect(() => {
    const source = mapRef.current?.getSource("buzz-map-venues") as mapboxgl.GeoJSONSource | undefined;
    if (!source) return;
    const features: GeoJSON.Feature<GeoJSON.Point>[] = filtered.filter(validVenue).map(venue => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: coordinates(venue) },
      properties: {
        id: venue.id,
        score: score(venue),
        selected: venue.id === selected?.id,
        category: categoryFor(venue),
      },
    }));
    source.setData({ type: "FeatureCollection", features });
  }, [filtered, selected?.id, mapReady]);

  function toggleFavorite(event: ReactMouseEvent, venue: Venue) {
    event.stopPropagation();
    setFavoriteIds(current => {
      const next = new Set(current);
      next.has(venue.id) ? next.delete(venue.id) : next.add(venue.id);
      localStorage.setItem(FAVORITES_KEY, JSON.stringify([...next]));
      return next;
    });
  }

  function toggleWatch(venue: Venue) {
    setWatchedIds(current => {
      const next = new Set(current);
      next.has(venue.id) ? next.delete(venue.id) : next.add(venue.id);
      const rows = [...next].map(venueId => ({ venueId, threshold: 80 }));
      localStorage.setItem(VENUE_ALERTS_KEY, JSON.stringify(rows));
      return next;
    });
  }

  async function useMyLocation() {
    setLoading(true);
    try {
      const position = await getPosition();
      const latitude = position.coords.latitude;
      const longitude = position.coords.longitude;
      mapRef.current?.easeTo({ center: [longitude, latitude], zoom: 12.5, duration: 650 });
      await loadNearby({ lat: latitude, lng: longitude, radius: 10, label: "near you" });
    } catch {
      setLoading(false);
      setError("Location permission is needed to show nearby Buzz.");
    }
  }

  async function searchThisMap() {
    const bounds = mapRef.current?.getBounds();
    if (!bounds) return;
    await loadNearby({
      bounds: [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()].join(","),
      label: "in this map area",
    });
  }

  async function submitVote(level: CrowdLevel) {
    if (!selected) return;
    if (!session) {
      window.dispatchEvent(new Event("lit757:open-notification-auth"));
      setVoteMessage("Sign in first so votes stay trustworthy.");
      return;
    }
    setVoting(true);
    setVoteMessage("Verifying that you’re at the venue…");
    try {
      const position = await getPosition();
      const response = await fetch("/api/buzz/report", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          venueId: selected.id,
          crowdLevel: level,
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          gpsAccuracyMeters: position.coords.accuracy,
        }),
      });
      const payload = await response.json() as VotePayload;
      if (!response.ok) throw new Error(payload.error || "Could not submit your vote");
      if (!payload.verifiedNearby) {
        setVoteMessage(payload.message || "Vote saved, but you were not close enough for it to affect Buzz.");
        return;
      }

      const nextScore = Number(payload.buzz?.score ?? score(selected));
      const update = (venue: Venue): Venue => venue.id === selected.id ? {
        ...venue,
        reason: "A verified local vote just updated this place.",
        activity: {
          ...(venue.activity || { score: nextScore, label: payload.buzz?.label || statusFor(venue), trendLabel: "Verified vote" }),
          score: nextScore,
          label: payload.buzz?.label || venue.activity?.label || statusFor(venue),
          trendLabel: "Verified local vote",
          scoreMode: "live",
          confidence: payload.buzz?.confidence || venue.activity?.confidence,
        },
      } : venue;
      setVenues(current => current.map(update));
      setSelected(current => current ? update(current) : current);
      setVoteMessage(`${payload.reportCount || 1} verified vote${payload.reportCount === 1 ? "" : "s"} active right now.`);
      setReward({ points: payload.pointsAwarded || 0, total: payload.totalPoints ?? null });
      window.setTimeout(() => setReward(null), 2600);
    } catch (voteError) {
      setVoteMessage(voteError instanceof Error ? voteError.message : "Could not submit your vote");
    } finally {
      setVoting(false);
    }
  }

  const selectedHours = todayHours(detail?.hours);
  const selectedPhone = detail?.phone || selected?.phone;
  const selectedWebsite = detail?.website || selected?.website;
  const selectedAddress = detail?.address || selected?.address;

  return (
    <div className="buzz-map-app">
      <header className="buzz-map-header">
        <button type="button" className="buzz-map-brand" onClick={() => { mapRef.current?.easeTo({ center: DEFAULT_CENTER, zoom: 8.8, duration: 600 }); void loadNearby(); }}>
          <strong>BUZZ</strong><span>THINGS TO DO NOW</span>
        </button>
        <label className="buzz-map-search"><Search /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search places, events, or neighborhoods" />{query && <button type="button" onClick={() => setQuery("")} aria-label="Clear search"><X /></button>}</label>
        <div className="buzz-map-header-actions">
          <button type="button" onClick={() => void useMyLocation()}><LocateFixed /><span>Near me</span></button>
          <button type="button" aria-label="Buzz alerts"><Bell /></button>
          <button type="button" aria-label="Profile"><UserRound /></button>
        </div>
      </header>

      <nav className="buzz-map-filters" aria-label="Filter places">
        {categories.map(([label, Icon]) => <button type="button" key={label} className={active === label ? "active" : ""} onClick={() => setActive(label)} aria-pressed={active === label}><Icon /><span>{label}</span></button>)}
      </nav>

      <main className="buzz-map-layout">
        <aside className={`buzz-map-list${listExpanded ? " expanded" : ""}`}>
          <button type="button" className="buzz-mobile-list-handle" onClick={() => setListExpanded(current => !current)}>
            <span><List /> Top Buzz</span>{listExpanded ? <ChevronDown /> : <ChevronUp />}
          </button>
          <div className="buzz-map-list-head">
            <div><small>HIGHEST BUZZ FIRST</small><h1>{active === "All" ? "Places buzzing now" : active}</h1><p>{loading ? "Updating activity…" : `${filtered.length} places ${scopeLabel}`}</p></div>
            <span className="buzz-heat-key"><i /> Heat map <b>→</b> pins</span>
          </div>
          <div className="buzz-map-list-scroll">
            {filtered.map((venue, index) => (
              <article key={venue.id} className={selected?.id === venue.id ? "selected" : ""} onClick={() => selectVenue(venue.id)}>
                <div className="buzz-list-photo">{venue.photoUrl ? <img src={venue.photoUrl} alt="" /> : <span>{venue.name.slice(0, 1)}</span>}<b>{score(venue)}</b></div>
                <div className="buzz-list-copy"><small>{index === 0 ? "BEST NOW" : `#${index + 1}`} · {categoryFor(venue)} · {milesLabel(venue.distanceMiles) || venue.city || "Nearby"}</small><strong>{venue.name}</strong><p>{venue.event?.name || venue.reason || "Available right now"}</p><span className={`buzz-status s${Math.floor(score(venue) / 20)}`}>{statusFor(venue)}{venue.activity?.scoreMode === "live" ? " · Live" : " · Forecast"}</span></div>
                <button type="button" className={favoriteIds.has(venue.id) ? "saved" : ""} onClick={event => toggleFavorite(event, venue)} aria-label={`Save ${venue.name}`}><Heart fill={favoriteIds.has(venue.id) ? "currentColor" : "none"} /></button>
              </article>
            ))}
            {!loading && !filtered.length && <div className="buzz-map-empty"><Search /><strong>No places match this filter</strong><p>Try All or zoom to another area.</p></div>}
          </div>
        </aside>

        <section className="buzz-map-stage" aria-label="Buzz activity map">
          <div ref={mapEl} className="buzz-map-canvas" />
          <div className="buzz-map-toolbar">
            <button type="button" onClick={() => void useMyLocation()}><LocateFixed /> Near me</button>
            <button type="button" onClick={() => void searchThisMap()}><Search /> Search this map</button>
          </div>
          <div className="buzz-map-mode">
            {mapZoom < 10.5 ? <><Sparkles /><span>Area heat</span><small>Tap a hot zone or zoom in for venues</small></> : <><MapPin /><span>Venue pins</span><small>Color shows each place’s Buzz</small></>}
          </div>
          {loading && <div className="buzz-map-loading"><i /> Updating Buzz</div>}
          {error && <button type="button" className="buzz-map-error" onClick={() => void loadNearby()}>{error} · Retry</button>}
        </section>
      </main>

      {selected && (
        <aside className="buzz-venue-detail">
          <button type="button" className="buzz-detail-close" onClick={() => setSelected(null)} aria-label="Close venue"><X /></button>
          <div className="buzz-detail-photo">{selected.photoUrl ? <img src={selected.photoUrl} alt={selected.name} /> : <span>{selected.name.slice(0, 1)}</span>}<div><b>{score(selected)}</b><small>BUZZ</small></div></div>
          <div className="buzz-detail-body">
            <div className="buzz-detail-title"><div><small>{statusFor(selected).toUpperCase()} · {selected.activity?.scoreMode === "live" ? "LIVE" : "FORECAST"}</small><h2>{selected.name}</h2><p><MapPin /> {milesLabel(selected.distanceMiles) || selected.city || "Nearby"}{selected.area?.shortName ? ` · ${selected.area.shortName}` : ""}</p></div><button type="button" className={favoriteIds.has(selected.id) ? "saved" : ""} onClick={event => toggleFavorite(event, selected)}><Heart fill={favoriteIds.has(selected.id) ? "currentColor" : "none"} /></button></div>

            <div className="buzz-detail-reason"><Sparkles /><div><strong>Why Buzz thinks this</strong><p>{selected.reason || "Buzz is combining current activity signals for this place."}</p></div></div>

            <div className="buzz-detail-facts">
              <div><small>HOURS</small><strong>{selectedHours}</strong></div>
              {selected.event?.name && <div><small>EVENT</small><strong>{selected.event.name}</strong><span>{formatEventTime(selected.event.startTime)}</span></div>}
              {selectedAddress && <div><small>ADDRESS</small><strong>{selectedAddress}</strong></div>}
            </div>

            <section className="buzz-vote-card">
              <header><div><small>VERIFY THE BUZZ</small><strong>How crowded is it?</strong><p>Nearby votes make this score more accurate.</p></div><em>+10 Buzz Points</em></header>
              <div>{crowdOptions.map(option => <button type="button" key={option.level} disabled={voting} onClick={() => void submitVote(option.level)}><span>{option.emoji}</span>{option.label}</button>)}</div>
              {voteMessage && <p>{voting && <i />}{voteMessage}</p>}
            </section>

            <div className="buzz-detail-actions">
              <button type="button" onClick={() => toggleWatch(selected)}><Bell fill={watchedIds.has(selected.id) ? "currentColor" : "none"} />{watchedIds.has(selected.id) ? "Watching" : "Alert me"}</button>
              <button type="button" onClick={() => window.open(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(selectedAddress || `${selected.lat},${selected.lng}`)}`, "_blank")}><Navigation />Directions</button>
              {selectedPhone && <a href={`tel:${selectedPhone}`}><Phone />Call</a>}
              {selectedWebsite && <a href={selectedWebsite} target="_blank" rel="noreferrer">Website</a>}
            </div>
          </div>
        </aside>
      )}

      {reward && <div className="buzz-points-pop"><strong>+{reward.points || 10}</strong><span>BUZZ POINTS</span>{reward.total != null && <small>{reward.total} total</small>}</div>}
    </div>
  );
}
