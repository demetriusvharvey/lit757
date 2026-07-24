"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import "./districts.css";
import {
  ArrowLeft,
  CalendarDays,
  CarFront,
  Flame,
  MapPin,
  Navigation,
  Radio,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  UsersRound,
} from "lucide-react";

type DistrictEvent = {
  id: string;
  name?: string | null;
  start_time?: string | null;
  source_url?: string | null;
};

type DistrictVenue = {
  id: string;
  name: string;
  score: number;
  distanceMiles: number;
};

type District = {
  id: string;
  name: string;
  shortName: string;
  city: string;
  center: { lat: number; lng: number };
  radiusMiles: number;
  accent: string;
  score: number;
  label: string;
  arrivalPressure: number;
  arrivalLabel: string;
  mode: "live" | "forecast";
  confidence: "low" | "medium" | "high";
  updatedAt: string | null;
  eventCountNext24Hours: number;
  eventsActive: number;
  eventsStartingSoon: number;
  nextEvent: DistrictEvent | null;
  venueCount: number;
  scoredVenueCount: number;
  liveSignalCount: number;
  reason: string;
  topVenues: DistrictVenue[];
};

type DistrictPayload = {
  success: boolean;
  generatedAt: string;
  truthNote: string;
  summary: {
    districtCount: number;
    activeDistricts: number;
    liveDistricts: number;
    topDistrict: District | null;
  };
  districts: District[];
  error?: string;
};

const MAP_CENTER: [number, number] = [-76.22, 36.91];

function relativeTime(value: string | null) {
  if (!value) return "Waiting for first update";
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 1) return "Updated just now";
  if (minutes === 1) return "Updated 1 minute ago";
  if (minutes < 60) return `Updated ${minutes} minutes ago`;
  return `Updated ${Math.round(minutes / 60)} hours ago`;
}

