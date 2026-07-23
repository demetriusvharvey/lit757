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
import "./buzz-map-notifications.css";
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
  Share2,
  Copy,
  MessageCircle,
  Download,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  TreePine,
  UserRound,
  Utensils,
  Wine,
  X,
} from "lucide-react";
import { getVenueLogo } from "../src/lib/venue-logo";
import {
  buildInviteCrewText,
  buildInviteCrewUrl,
  buildStoryCardUrl,
} from "../src/lib/invite-the-crew";
import {
  createReferralId,
  referralContext,
  trackConversion,
  type ConversionEventName,
} from "../src/lib/conversion-analytics";
import {
  contextualVibe,
  discoveryDaypart,
  orderedDiscoveryCategories,
  type DiscoveryDaypart,
} from "../src/lib/adaptive-discovery";

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
const ALERTS_KEY = "lit757-mobile-alerts";
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
const logoKeyFor = (venue: Venue) => `venue-logo-${String(venue.id).replace(/[^a-zA-Z0-9_-]/g, "")}`;
const logoUrlFor = (venue: Pick<Venue, "name" | "website">) => getVenueLogo({ name: venue.name, website: venue.website });

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
  const [daypart, setDaypart] = useState<DiscoveryDaypart>(() => discoveryDaypart());
  const [listExpanded, setListExpanded] = useState(false);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(() => new Set());
  const [watchedIds, setWatchedIds] = useState<Set<string>>(() => new Set());
  const [session, setSession] = useState<Session | null>(null);
  const [voting, setVoting] = useState(false);
  const [voteMessage, setVoteMessage] = useState("");
  const [watchMessage, setWatchMessage] = useState("");
  const [shareMessage, setShareMessage] = useState("");
  const [sharing, setSharing] = useState(false);
  const [reward, setReward] = useState<{ points: number; total: number | null } | null>(null);

  const mapEl = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const selectedRef = useRef<(id: string) => void>(() => undefined);
  const authRef = useRef<SupabaseClient | null>(null);
  const requestSequenceRef = useRef(0);
  const deepLinkHandledRef = useRef(false);
  const logoUrlsRef = useRef(new Map<string, string>());
  const loadingLogosRef = useRef(new Set<string>());

  const loadNearby = useCallback(async (request: LoadRequest = {}) => {
    const sequence = ++requestSequenceRef.current;
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
      if (sequence !== requestSequenceRef.current) return;
      setVenues(payload.venues || payload.picks || []);
      setScopeLabel(request.label || payload.scope?.label || "Hampton Roads");
      window.dispatchEvent(new CustomEvent("activity757:discovery", { detail: payload }));
    } catch (loadError) {
      if (sequence !== requestSequenceRef.current) return;
      setError(loadError instanceof Error ? loadError.message : "Could not load places");
    } finally {
      if (sequence === requestSequenceRef.current) setLoading(false);
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

  useEffect(() => {
    const syncDaypart = () => setDaypart(discoveryDaypart());
    syncDaypart();
    const timer = window.setInterval(syncDaypart, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const orderedCategories = useMemo(() => orderedDiscoveryCategories(daypart)
    .map(label => categories.find(([candidate]) => candidate === label))
    .filter((item): item is typeof categories[number] => Boolean(item)), [daypart]);

  const filtered = useMemo(() => {
    const clean = query.trim().toLowerCase();
    return [...venues]
      .filter(venue => active === "All" || categoryFor(venue) === active)
      .filter(venue => !clean || `${venue.name} ${venue.city || ""} ${venue.type || ""} ${venue.category || ""} ${venue.event?.name || ""}`.toLowerCase().includes(clean))
      .sort((left, right) => score(right) - score(left) || (left.distanceMiles ?? 999) - (right.distanceMiles ?? 999));
  }, [venues, active, query]);

  const vibeFor = useCallback((venue: Venue) => contextualVibe({
    category: categoryFor(venue),
    type: venue.type || venue.kind,
    score: score(venue),
    hasEvent: Boolean(venue.event?.name),
    trend: venue.activity?.trendLabel,
    scoreMode: venue.activity?.scoreMode,
  }, daypart), [daypart]);

  const selectVenue = useCallback((id: string) => {
    const venue = venues.find(item => String(item.id) === String(id));
    if (!venue) return;
    setSelected(venue);
    setVoteMessage("");
    setWatchMessage("");
    const context = referralContext(window.location.href);
    void trackConversion({
      eventName: "venue_view",
      venueId: venue.id,
      referralId: context.referralId,
      source: context.isInvite ? "invite-the-crew" : "buzz-map",
      truthMode: venue.activity?.scoreMode || "forecast",
      metadata: {
        entry: context.isInvite ? "shared-link" : "map",
        selectedFilter: active,
      },
    }, session?.access_token);
    if (validVenue(venue)) mapRef.current?.easeTo({ center: coordinates(venue), zoom: Math.max(13.2, mapRef.current.getZoom()), duration: 500 });
  }, [venues, active, session?.access_token]);
  selectedRef.current = selectVenue;

  useEffect(() => {
    if (deepLinkHandledRef.current || !venues.length) return;
    const params = new URLSearchParams(window.location.search);
    const venueId = params.get("venue");
    if (!venueId || !venues.some(venue => String(venue.id) === venueId)) return;
    deepLinkHandledRef.current = true;
    const context = referralContext(window.location.href);
    if (context.isInvite) {
      void trackConversion({
        eventName: "shared_link_open",
        venueId,
        referralId: context.referralId,
        source: context.source,
        truthMode: context.truthMode,
        metadata: { entry: "shared-link" },
      }, session?.access_token);
    }
    selectVenue(venueId);
    if (params.get("invite") === "1") {
      setShareMessage("This place is ready to share. Tap Invite the Crew to open your phone’s share sheet.");
    }
  }, [venues, selectVenue, session?.access_token]);

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
    map.addSource("buzz-map-clusters", {
      type: "geojson",
      data: empty,
      cluster: true,
      clusterRadius: 54,
      clusterMaxZoom: 12,
      clusterProperties: {
        maxScore: ["max", ["get", "score"]],
      },
    } as mapboxgl.GeoJSONSourceSpecification);

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
      id: "buzz-heat-hub-glow",
      type: "circle",
      source: "buzz-map-clusters",
      minzoom: 9,
      maxzoom: 13,
      filter: ["has", "point_count"],
      paint: {
        "circle-radius": ["step", ["get", "point_count"], 18, 8, 23, 20, 29],
        "circle-color": ["interpolate", ["linear"], ["coalesce", ["get", "maxScore"], 40], 35, "#34d399", 60, "#facc15", 78, "#fb923c", 90, "#ef4444"],
        "circle-opacity": 0.26,
        "circle-blur": 0.8,
      },
    });
    map.addLayer({
      id: "buzz-heat-hubs",
      type: "circle",
      source: "buzz-map-clusters",
      minzoom: 9,
      maxzoom: 13,
      filter: ["has", "point_count"],
      paint: {
        "circle-radius": ["step", ["get", "point_count"], 7, 8, 10, 20, 13],
        "circle-color": ["interpolate", ["linear"], ["coalesce", ["get", "maxScore"], 40], 35, "#34d399", 60, "#facc15", 78, "#fb923c", 90, "#ef4444"],
        "circle-opacity": 0.9,
        "circle-stroke-width": 2,
        "circle-stroke-color": "rgba(255,255,255,.72)",
      },
    });
    map.addLayer({
      id: "buzz-pin-glow",
      type: "circle",
      source: "buzz-map-clusters",
      minzoom: 10.5,
      filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-radius": ["case", ["==", ["get", "selected"], true], 29, ["interpolate", ["linear"], ["get", "score"], 20, 13, 100, 24]],
        "circle-color": buzzColor,
        "circle-opacity": ["case", ["==", ["get", "selected"], true], 0.55, 0.32],
        "circle-blur": 0.76,
      },
    });
    map.addLayer({
      id: "buzz-venue-pins",
      type: "circle",
      source: "buzz-map-clusters",
      minzoom: 10.5,
      filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-radius": ["case", ["==", ["get", "selected"], true], 18, ["interpolate", ["linear"], ["zoom"], 10.5, 12.5, 15, 15.5]],
        "circle-color": "#ffffff",
        "circle-stroke-width": ["case", ["==", ["get", "selected"], true], 6, 4],
        "circle-stroke-color": buzzColor,
      },
    });
    map.addLayer({
      id: "buzz-pin-logo",
      type: "symbol",
      source: "buzz-map-clusters",
      minzoom: 10.5,
      filter: ["!", ["has", "point_count"]],
      layout: {
        "icon-image": ["get", "logoKey"],
        "icon-size": ["interpolate", ["linear"], ["zoom"], 10.5, 0.2, 15, 0.25],
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
    });
    map.addLayer({
      id: "buzz-pin-hitbox",
      type: "circle",
      source: "buzz-map-clusters",
      minzoom: 10.2,
      filter: ["!", ["has", "point_count"]],
      paint: { "circle-radius": 30, "circle-color": "rgba(0,0,0,.01)", "circle-opacity": 0.01 },
    });

    const onStyleImageMissing = (event: { id: string }) => {
      const id = event.id;
      if (!id.startsWith("venue-logo-") || map.hasImage(id) || loadingLogosRef.current.has(id)) return;
      const logoUrl = logoUrlsRef.current.get(id);
      if (!logoUrl) return;
      loadingLogosRef.current.add(id);
      void map.loadImage(logoUrl)
        .then(image => {
          if (!map.hasImage(id)) map.addImage(id, image.data, { pixelRatio: 2 });
        })
        .catch(() => undefined)
        .finally(() => loadingLogosRef.current.delete(id));
    };
    const onVenueClick = (event: mapboxgl.MapLayerMouseEvent) => {
      const id = String(event.features?.[0]?.properties?.id || "");
      if (id) selectedRef.current(id);
    };
    const onHeatClick = (event: mapboxgl.MapLayerMouseEvent) => {
      if (map.getZoom() >= 10.5) return;
      map.easeTo({ center: event.lngLat, zoom: Math.min(12, map.getZoom() + 2.3), duration: 520 });
    };
    const onHeatHubClick = (event: mapboxgl.MapLayerMouseEvent) => {
      map.easeTo({ center: event.lngLat, zoom: Math.min(14, map.getZoom() + 2.4), duration: 520 });
    };
    const enter = () => { map.getCanvas().style.cursor = "pointer"; };
    const leave = () => { map.getCanvas().style.cursor = ""; };
    map.on("styleimagemissing", onStyleImageMissing);
    map.on("click", "buzz-pin-hitbox", onVenueClick);
    map.on("click", "buzz-area-heat", onHeatClick);
    map.on("click", "buzz-heat-hubs", onHeatHubClick);
    map.on("mouseenter", "buzz-pin-hitbox", enter);
    map.on("mouseleave", "buzz-pin-hitbox", leave);
    map.on("mouseenter", "buzz-heat-hubs", enter);
    map.on("mouseleave", "buzz-heat-hubs", leave);

    return () => {
      map.off("styleimagemissing", onStyleImageMissing);
      map.off("click", "buzz-pin-hitbox", onVenueClick);
      map.off("click", "buzz-area-heat", onHeatClick);
      map.off("click", "buzz-heat-hubs", onHeatHubClick);
      map.off("mouseenter", "buzz-pin-hitbox", enter);
      map.off("mouseleave", "buzz-pin-hitbox", leave);
      map.off("mouseenter", "buzz-heat-hubs", enter);
      map.off("mouseleave", "buzz-heat-hubs", leave);
    };
  }, [mapReady]);

  useEffect(() => {
    const features: GeoJSON.Feature<GeoJSON.Point>[] = filtered.filter(validVenue).map(venue => {
      const logoKey = logoKeyFor(venue);
      logoUrlsRef.current.set(logoKey, logoUrlFor(venue));
      return {
        type: "Feature",
        geometry: { type: "Point", coordinates: coordinates(venue) },
        properties: {
          id: venue.id,
          score: score(venue),
          logoKey,
          selected: selected?.id === venue.id,
        },
      };
    });
    const collection: GeoJSON.FeatureCollection<GeoJSON.Point> = { type: "FeatureCollection", features };
    (mapRef.current?.getSource("buzz-map-venues") as mapboxgl.GeoJSONSource | undefined)?.setData(collection);
    (mapRef.current?.getSource("buzz-map-clusters") as mapboxgl.GeoJSONSource | undefined)?.setData(collection);
  }, [filtered, selected?.id]);

  async function useMyLocation() {
    try {
      const position = await getPosition();
      const latitude = position.coords.latitude;
      const longitude = position.coords.longitude;
      mapRef.current?.easeTo({ center: [longitude, latitude], zoom: 12.4, duration: 650 });
      await loadNearby({ lat: latitude, lng: longitude, radius: 10, label: "near you" });
    } catch {
      setError("Location access is required to find nearby activity");
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
      setVoteMessage(`Verified. ${payload.reportCount || 1} live report${payload.reportCount === 1 ? "" : "s"} now influence Buzz.`);
      if (payload.pointsAwarded) setReward({ points: payload.pointsAwarded, total: payload.totalPoints ?? null });
    } catch (voteError) {
      setVoteMessage(voteError instanceof Error ? voteError.message : "Could not submit your vote");
    } finally {
      setVoting(false);
    }
  }

  function toggleFavorite(event: ReactMouseEvent, venue: Venue) {
    event.stopPropagation();
    setFavoriteIds(current => {
      const next = new Set(current);
      if (next.has(venue.id)) next.delete(venue.id);
      else next.add(venue.id);
      localStorage.setItem(FAVORITES_KEY, JSON.stringify([...next]));
      return next;
    });
  }

  async function enableNotifications() {
    if (!("Notification" in window)) return;
    const permission = await Notification.requestPermission();
    if (permission === "granted") {
      localStorage.setItem(ALERTS_KEY, "enabled");
      new Notification("Buzz alerts enabled", { body: "We’ll tell you when saved places start heating up." });
    }
  }

  const selectedWebsite = detail?.website || selected?.website || null;
  const selectedAddress = detail?.address || selected?.address || null;
  const selectedHours = todayHours(detail?.hours);
  const selectedVibe = selected ? vibeFor(selected) : null;

  async function copyInviteLink(venue: Venue) {
    const referralId = createReferralId();
    const url = buildInviteCrewUrl(venue.id, referralId, venue.activity?.scoreMode || "forecast");
    try {
      await navigator.clipboard.writeText(url);
      setShareMessage("Invite link copied.");
      void trackConversion({ eventName: "share_copy", venueId: venue.id, referralId, source: "invite-the-crew", truthMode: venue.activity?.scoreMode || "forecast" }, session?.access_token);
    } catch {
      setShareMessage("Copy failed. Use your browser’s Share action.");
    }
  }

  function textCrew(venue: Venue) {
    const referralId = createReferralId();
    const url = buildInviteCrewUrl(venue.id, referralId, venue.activity?.scoreMode || "forecast");
    const message = buildInviteCrewText(venue.name, statusFor(venue), venue.event?.name, url);
    window.location.href = `sms:?&body=${encodeURIComponent(message)}`;
    void trackConversion({ eventName: "share_sms", venueId: venue.id, referralId, source: "invite-the-crew", truthMode: venue.activity?.scoreMode || "forecast" }, session?.access_token);
  }

  async function shareWithCrew(venue: Venue) {
    const referralId = createReferralId();
    const url = buildInviteCrewUrl(venue.id, referralId, venue.activity?.scoreMode || "forecast");
    const storyUrl = buildStoryCardUrl(venue.id, referralId);
    setSharing(true);
    setShareMessage("");
    try {
      const response = await fetch(storyUrl, { cache: "no-store" });
      if (!response.ok) throw new Error("Could not build the Story card");
      const blob = await response.blob();
      const file = new File([blob], `buzz-${venue.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`, { type: "image/png" });
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ title: `${venue.name} is ${statusFor(venue)}`, text: buildInviteCrewText(venue.name, statusFor(venue), venue.event?.name, url), url, files: [file] });
        setShareMessage("Shared with the crew.");
        void trackConversion({ eventName: "share_native", venueId: venue.id, referralId, source: "invite-the-crew", truthMode: venue.activity?.scoreMode || "forecast", metadata: { media: "story-card" } }, session?.access_token);
      } else if (navigator.share) {
        await navigator.share({ title: `${venue.name} is ${statusFor(venue)}`, text: buildInviteCrewText(venue.name, statusFor(venue), venue.event?.name, url), url });
        setShareMessage("Shared with the crew.");
        void trackConversion({ eventName: "share_native", venueId: venue.id, referralId, source: "invite-the-crew", truthMode: venue.activity?.scoreMode || "forecast", metadata: { media: "link" } }, session?.access_token);
      } else {
        await navigator.clipboard.writeText(url);
        setShareMessage("Link copied. Your browser does not support direct sharing.");
        void trackConversion({ eventName: "share_fallback", venueId: venue.id, referralId, source: "invite-the-crew", truthMode: venue.activity?.scoreMode || "forecast" }, session?.access_token);
      }
    } catch (shareError) {
      if ((shareError as Error)?.name !== "AbortError") setShareMessage(shareError instanceof Error ? shareError.message : "Could not share this venue");
    } finally {
      setSharing(false);
    }
  }

  async function downloadStoryCard(venue: Venue) {
    const referralId = createReferralId();
    const storyUrl = buildStoryCardUrl(venue.id, referralId);
    setSharing(true);
    try {
      const response = await fetch(storyUrl, { cache: "no-store" });
      if (!response.ok) throw new Error("Could not build the Story card");
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = `buzz-${venue.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`;
      anchor.click();
      URL.revokeObjectURL(objectUrl);
      setShareMessage("Story card saved.");
      void trackConversion({ eventName: "share_download", venueId: venue.id, referralId, source: "invite-the-crew", truthMode: venue.activity?.scoreMode || "forecast" }, session?.access_token);
    } catch (downloadError) {
      setShareMessage(downloadError instanceof Error ? downloadError.message : "Could not save the Story card");
    } finally {
      setSharing(false);
    }
  }

  const toggleVenueWatch = () => {
    if (!selected) return;
    const next = new Set(watchedIds);
    const wasWatched = next.has(selected.id);
    if (wasWatched) next.delete(selected.id);
    else next.add(selected.id);
    setWatchedIds(next);
    localStorage.setItem(VENUE_ALERTS_KEY, JSON.stringify([...next].map(venueId => ({ venueId }))));
    setWatchMessage(wasWatched ? "Buzz alerts turned off for this place." : "We’ll alert you when this place starts heating up.");
  };

  return (
    <div className={`buzz-map-app ${daypart === "day" ? "daytime" : "nighttime"}`}>
      <header className="buzz-map-header">
        <button type="button" className="buzz-map-brand" onClick={() => { mapRef.current?.easeTo({ center: DEFAULT_CENTER, zoom: 8.8, duration: 600 }); void loadNearby(); }}>
          <strong>BUZZ</strong><span>THINGS TO DO NOW</span>
        </button>
        <label className="buzz-map-search"><Search /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search places, events, or neighborhoods" />{query && <button type="button" onClick={() => setQuery("")} aria-label="Clear search"><X /></button>}</label>
        <div className="buzz-map-header-actions">
          <button type="button" onClick={() => void useMyLocation()}><LocateFixed /><span>Near me</span></button>
          <button type="button" aria-label="Enable Buzz alerts" onClick={() => void enableNotifications()}><Bell /></button>
          <button type="button" aria-label="Profile"><UserRound /></button>
        </div>
      </header>

      <nav className="buzz-map-filters" aria-label="Filter places">
        {orderedCategories.map(([label, Icon]) => <button type="button" key={label} className={active === label ? "active" : ""} onClick={() => setActive(label)} aria-pressed={active === label}><Icon /><span>{label}</span></button>)}
      </nav>

      <main className="buzz-map-layout">
        <aside className={`buzz-map-list${listExpanded ? " expanded" : ""}`}>
          <button type="button" className="buzz-mobile-list-handle" onClick={() => setListExpanded(current => !current)}>
            <span><List /> Top Buzz</span>{listExpanded ? <ChevronDown /> : <ChevronUp />}
          </button>
          <div className="buzz-map-list-head">
            <div><small>HIGHEST BUZZ FIRST</small><h1>{active === "All" ? "Places buzzing now" : active}</h1><p>{loading ? "Updating activity…" : `${filtered.length} places ${scopeLabel}`}</p></div>
            <span className="buzz-heat-key"><i /> Heat map <b>→</b> logo pins</span>
          </div>
          <div className="buzz-map-list-scroll">
            {filtered.map((venue, index) => {
              const vibe = vibeFor(venue);
              return (
                <article key={venue.id} className={selected?.id === venue.id ? "selected" : ""} onClick={() => selectVenue(venue.id)}>
                  <div className="buzz-list-photo"><img src={logoUrlFor(venue)} alt={`${venue.name} logo`} loading="lazy" decoding="async" /></div>
                  <div className="buzz-list-copy"><small>{index === 0 ? "BEST NOW" : `#${index + 1}`} · {categoryFor(venue)} · {milesLabel(venue.distanceMiles) || venue.city || "Nearby"}</small><strong>{venue.name}</strong><span className={`buzz-vibe-tag ${vibe.truth}`}>{vibe.label}<b>{vibe.truth === "live" ? "LIVE" : "FORECAST"}</b></span><p>{venue.event?.name || venue.reason || "Available right now"}</p><span className={`buzz-status s${Math.floor(score(venue) / 20)}`}>{statusFor(venue)}{venue.activity?.scoreMode === "live" ? " · Live" : " · Forecast"}</span></div>
                  <button type="button" className={favoriteIds.has(venue.id) ? "saved" : ""} onClick={event => toggleFavorite(event, venue)} aria-label={`Save ${venue.name}`}><Heart fill={favoriteIds.has(venue.id) ? "currentColor" : "none"} /></button>
                </article>
              );
            })}
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
            {mapZoom < 9.8 ? <><Sparkles /><span>City pulse</span><small>Tap a hot zone or zoom in for places</small></> : mapZoom < 12.6 ? <><Sparkles /><span>Buzzing zones</span><small>Tap a glow to reveal nearby places</small></> : <><MapPin /><span>Live places</span><small>Tap a place to see what’s happening</small></>}
          </div>
          {loading && <div className="buzz-map-loading"><i /> Updating Buzz</div>}
          {error && <button type="button" className="buzz-map-error" onClick={() => void loadNearby()}>{error} · Retry</button>}
        </section>
      </main>

      {selected && (
        <aside className="buzz-venue-detail">
          <button type="button" className="buzz-detail-close" onClick={() => setSelected(null)} aria-label="Close venue"><X /></button>
          <div className="buzz-detail-photo"><img src={getVenueLogo({ name: selected.name, website: selectedWebsite })} alt={`${selected.name} logo`} /><div><b>{score(selected)}</b><small>BUZZ</small></div></div>
          <div className="buzz-detail-body">
            <div className="buzz-detail-title"><div><small>{statusFor(selected).toUpperCase()} · {selected.activity?.scoreMode === "live" ? "LIVE" : "FORECAST"}</small><h2>{selected.name}</h2><p><MapPin /> {milesLabel(selected.distanceMiles) || selected.city || "Nearby"}{selected.area?.shortName ? ` · ${selected.area.shortName}` : ""}</p></div><button type="button" className={favoriteIds.has(selected.id) ? "saved" : ""} onClick={event => toggleFavorite(event, selected)}><Heart fill={favoriteIds.has(selected.id) ? "currentColor" : "none"} /></button></div>

            {selectedVibe && <div className={`buzz-detail-vibe ${selectedVibe.truth}`}><span>{selectedVibe.label}</span><b>{selectedVibe.truth === "live" ? "LIVE" : "FORECAST"}</b></div>}
            <div className="buzz-detail-reason"><Sparkles /><div><strong>Why Buzz thinks this</strong><p>{selected.reason || "Buzz is combining current activity signals for this place."}</p></div></div>
            <div className="buzz-truth-note"><ShieldCheck /><div><strong>What this score can prove</strong><p>Buzz creates a useful forecast from hours, events, ticket demand, traffic patterns, provider data, and nearby phones. Exact physical occupancy still requires ticket scans, POS activity, door counters, or another direct venue feed.</p></div></div>

            <div className="buzz-detail-facts">
              <div><small>HOURS</small><strong>{selectedHours}</strong></div>
              {selected.event?.name && <div><small>EVENT</small><strong>{selected.event.name}</strong><span>{formatEventTime(selected.event.startTime)}</span></div>}
              {selectedAddress && <div><small>ADDRESS</small><strong>{selectedAddress}</strong></div>}
            </div>

            <section className="buzz-vote-card">
              <header><div><small>OPTIONAL VERIFICATION</small><strong>How crowded is it?</strong><p>Buzz works without votes. Nearby votes verify and calibrate it faster.</p></div><em>+10 Buzz Points</em></header>
              <div>{crowdOptions.map(option => <button type="button" key={option.level} disabled={voting} onClick={() => void submitVote(option.level)}><span>{option.emoji}</span>{option.label}</button>)}</div>
              {voteMessage && <p>{voting && <i />}{voteMessage}</p>}
            </section>

            <section className="buzz-invite-card">
              <header><div><small>FOMO MODE</small><strong>Bring the crew</strong><p>Share this venue’s surge—not your location—with one tap.</p></div><Share2 /></header>
              <button type="button" className="buzz-invite-primary" disabled={sharing} onClick={() => void shareWithCrew(selected)}><Share2 />{sharing ? "Building the Story card…" : "Invite the Crew"}</button>
              <div>
                <button type="button" onClick={() => void copyInviteLink(selected)}><Copy />Copy link</button>
                <button type="button" onClick={() => textCrew(selected)}><MessageCircle />Text crew</button>
                <button type="button" disabled={sharing} onClick={() => void downloadStoryCard(selected)}><Download />Save Story</button>
              </div>
              {shareMessage && <p>{shareMessage}</p>}
            </section>

            <div className="buzz-detail-actions">
              <button type="button" className={watchedIds.has(selected.id) ? "watching" : ""} onClick={toggleVenueWatch}><Bell />{watchedIds.has(selected.id) ? "Watching" : "Watch this place"}</button>
              {selectedAddress && <a href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(selectedAddress)}`} target="_blank" rel="noreferrer"><Navigation />Directions</a>}
              {detail?.phone && <a href={`tel:${detail.phone}`}><Phone />Call</a>}
              {selectedWebsite && <a href={selectedWebsite} target="_blank" rel="noreferrer"><span>↗</span>Website</a>}
            </div>
            {watchMessage && <p className="buzz-watch-message">{watchMessage}</p>}
          </div>
        </aside>
      )}
      {reward && <button type="button" className="buzz-points-toast" onClick={() => setReward(null)}><strong>+{reward.points} Buzz Points</strong><span>{reward.total == null ? "Verified local contribution" : `${reward.total} total points`}</span></button>}
    </div>
  );
}
