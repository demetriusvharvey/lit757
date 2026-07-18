"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  Clock3,
  LocateFixed,
  MapPin,
  Navigation,
  Search,
  Sparkles,
  Star,
  Ticket,
  X,
} from "lucide-react";

type DiscoveryMode = "all" | "food" | "nightlife" | "events";

type DiscoveryEvent = {
  id: string;
  name: string;
  startTime: string | null;
  timeLabel: string;
  ticketStatus: string | null;
  sourceUrl: string | null;
};

type DiscoveryVenue = {
  id: string;
  name: string;
  city: string;
  address: string | null;
  lat: number;
  lng: number;
  type: string;
  category: string;
  kind: "food" | "nightlife" | "events" | "other";
  rating: number | null;
  ageLimit: string | null;
  cover: string | null;
  parking: string | null;
  dressCode: string | null;
  phone: string | null;
  website: string | null;
  photoUrl: string | null;
  label: string;
  reason: string;
  timing: string;
  openNow: boolean | null;
  confidence: string;
  score: number;
  event: DiscoveryEvent | null;
};

type DiscoveryResponse = {
  success: boolean;
  generatedAt: string;
  context: {
    key: "morning" | "afternoon" | "evening" | "late";
    eyebrow: string;
    headline: string;
    timing: string;
    city: string;
    mode: DiscoveryMode;
    resultCount: number;
  };
  freshness: {
    label: string;
    timestamp: string | null;
    automatic: boolean;
  };
  picks: DiscoveryVenue[];
  venues: DiscoveryVenue[];
};

const CITIES = [
  "All 757",
  "Norfolk",
  "Virginia Beach",
  "Chesapeake",
  "Portsmouth",
  "Suffolk",
  "Hampton",
  "Newport News",
];

const MODES: Array<{ id: DiscoveryMode; label: string }> = [
  { id: "all", label: "Top picks" },
  { id: "food", label: "Food" },
  { id: "nightlife", label: "Nightlife" },
  { id: "events", label: "Events" },
];

const HAMPTON_ROADS_CENTER: [number, number] = [-76.2859, 36.9004];
const HAMPTON_ROADS_BOUNDS: [[number, number], [number, number]] = [
  [-76.9, 36.42],
  [-75.7, 37.38],
];