function eventTime(value?: string | null) {
  if (!value) return "Time pending";
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function scoreTone(score: number) {
  if (score >= 84) return "hot";
  if (score >= 70) return "heating";
  if (score >= 54) return "building";
  return "calm";
}

export default function DistrictsPage() {
  const [payload, setPayload] = useState<DistrictPayload | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [mapReady, setMapReady] = useState(false);
  const mapEl = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const districtsRef = useRef<District[]>([]);

  async function load(quiet = false) {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    try {
      const response = await fetch("/api/districts", { cache: "no-store" });
      const result = await response.json() as DistrictPayload;
      if (!response.ok || !result.success) throw new Error(result.error || "District activity is unavailable");
      setPayload(result);
      setSelectedId((current) => current || result.summary.topDistrict?.id || result.districts[0]?.id || null);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "District activity is unavailable");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    // Initial data loading is an intentional client-side synchronization with
    // the live district API.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const interval = window.setInterval(() => void load(true), 5 * 60 * 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!token || !mapEl.current || mapRef.current) return;
    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({
      container: mapEl.current,
      style: "mapbox://styles/mapbox/dark-v11",
      center: MAP_CENTER,
      zoom: 8.8,
      minZoom: 8,
      maxZoom: 16,
      maxBounds: [[-76.9, 36.42], [-75.7, 37.38]],
      renderWorldCopies: false,
    });
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
    map.on("load", () => {
      map.addSource("buzz-districts", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "district-glow",
        type: "circle",
        source: "buzz-districts",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["get", "score"], 0, 34, 55, 54, 85, 78, 100, 92],
          "circle-color": ["get", "accent"],
          "circle-opacity": ["interpolate", ["linear"], ["get", "score"], 0, 0.08, 60, 0.16, 100, 0.26],
          "circle-blur": 0.72,
        },
      });
      map.addLayer({
        id: "district-core",
        type: "circle",
        source: "buzz-districts",
        paint: {
          "circle-radius": ["case", ["==", ["get", "selected"], true], 18, 13],
          "circle-color": ["get", "accent"],
          "circle-opacity": 0.94,
          "circle-stroke-width": ["case", ["==", ["get", "selected"], true], 4, 2],
          "circle-stroke-color": "#ffffff",
        },
      });
      map.addLayer({
        id: "district-score",
        type: "symbol",
        source: "buzz-districts",
        layout: {
          "text-field": ["to-string", ["get", "score"]],
          "text-size": 11,
          "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
          "text-allow-overlap": true,
        },
        paint: { "text-color": "#111214" },
      });
      map.addLayer({
        id: "district-label",
        type: "symbol",
        source: "buzz-districts",
        minzoom: 9.2,
        layout: {
          "text-field": ["get", "shortName"],
          "text-size": 12,
          "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
          "text-offset": [0, 2.1],
          "text-anchor": "top",
          "text-allow-overlap": false,
        },
        paint: {
          "text-color": "#ffffff",
          "text-halo-color": "rgba(0,0,0,.75)",
          "text-halo-width": 1.5,
        },
      });
      const click = (event: mapboxgl.MapLayerMouseEvent) => {
        const id = String(event.features?.[0]?.properties?.id || "");
        if (id) setSelectedId(id);
      };
      map.on("click", "district-core", click);
      map.on("mouseenter", "district-core", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "district-core", () => { map.getCanvas().style.cursor = ""; });
      setMapReady(true);
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    districtsRef.current = payload?.districts || [];
    const map = mapRef.current;
    const source = map?.getSource("buzz-districts") as mapboxgl.GeoJSONSource | undefined;
    if (!map || !source) return;
    source.setData({
      type: "FeatureCollection",
      features: districtsRef.current.map((district) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [district.center.lng, district.center.lat] },
        properties: {
          id: district.id,
          shortName: district.shortName,
          score: district.score,
          accent: district.accent,
          selected: district.id === selectedId,
        },
      })),
    });
  }, [payload?.districts, selectedId, mapReady]);

  useEffect(() => {
    if (!selectedId || !mapRef.current) return;
    const district = districtsRef.current.find((item) => item.id === selectedId);
    if (!district) return;
    mapRef.current.easeTo({ center: [district.center.lng, district.center.lat], zoom: 11.2, duration: 650 });
    const url = new URL(window.location.href);
    url.searchParams.set("district", selectedId);
    window.history.replaceState({}, "", `${url.pathname}${url.search}`);
  }, [selectedId]);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("district");
    if (id) {
      // The query string is the external source of truth for deep links.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedId(id);
    }
  }, []);

  const districts = useMemo(() => payload?.districts || [], [payload?.districts]);
  const selected = useMemo(() => districts.find((district) => district.id === selectedId) || districts[0] || null, [districts, selectedId]);

  return (
    <main className="district-shell">
      <header className="district-header">
        <Link href="/" className="district-back"><ArrowLeft /> Back to Buzz</Link>
        <div className="district-brand"><span /><strong>BUZZ AREAS</strong><small>Hampton Roads activity districts</small></div>
        <button type="button" className="district-refresh" onClick={() => void load(true)} disabled={refreshing}><RefreshCw className={refreshing ? "spin" : ""} /> Refresh</button>
      </header>

      <section className="district-hero">
        <div>
          <span className="district-kicker"><Radio /> AREA INTELLIGENCE</span>
          <h1>Know which part of the 757 is <em>moving.</em></h1>
          <p>Traffic, nearby venue forecasts, events, and direct crowd evidence—combined without pretending road congestion is foot traffic.</p>
        </div>
        <div className="district-summary-card">
          <span>STRONGEST AREA NOW</span>
          <strong>{payload?.summary.topDistrict?.shortName || "Loading areas…"}</strong>
          <small>{payload?.summary.topDistrict?.reason || "Collecting the latest district signals"}</small>
          <b>{payload?.summary.topDistrict?.score ?? "--"}<em>AREA SCORE</em></b>
        </div>
      </section>

      <section className="district-truth">
        <ShieldCheck />
        <div><strong>Honest status by design</strong><span>{payload?.truthNote || "Traffic is supporting evidence. Direct crowd evidence is required for Live status."}</span></div>
        <span className="district-truth-count">{payload?.summary.liveDistricts || 0} LIVE · {payload?.summary.activeDistricts || 0} BUILDING+</span>
      </section>

      {error && <button type="button" className="district-error" onClick={() => void load()}>{error} · Tap to retry</button>}

      <section className="district-workspace">
        <div className="district-list">
          <div className="district-list-heading">
            <div><span>RIGHT NOW</span><h2>Activity by area</h2></div>
            <small>{loading ? "Loading…" : `${districts.length} districts · ${relativeTime(payload?.generatedAt || null)}`}</small>
          </div>

          <div className="district-card-grid">
            {districts.map((district, index) => (
              <button
                type="button"
                key={district.id}
                className={`district-card ${selectedId === district.id ? "selected" : ""} ${scoreTone(district.score)}`}
                onClick={() => setSelectedId(district.id)}
                style={{ "--district-accent": district.accent } as React.CSSProperties}
              >
                <div className="district-card-rank">{String(index + 1).padStart(2, "0")}</div>
                <div className="district-card-copy">
                  <div className="district-card-status"><span className={district.mode}>{district.mode === "live" ? <Flame /> : <Sparkles />}{district.mode}</span><small>{district.confidence} confidence</small></div>
                  <h3>{district.shortName}</h3>
                  <p>{district.reason}</p>
                  <div className="district-card-metrics">
                    <span><CarFront /> {district.arrivalPressure} arrivals</span>
                    <span><CalendarDays /> {district.eventCountNext24Hours} events</span>
                    <span><MapPin /> {district.venueCount} places</span>
                  </div>
                </div>
                <div className="district-score"><b>{district.score}</b><small>{district.label}</small></div>
              </button>
            ))}
          </div>
        </div>

        <aside className="district-map-column">
          <div className="district-map-card">
            <div className="district-map-toolbar"><span><i /> DISTRICT MAP</span><small>Tap an area to inspect it</small></div>
            <div ref={mapEl} className="district-map" />
            {!process.env.NEXT_PUBLIC_MAPBOX_TOKEN && <div className="district-map-unavailable"><MapPin /><strong>Map unavailable</strong><span>District cards are still current.</span></div>}
          </div>

          {selected && (
            <div className="district-detail" style={{ "--district-accent": selected.accent } as React.CSSProperties}>
              <div className="district-detail-head">
                <div><span>{selected.city} · {selected.mode}</span><h2>{selected.name}</h2><p>{selected.arrivalLabel} · {relativeTime(selected.updatedAt)}</p></div>
                <div><b>{selected.score}</b><small>AREA SCORE</small></div>
              </div>

              <div className="district-detail-stats">
                <div><CarFront /><strong>{selected.arrivalPressure}</strong><span>Arrival pressure</span></div>
                <div><CalendarDays /><strong>{selected.eventCountNext24Hours}</strong><span>Next 24 hours</span></div>
                <div><UsersRound /><strong>{selected.liveSignalCount}</strong><span>Direct live signals</span></div>
              </div>

              {selected.nextEvent && (
                <a className="district-next-event" href={selected.nextEvent.source_url || "#"} target={selected.nextEvent.source_url ? "_blank" : undefined} rel="noreferrer">
                  <CalendarDays /><div><span>NEXT EVENT</span><strong>{selected.nextEvent.name || "Upcoming event"}</strong><small>{eventTime(selected.nextEvent.start_time)}</small></div>
                </a>
              )}

              <div className="district-top-venues">
                <span>TOP PLACES IN THIS AREA</span>
                {selected.topVenues.length ? selected.topVenues.map((venue) => (
                  <div key={venue.id}><i>{venue.name.slice(0, 1)}</i><strong>{venue.name}</strong><small>{venue.distanceMiles.toFixed(1)} mi from area center</small><b>{venue.score}</b></div>
                )) : <p>No scored venues in this radius yet.</p>}
              </div>

              <a className="district-directions" href={`https://www.google.com/maps/dir/?api=1&destination=${selected.center.lat},${selected.center.lng}`} target="_blank" rel="noreferrer"><Navigation /> Get directions to {selected.shortName}</a>
            </div>
          )}
        </aside>
      </section>
    </main>
  );
}
