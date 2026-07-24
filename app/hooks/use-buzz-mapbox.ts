"use client";

import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import type { BuzzVenue } from "../buzz-map-model";
import {
  DEFAULT_BUZZ_CENTER,
  hasValidVenueCoordinates,
  venueCoordinates,
  venueScore,
} from "../buzz-map-model";
import { canInitializeMapbox } from "../mapbox-config";

type UseBuzzMapboxOptions = {
  venues: BuzzVenue[];
  selectedVenueId?: string | null;
  onSelectVenue: (venueId: string) => void;
  logoKeyFor: (venue: BuzzVenue) => string;
  logoUrlFor: (venue: BuzzVenue) => string;
};

/**
 * Owns Mapbox's imperative lifecycle so the responsive UI component can stay
 * focused on product state and rendering. The callback ref prevents Mapbox's
 * long-lived event listeners from closing over stale React state.
 */
export function useBuzzMapbox({
  venues,
  selectedVenueId,
  onSelectVenue,
  logoKeyFor,
  logoUrlFor,
}: UseBuzzMapboxOptions) {
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const selectVenueRef = useRef(onSelectVenue);
  const logoUrlsRef = useRef(new Map<string, string>());
  const loadingLogosRef = useRef(new Set<string>());
  const [mapReady, setMapReady] = useState(false);
  const [mapZoom, setMapZoom] = useState(8.8);

  useEffect(() => {
    selectVenueRef.current = onSelectVenue;
  }, [onSelectVenue]);

  useEffect(() => {
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!mapElementRef.current || !canInitializeMapbox(token) || mapRef.current) return;

    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({
      container: mapElementRef.current,
      style: "mapbox://styles/mapbox/dark-v11",
      center: DEFAULT_BUZZ_CENTER,
      zoom: 8.8,
      minZoom: 3,
      maxZoom: 18,
      attributionControl: true,
    });
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");

    const handleLoad = () => setMapReady(true);
    const handleZoom = () => setMapZoom(map.getZoom());
    map.on("load", handleLoad);
    map.on("zoom", handleZoom);
    mapRef.current = map;

    return () => {
      map.off("load", handleLoad);
      map.off("zoom", handleZoom);
      setMapReady(false);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || map.getSource("buzz-map-venues")) return;

    const empty: GeoJSON.FeatureCollection<GeoJSON.Point> = {
      type: "FeatureCollection",
      features: [],
    };
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

    const buzzColor: mapboxgl.ExpressionSpecification = [
      "interpolate",
      ["linear"],
      ["get", "score"],
      0,
      "#64748b",
      45,
      "#34d399",
      60,
      "#a3e635",
      72,
      "#facc15",
      82,
      "#fb923c",
      90,
      "#ef4444",
    ];

    map.addLayer({
      id: "buzz-area-heat",
      type: "heatmap",
      source: "buzz-map-venues",
      maxzoom: 12,
      paint: {
        "heatmap-weight": [
          "interpolate",
          ["linear"],
          ["get", "score"],
          0,
          0.03,
          45,
          0.18,
          65,
          0.48,
          80,
          0.8,
          100,
          1,
        ],
        "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 4, 0.5, 9, 1.05, 11.8, 1.8],
        "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 4, 18, 8, 32, 11.8, 58],
        "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 4, 0.78, 10.5, 0.94, 12, 0],
        "heatmap-color": [
          "interpolate",
          ["linear"],
          ["heatmap-density"],
          0,
          "rgba(15,23,42,0)",
          0.15,
          "rgba(52,211,153,.35)",
          0.35,
          "rgba(163,230,53,.55)",
          0.58,
          "rgba(250,204,21,.72)",
          0.78,
          "rgba(251,146,60,.88)",
          1,
          "rgba(239,68,68,1)",
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
        "circle-color": [
          "interpolate",
          ["linear"],
          ["coalesce", ["get", "maxScore"], 40],
          35,
          "#34d399",
          60,
          "#facc15",
          78,
          "#fb923c",
          90,
          "#ef4444",
        ],
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
        "circle-color": [
          "interpolate",
          ["linear"],
          ["coalesce", ["get", "maxScore"], 40],
          35,
          "#34d399",
          60,
          "#facc15",
          78,
          "#fb923c",
          90,
          "#ef4444",
        ],
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
        "circle-radius": [
          "case",
          ["==", ["get", "selected"], true],
          29,
          ["interpolate", ["linear"], ["get", "score"], 20, 13, 100, 24],
        ],
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
        "circle-radius": [
          "case",
          ["==", ["get", "selected"], true],
          18,
          ["interpolate", ["linear"], ["zoom"], 10.5, 12.5, 15, 15.5],
        ],
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
      paint: {
        "circle-radius": 30,
        "circle-color": "rgba(0,0,0,.01)",
        "circle-opacity": 0.01,
      },
    });

    const handleMissingLogo = (event: { id: string }) => {
      const id = event.id;
      if (
        !id.startsWith("venue-logo-") ||
        map.hasImage(id) ||
        loadingLogosRef.current.has(id)
      ) {
        return;
      }
      const logoUrl = logoUrlsRef.current.get(id);
      if (!logoUrl) return;
      loadingLogosRef.current.add(id);
      void map
        .loadImage(logoUrl)
        .then((image) => {
          if (!map.hasImage(id)) map.addImage(id, image.data, { pixelRatio: 2 });
        })
        .catch(() => undefined)
        .finally(() => loadingLogosRef.current.delete(id));
    };
    const handleVenueClick = (event: mapboxgl.MapLayerMouseEvent) => {
      const id = String(event.features?.[0]?.properties?.id || "");
      if (id) selectVenueRef.current(id);
    };
    const handleHeatClick = (event: mapboxgl.MapLayerMouseEvent) => {
      if (map.getZoom() >= 10.5) return;
      map.easeTo({
        center: event.lngLat,
        zoom: Math.min(12, map.getZoom() + 2.3),
        duration: 520,
      });
    };
    const handleHeatHubClick = (event: mapboxgl.MapLayerMouseEvent) => {
      map.easeTo({
        center: event.lngLat,
        zoom: Math.min(14, map.getZoom() + 2.4),
        duration: 520,
      });
    };
    const showPointer = () => {
      map.getCanvas().style.cursor = "pointer";
    };
    const hidePointer = () => {
      map.getCanvas().style.cursor = "";
    };

    map.on("styleimagemissing", handleMissingLogo);
    map.on("click", "buzz-pin-hitbox", handleVenueClick);
    map.on("click", "buzz-area-heat", handleHeatClick);
    map.on("click", "buzz-heat-hubs", handleHeatHubClick);
    map.on("mouseenter", "buzz-pin-hitbox", showPointer);
    map.on("mouseleave", "buzz-pin-hitbox", hidePointer);
    map.on("mouseenter", "buzz-heat-hubs", showPointer);
    map.on("mouseleave", "buzz-heat-hubs", hidePointer);

    return () => {
      map.off("styleimagemissing", handleMissingLogo);
      map.off("click", "buzz-pin-hitbox", handleVenueClick);
      map.off("click", "buzz-area-heat", handleHeatClick);
      map.off("click", "buzz-heat-hubs", handleHeatHubClick);
      map.off("mouseenter", "buzz-pin-hitbox", showPointer);
      map.off("mouseleave", "buzz-pin-hitbox", hidePointer);
      map.off("mouseenter", "buzz-heat-hubs", showPointer);
      map.off("mouseleave", "buzz-heat-hubs", hidePointer);
    };
  }, [mapReady]);

  useEffect(() => {
    const features: GeoJSON.Feature<GeoJSON.Point>[] = venues
      .filter(hasValidVenueCoordinates)
      .map((venue) => {
        const logoKey = logoKeyFor(venue);
        logoUrlsRef.current.set(logoKey, logoUrlFor(venue));
        return {
          type: "Feature",
          geometry: { type: "Point", coordinates: venueCoordinates(venue) },
          properties: {
            id: venue.id,
            score: venueScore(venue),
            logoKey,
            selected: selectedVenueId === venue.id,
          },
        };
      });
    const collection: GeoJSON.FeatureCollection<GeoJSON.Point> = {
      type: "FeatureCollection",
      features,
    };
    (mapRef.current?.getSource("buzz-map-venues") as mapboxgl.GeoJSONSource | undefined)?.setData(collection);
    (mapRef.current?.getSource("buzz-map-clusters") as mapboxgl.GeoJSONSource | undefined)?.setData(collection);
  }, [logoKeyFor, logoUrlFor, selectedVenueId, venues]);

  return { mapElementRef, mapRef, mapReady, mapZoom };
}