function directionsUrl(venue: DiscoveryVenue) {
  const destination = venue.address || `${venue.lat},${venue.lng}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
}

function detailEyebrow(venue: DiscoveryVenue) {
  if (venue.event) return `${venue.event.timeLabel} · ${venue.city}`;
  if (venue.openNow === true) return `Open now · ${venue.city}`;
  return `${venue.timing} · ${venue.city}`;
}

function VenueImage({
  venue,
  className = "",
  priority = false,
}: {
  venue: DiscoveryVenue;
  className?: string;
  priority?: boolean;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const initial = venue.name.trim().slice(0, 1).toUpperCase() || "7";

  return (
    <div
      className={`relative overflow-hidden bg-[radial-gradient(circle_at_25%_18%,#43413d_0%,#242321_42%,#111110_100%)] ${className}`}
    >
      <div className="absolute inset-0 flex items-center justify-center text-[64px] font-semibold tracking-[-0.08em] text-white/[0.09]">
        {initial}
      </div>
      {venue.photoUrl && failedUrl !== venue.photoUrl && (
        <Image
          src={venue.photoUrl}
          alt={`${venue.name} storefront exterior`}
          fill
          unoptimized
          priority={priority}
          sizes="(min-width: 1024px) 460px, 100vw"
          className="object-cover"
          onError={() => setFailedUrl(venue.photoUrl)}
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/25 via-transparent to-black/5" />
    </div>
  );
}

function PickCard({
  venue,
  rank,
  onSelect,
}: {
  venue: DiscoveryVenue;
  rank: number;
  onSelect: (venue: DiscoveryVenue) => void;
}) {
  const primary = rank === 0;

  return (
    <button
      type="button"
      onClick={() => onSelect(venue)}
      className={`group grid w-full grid-cols-[1fr_80px] gap-3 rounded-[1.45rem] border p-2.5 text-left transition duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ff5c35] sm:grid-cols-[1fr_88px] ${
        primary
          ? "border-[#171716] bg-[#171716] text-white shadow-[0_22px_60px_rgba(17,17,16,0.16)] hover:-translate-y-0.5"
          : "border-black/[0.08] bg-white/78 text-[#171716] hover:border-black/20 hover:bg-white"
      }`}
      aria-label={`Open ${venue.name}, pick ${rank + 1}`}
    >
      <span className="flex min-w-0 flex-col justify-between px-1 py-0.5">
        <span>
          <span className="flex items-center gap-2">
            <span
              className={`text-[10px] font-bold uppercase tracking-[0.16em] ${
                primary ? "text-[#ff9b82]" : "text-[#ca482b]"
              }`}
            >
              {String(rank + 1).padStart(2, "0")} · {venue.label}
            </span>
          </span>
          <span className="mt-1.5 block truncate text-[18px] font-semibold leading-none tracking-[-0.04em] sm:text-[19px]">
            {venue.name}
          </span>
          <span
            className={`mt-1.5 line-clamp-1 text-[11px] leading-[1.4] ${
              primary ? "text-white/62" : "text-black/54"
            }`}
          >
            {venue.reason}
          </span>
        </span>

        <span className="mt-2 flex items-center gap-2 text-[10px] font-medium">
          <span className={primary ? "text-white/82" : "text-black/68"}>{venue.timing}</span>
          <span className={primary ? "text-white/24" : "text-black/18"}>·</span>
          <span className={primary ? "text-white/45" : "text-black/42"}>{venue.city}</span>
          <ArrowRight
            size={13}
            className={`ml-auto transition-transform group-hover:translate-x-0.5 ${
              primary ? "text-white/58" : "text-black/38"
            }`}
          />
        </span>
      </span>

      <VenueImage venue={venue} priority={primary} className="h-[92px] rounded-[1.05rem] sm:h-[96px]" />
    </button>
  );
}

function VenueDetail({
  venue,
  onClose,
}: {
  venue: DiscoveryVenue;
  onClose: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#f7f5ef]">
      <div className="flex h-[72px] shrink-0 items-center justify-between border-b border-black/[0.07] px-5 sm:px-6">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-10 items-center gap-2 rounded-full px-2.5 text-[13px] font-semibold text-black/62 transition hover:bg-black/[0.05] hover:text-black focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ff5c35]"
        >
          <ArrowLeft size={17} />
          Back to picks
        </button>
        <span className="rounded-full bg-[#ece9e1] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-black/52">
          {venue.confidence}
        </span>
      </div>

      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        <VenueImage venue={venue} priority className="aspect-[16/10] rounded-[1.8rem]" />

        <div className="px-1 pb-5 pt-6">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#d44b2b]">
            {detailEyebrow(venue)}
          </p>
          <h2 className="mt-3 text-[36px] font-semibold leading-[0.98] tracking-[-0.055em] text-[#171716]">
            {venue.name}
          </h2>
          <p className="mt-3 text-[15px] leading-6 text-black/58">{venue.reason}</p>

          <div className="mt-5 flex flex-wrap items-center gap-2 text-[11px] font-medium text-black/54">
            <span className="rounded-full bg-black/[0.055] px-3 py-1.5">{venue.type}</span>
            {venue.rating && (
              <span className="inline-flex items-center gap-1 rounded-full bg-black/[0.055] px-3 py-1.5">
                <Star size={11} fill="currentColor" /> {venue.rating.toFixed(1)}
              </span>
            )}
            {venue.ageLimit && venue.ageLimit !== "Unknown" && (
              <span className="rounded-full bg-black/[0.055] px-3 py-1.5">{venue.ageLimit}</span>
            )}
            {venue.cover && venue.cover !== "Unknown" && (
              <span className="rounded-full bg-black/[0.055] px-3 py-1.5">{venue.cover}</span>
            )}
          </div>

          {venue.event && (
            <div className="mt-6 rounded-[1.45rem] border border-black/[0.08] bg-white/76 p-4">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#171716] text-white">
                  <Ticket size={16} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-black/38">
                    On the schedule
                  </p>
                  <p className="mt-1.5 text-[15px] font-semibold leading-5 tracking-[-0.02em] text-black/80">
                    {venue.event.name}
                  </p>
                  <p className="mt-1 text-[12px] text-black/46">
                    {venue.event.timeLabel}
                    {venue.event.ticketStatus ? ` · ${venue.event.ticketStatus}` : ""}
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="mt-6 space-y-3 border-t border-black/[0.08] pt-5 text-[13px] text-black/58">
            {venue.address && (
              <div className="flex gap-3">
                <MapPin size={16} className="mt-0.5 shrink-0 text-black/36" />
                <span>{venue.address}</span>
              </div>
            )}
            {venue.parking && venue.parking !== "Unknown" && (
              <div className="flex gap-3">
                <Check size={16} className="mt-0.5 shrink-0 text-black/36" />
                <span>Parking: {venue.parking}</span>
              </div>
            )}
            {venue.dressCode && venue.dressCode !== "Unknown" && (
              <div className="flex gap-3">
                <Check size={16} className="mt-0.5 shrink-0 text-black/36" />
                <span>{venue.dressCode}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="shrink-0 border-t border-black/[0.08] bg-[#f7f5ef]/96 p-4 backdrop-blur-xl sm:p-5">
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <a
            href={directionsUrl(venue)}
            target="_blank"
            rel="noreferrer"
            className="flex h-13 items-center justify-center gap-2 rounded-full bg-[#171716] px-5 text-[13px] font-semibold text-white transition hover:bg-black focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ff5c35]"
          >
            <Navigation size={17} />
            Get directions
          </a>
          {venue.event?.sourceUrl ? (
            <a
              href={venue.event.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="flex h-13 items-center justify-center gap-2 rounded-full border border-black/[0.1] bg-white px-4 text-[13px] font-semibold text-black transition hover:border-black/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ff5c35]"
              aria-label="Open tickets"
            >
              Tickets <ArrowUpRight size={15} />
            </a>
          ) : venue.website ? (
            <a
              href={venue.website}
              target="_blank"
              rel="noreferrer"
              className="flex h-13 items-center justify-center rounded-full border border-black/[0.1] bg-white px-4 text-[13px] font-semibold text-black transition hover:border-black/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ff5c35]"
            >
              Website
            </a>
          ) : (
            <span className="hidden" />
          )}
        </div>
      </div>
    </div>
  );
}

function LoadingPicks() {
  return (
    <div className="space-y-3" aria-label="Finding the best things to do">
      {[0, 1, 2].map((item) => (
        <div
          key={item}
          className="grid animate-pulse grid-cols-[1fr_92px] gap-4 rounded-[1.6rem] border border-black/[0.05] bg-white/55 p-3"
        >
          <div className="space-y-3 px-1 py-1">
            <div className="h-2.5 w-24 rounded-full bg-black/[0.08]" />
            <div className="h-5 w-3/4 rounded-full bg-black/[0.1]" />
            <div className="h-3 w-full rounded-full bg-black/[0.07]" />
            <div className="h-3 w-1/2 rounded-full bg-black/[0.06]" />
          </div>
          <div className="h-[112px] rounded-[1.2rem] bg-black/[0.08]" />
        </div>
      ))}
    </div>
  );
}

export default function Home() {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const userMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const venuesRef = useRef<DiscoveryVenue[]>([]);
  const [data, setData] = useState<DiscoveryResponse | null>(null);
  const [mode, setMode] = useState<DiscoveryMode>("all");
  const [city, setCity] = useState("All 757");
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [selected, setSelected] = useState<DiscoveryVenue | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [mapReady, setMapReady] = useState(false);
  const [mapUnavailable] = useState(() => !process.env.NEXT_PUBLIC_MAPBOX_TOKEN);

  useEffect(() => {
    const timer = window.setTimeout(() => setAppliedQuery(query.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [query]);

  const loadDiscovery = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);

    try {
      const params = new URLSearchParams({ mode, city });
      if (appliedQuery) params.set("q", appliedQuery);
      const response = await fetch(`/api/discover?${params.toString()}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as DiscoveryResponse & { error?: string };
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Could not refresh the 757 right now.");
      }

      setData(payload);
      setError("");
      setSelected((current) => {
        if (current) return payload.venues.find((venue) => venue.id === current.id) || current;
        const sharedId = new URLSearchParams(window.location.search).get("venue");
        return sharedId ? payload.venues.find((venue) => venue.id === sharedId) || null : null;
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not refresh the 757 right now.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [mode, city, appliedQuery]);

  useEffect(() => {
    const task = window.setTimeout(() => void loadDiscovery(), 0);
    return () => window.clearTimeout(task);
  }, [loadDiscovery]);

  useEffect(() => {
    const interval = window.setInterval(() => loadDiscovery(true), 5 * 60 * 1000);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") loadDiscovery(true);
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [loadDiscovery]);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;
    const mapContainer = mapContainerRef.current;
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

    if (!token) {
      return;
    }

    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({
      container: mapContainer,
      style: "mapbox://styles/mapbox/dark-v11",
      center: HAMPTON_ROADS_CENTER,
      zoom: 9.75,
      minZoom: 9.5,
      maxZoom: 17,
      maxBounds: HAMPTON_ROADS_BOUNDS,
      renderWorldCopies: false,
      attributionControl: true,
    });
    mapRef.current = map;
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(mapContainer);

    map.on("load", () => {
      map.resize();
      map.addSource("discovery-venues", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "venue-dots",
        type: "circle",
        source: "discovery-venues",
        filter: ["==", ["get", "isPick"], false],
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 9.5, 2.6, 13, 5.2],
          "circle-color": "#a8a39b",
          "circle-opacity": ["interpolate", ["linear"], ["zoom"], 9.5, 0.24, 12, 0.58],
          "circle-stroke-width": 1,
          "circle-stroke-color": "rgba(255,255,255,0.28)",
        },
      });
      map.addLayer({
        id: "pick-halo",
        type: "circle",
        source: "discovery-venues",
        filter: ["==", ["get", "isPick"], true],
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 9.5, 16, 13, 21],
          "circle-color": "rgba(255,92,53,0.18)",
          "circle-blur": 0.35,
        },
      });
      map.addLayer({
        id: "pick-points",
        type: "circle",
        source: "discovery-venues",
        filter: ["==", ["get", "isPick"], true],
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 9.5, 10, 13, 14],
          "circle-color": "#ff5c35",
          "circle-stroke-width": 2,
          "circle-stroke-color": "#fffaf4",
        },
      });
      map.addLayer({
        id: "pick-labels",
        type: "symbol",
        source: "discovery-venues",
        filter: ["==", ["get", "isPick"], true],
        layout: {
          "text-field": ["get", "pickLabel"],
          "text-size": 11,
          "text-font": ["DIN Offc Pro Bold", "Arial Unicode MS Bold"],
          "text-allow-overlap": true,
        },
        paint: { "text-color": "#ffffff" },
      });
      map.addLayer({
        id: "selected-ring",
        type: "circle",
        source: "discovery-venues",
        filter: ["==", ["get", "selected"], true],
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 9.5, 16, 13, 23],
          "circle-color": "rgba(0,0,0,0)",
          "circle-stroke-width": 3,
          "circle-stroke-color": "#ffffff",
          "circle-opacity": 0.92,
        },
      });

      const handleVenueClick = (event: mapboxgl.MapLayerMouseEvent) => {
        const id = String(event.features?.[0]?.properties?.id || "");
        const venue = venuesRef.current.find((item) => item.id === id);
        if (venue) setSelected(venue);
      };
      map.on("click", "venue-dots", handleVenueClick);
      map.on("click", "pick-points", handleVenueClick);
      for (const layer of ["venue-dots", "pick-points"]) {
        map.on("mouseenter", layer, () => { map.getCanvas().style.cursor = "pointer"; });
        map.on("mouseleave", layer, () => { map.getCanvas().style.cursor = ""; });
      }

      setMapReady(true);
    });

    return () => {
      resizeObserver.disconnect();
      userMarkerRef.current?.remove();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  const visibleVenues = useMemo(() => data?.venues || [], [data?.venues]);
  const pickIds = useMemo(() => new Map((data?.picks || []).map((venue, index) => [venue.id, index])), [data?.picks]);

  useEffect(() => {
    venuesRef.current = visibleVenues;
    const map = mapRef.current;
    if (!mapReady || !map) return;
    const source = map.getSource("discovery-venues") as mapboxgl.GeoJSONSource | undefined;
    source?.setData({
      type: "FeatureCollection",
      features: visibleVenues.map((venue) => {
        const pickIndex = pickIds.get(venue.id);
        return {
          type: "Feature" as const,
          geometry: { type: "Point" as const, coordinates: [venue.lng, venue.lat] },
          properties: {
            id: venue.id,
            isPick: pickIndex !== undefined,
            pickLabel: pickIndex !== undefined ? String(pickIndex + 1) : "",
            selected: selected?.id === venue.id,
          },
        };
      }),
    });
  }, [visibleVenues, pickIds, selected?.id, mapReady]);

  useEffect(() => {
    if (!selected || !mapRef.current) return;
    mapRef.current.flyTo({
      center: [selected.lng, selected.lat],
      zoom: Math.max(12.8, mapRef.current.getZoom()),
      duration: 750,
      essential: true,
    });
    const url = new URL(window.location.href);
    url.searchParams.set("venue", selected.id);
    window.history.replaceState({}, "", `${url.pathname}${url.search}`);
  }, [selected]);

  function closeDetail() {
    setSelected(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("venue");
    window.history.replaceState({}, "", `${url.pathname}${url.search}`);
  }

  function chooseForMe() {
    const pick = data?.picks[0];
    if (pick) setSelected(pick);
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    setAppliedQuery(query.trim());
  }

  function useMyLocation() {
    if (!navigator.geolocation || !mapRef.current) return;
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      if (
        coords.longitude < HAMPTON_ROADS_BOUNDS[0][0] ||
        coords.longitude > HAMPTON_ROADS_BOUNDS[1][0] ||
        coords.latitude < HAMPTON_ROADS_BOUNDS[0][1] ||
        coords.latitude > HAMPTON_ROADS_BOUNDS[1][1]
      ) return;

      const point: [number, number] = [coords.longitude, coords.latitude];
      userMarkerRef.current?.remove();
      const marker = document.createElement("div");
      marker.className = "discovery-user-marker";
      userMarkerRef.current = new mapboxgl.Marker({ element: marker }).setLngLat(point).addTo(mapRef.current!);
      mapRef.current!.flyTo({ center: point, zoom: 13.2, duration: 750 });
    });
  }

  const eyebrow = data?.context.eyebrow.replace(
    "Hampton Roads",
    city === "All 757" ? "Hampton Roads" : city
  );

  return (
    <main className="min-h-dvh bg-[#f7f5ef] text-[#171716] lg:h-dvh lg:overflow-hidden">
      <div className="grid min-h-dvh lg:h-dvh lg:grid-cols-[minmax(390px,460px)_1fr]">
        <section className="relative z-10 flex min-h-dvh min-w-0 flex-col border-black/[0.08] bg-[#f7f5ef] lg:h-dvh lg:min-h-0 lg:border-r">
          {selected ? (
            <VenueDetail venue={selected} onClose={closeDetail} />
          ) : (
            <>
              <header className="flex h-[72px] shrink-0 items-center justify-between border-b border-black/[0.07] px-5 sm:px-6">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-[12px] bg-[#171716] shadow-sm">
                    <span className="h-2.5 w-2.5 rounded-full bg-[#ff5c35]" />
                  </div>
                  <div>
                    <p className="text-[15px] font-semibold leading-none tracking-[-0.035em]">Things To Do 757</p>
                    <p className="mt-1 text-[9px] font-bold uppercase tracking-[0.17em] text-black/35">Hampton Roads</p>
                  </div>
                </div>

                <label className="relative">
                  <span className="sr-only">Choose city</span>
                  <select
                    value={city}
                    onChange={(event) => setCity(event.target.value)}
                    className="h-10 appearance-none rounded-full border border-black/[0.09] bg-white/66 pl-4 pr-9 text-[12px] font-semibold text-black/68 outline-none transition hover:border-black/20 focus:ring-2 focus:ring-[#ff5c35]"
                  >
                    {CITIES.map((item) => <option key={item}>{item}</option>)}
                  </select>
                  <MapPin size={13} className="pointer-events-none absolute right-3.5 top-3.5 text-black/34" />
                </label>
              </header>

              <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-5 pb-8 pt-5 sm:px-6 lg:pb-5">
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.17em] text-black/42">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-30" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                  </span>
                  <span>{eyebrow || "Finding the best moves in Hampton Roads"}</span>
                  {refreshing && <span className="text-black/24">· Refreshing</span>}
                </div>

                <h1 className="mt-3 max-w-[390px] text-[37px] font-semibold leading-[0.96] tracking-[-0.058em] sm:text-[41px]">
                  {data?.context.headline || "Find something worth doing now."}
                </h1>
                <p className="mt-2 max-w-[390px] text-[12px] leading-5 text-black/48">
                  The best scheduled and open options across the 757.
                </p>

                <form onSubmit={submitSearch} className="mt-4 grid grid-cols-[1fr_auto] gap-2">
                  <label className="relative block min-w-0">
                    <span className="sr-only">Search things to do</span>
                    <Search size={15} className="pointer-events-none absolute left-4 top-[15px] text-black/34" />
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Search ideas"
                      className="h-12 w-full rounded-full border border-black/[0.09] bg-white/72 pl-10 pr-10 text-[13px] text-black outline-none placeholder:text-black/32 transition focus:border-black/20 focus:ring-2 focus:ring-[#ff5c35]"
                    />
                    {query && (
                      <button
                        type="button"
                        onClick={() => setQuery("")}
                        className="absolute right-2.5 top-2.5 flex h-7 w-7 items-center justify-center rounded-full text-black/34 hover:bg-black/[0.05] hover:text-black"
                        aria-label="Clear search"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </label>
                  <button
                    type="button"
                    onClick={chooseForMe}
                    disabled={!data?.picks.length}
                    className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-[#ff5c35] px-4 text-[12px] font-semibold text-white shadow-[0_12px_30px_rgba(255,92,53,0.22)] transition hover:bg-[#eb4f2b] disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-black"
                  >
                    <Sparkles size={15} />
                    Pick for me
                  </button>
                </form>

                <div className="mt-2.5 grid grid-cols-4 gap-1" role="tablist" aria-label="Discovery categories">
                  {MODES.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      role="tab"
                      aria-selected={mode === item.id}
                      onClick={() => setMode(item.id)}
                      className={`h-9 min-w-0 whitespace-nowrap rounded-full px-1 text-[10px] font-semibold leading-none transition sm:px-3 sm:text-[11px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ff5c35] ${
                        mode === item.id
                          ? "bg-[#171716] text-white"
                          : "bg-black/[0.05] text-black/52 hover:bg-black/[0.08] hover:text-black/72"
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>

                <div className="mt-4">
                  {loading && !data ? (
                    <LoadingPicks />
                  ) : error && !data ? (
                    <div className="rounded-[1.6rem] border border-black/[0.08] bg-white/72 p-6 text-center">
                      <p className="text-[15px] font-semibold">The 757 update is taking a minute.</p>
                      <p className="mt-2 text-[12px] text-black/46">{error}</p>
                      <button
                        type="button"
                        onClick={() => loadDiscovery()}
                        className="mt-4 rounded-full bg-[#171716] px-5 py-2.5 text-[12px] font-semibold text-white"
                      >
                        Try again
                      </button>
                    </div>
                  ) : data?.picks.length ? (
                    <div className="space-y-2.5">
                      {data.picks.map((venue, index) => (
                        <PickCard key={venue.id} venue={venue} rank={index} onSelect={setSelected} />
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-[1.6rem] border border-black/[0.08] bg-white/72 p-6 text-center">
                      <p className="text-[15px] font-semibold">No clean matches yet.</p>
                      <p className="mt-2 text-[12px] leading-5 text-black/46">
                        Clear the search or try another category. We will not invent a weak recommendation.
                      </p>
                    </div>
                  )}
                </div>

                <div className="mt-4 flex items-center justify-between border-t border-black/[0.07] pt-3 text-[10px] font-medium text-black/34">
                  <span className="inline-flex items-center gap-1.5">
                    <Clock3 size={12} />
                    {data?.freshness.label || "Updating now"}
                  </span>
                  <span>{data ? `${data.context.resultCount} options considered` : "Across the 757"}</span>
                </div>
              </div>
            </>
          )}
        </section>

        <section className="relative min-h-[410px] overflow-hidden bg-[#1b1b1a] lg:min-h-0" aria-label="757 venue map">
          <div className="absolute inset-0">
            <div ref={mapContainerRef} className="h-full w-full" />
          </div>

          {mapUnavailable && (
            <div className="absolute inset-0 flex items-center justify-center bg-[radial-gradient(circle_at_center,#302f2c_0%,#191918_65%)] px-6 text-center text-white">
              <div>
                <MapPin size={26} className="mx-auto text-[#ff7a59]" />
                <p className="mt-3 text-[15px] font-semibold">The 757 map is unavailable.</p>
                <p className="mt-1 text-[12px] text-white/45">Your three recommendations still work.</p>
              </div>
            </div>
          )}

          <div className="pointer-events-none absolute left-4 top-4 z-10 flex items-center gap-2 rounded-full border border-white/10 bg-black/54 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-white/62 backdrop-blur-xl sm:left-5 sm:top-5">
            <span className="h-1.5 w-1.5 rounded-full bg-[#ff5c35]" />
            757 map · Picks 1–3
          </div>

          <button
            type="button"
            onClick={useMyLocation}
            className="absolute bottom-8 right-4 z-10 flex h-11 w-11 items-center justify-center rounded-full border border-white/12 bg-black/64 text-white shadow-[0_12px_40px_rgba(0,0,0,0.35)] backdrop-blur-xl transition hover:bg-black/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ff5c35] sm:right-5"
            aria-label="Center map on my location"
          >
            <LocateFixed size={17} />
          </button>

          <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/12 to-transparent lg:hidden" />
        </section>
      </div>
    </main>
  );
}
