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
import {
  ALL_LOGO_MIN_ZOOM,
  DENSE_LOGO_MIN_ZOOM,
  FEATURED_LOGO_MIN_ZOOM,
  isBuzzingPinScore,
  selectFeaturedVenueIds,
} from "../buzz-map-presentation";
import {
  addBuzzPulseLayers,
  startBuzzPulseAnimation,
} from "../buzz-map-pulse";
import {
  activityColor,
  createVenueLogoSprite,
  type MapLogoPresentation,
} from "../buzz-map-logo-sprite";
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
  const logoPresentationRef = useRef(new Map<string, MapLogoPresentation>());
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
    // A rejected or interrupted style request must leave the map in its base
    // fallback state instead of throwing while a separate UI action renders.
    if (!map || !mapReady || !map.isStyleLoaded() || map.getSource("buzz-map-venues")) return;

    const empty: GeoJSON.FeatureCollection<GeoJSON.Point> = {
      type: "FeatureCollection",
      features: [],
    };
    map.addSource("buzz-map-venues", { type: "geojson", data: empty });
    map.addSource("buzz-map-featured", { type: "geojson", data: empty });

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

    addBuzzPulseLayers(map);

    // Medium zoom shows only the hottest real places. Collision handling
    // naturally reveals fewer logos on mobile without maintaining two maps.
    map.addLayer({
      id: "buzz-featured-logo",
      type: "symbol",
      source: "buzz-map-featured",
      minzoom: FEATURED_LOGO_MIN_ZOOM,
      maxzoom: ALL_LOGO_MIN_ZOOM,
      filter: [
        "all",
        ["==", ["get", "selected"], false],
        ["==", ["get", "buzzing"], false],
      ],
      layout: {
        "icon-image": ["get", "logoKey"],
        "icon-size": [
          "interpolate",
          ["linear"],
          ["zoom"],
          FEATURED_LOGO_MIN_ZOOM,
          0.46,
          ALL_LOGO_MIN_ZOOM,
          0.56,
        ],
        "icon-allow-overlap": false,
        "icon-ignore-placement": false,
        "icon-padding": 10,
        "symbol-sort-key": ["-", 100, ["get", "score"]],
      },
    });
    map.addLayer({
      id: "buzz-featured-hot-logo",
      type: "symbol",
      source: "buzz-map-featured",
      minzoom: FEATURED_LOGO_MIN_ZOOM,
      maxzoom: ALL_LOGO_MIN_ZOOM,
      filter: [
        "all",
        ["==", ["get", "selected"], false],
        ["==", ["get", "buzzing"], true],
      ],
      layout: {
        "icon-image": ["get", "logoKey"],
        "icon-size": [
          "interpolate",
          ["linear"],
          ["zoom"],
          FEATURED_LOGO_MIN_ZOOM,
          0.5,
          ALL_LOGO_MIN_ZOOM,
          0.6,
        ],
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
    });
    // Close zoom reveals the wider logo set. The map becomes denser only
    // after users intentionally zoom into a smaller geographic area.
    map.addLayer({
      id: "buzz-all-logo",
      type: "symbol",
      source: "buzz-map-venues",
      minzoom: ALL_LOGO_MIN_ZOOM,
      maxzoom: DENSE_LOGO_MIN_ZOOM,
      filter: [
        "all",
        ["==", ["get", "selected"], false],
        ["==", ["get", "buzzing"], false],
      ],
      layout: {
        "icon-image": ["get", "logoKey"],
        "icon-size": [
          "interpolate",
          ["linear"],
          ["zoom"],
          ALL_LOGO_MIN_ZOOM,
          0.5,
          DENSE_LOGO_MIN_ZOOM,
          0.62,
        ],
        "icon-allow-overlap": false,
        "icon-ignore-placement": false,
        "icon-padding": 8,
        "symbol-sort-key": ["-", 100, ["get", "score"]],
      },
    });
    map.addLayer({
      id: "buzz-all-hot-logo",
      type: "symbol",
      source: "buzz-map-venues",
      minzoom: ALL_LOGO_MIN_ZOOM,
      maxzoom: DENSE_LOGO_MIN_ZOOM,
      filter: [
        "all",
        ["==", ["get", "selected"], false],
        ["==", ["get", "buzzing"], true],
      ],
      layout: {
        "icon-image": ["get", "logoKey"],
        "icon-size": [
          "interpolate",
          ["linear"],
          ["zoom"],
          ALL_LOGO_MIN_ZOOM,
          0.54,
          DENSE_LOGO_MIN_ZOOM,
          0.66,
        ],
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
    });
    map.addLayer({
      id: "buzz-all-logo-dense",
      type: "symbol",
      source: "buzz-map-venues",
      minzoom: DENSE_LOGO_MIN_ZOOM,
      filter: ["==", ["get", "selected"], false],
      layout: {
        "icon-image": ["get", "logoKey"],
        "icon-size": [
          "interpolate",
          ["linear"],
          ["zoom"],
          DENSE_LOGO_MIN_ZOOM,
          0.58,
          17,
          0.74,
        ],
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
    });
    // A selected venue remains prominent at every logo zoom, even when nearby
    // labels would normally win Mapbox collision placement.
    map.addLayer({
      id: "buzz-selected-logo",
      type: "symbol",
      source: "buzz-map-venues",
      minzoom: FEATURED_LOGO_MIN_ZOOM,
      filter: ["==", ["get", "selected"], true],
      layout: {
        "icon-image": ["get", "logoKey"],
        "icon-size": [
          "interpolate",
          ["linear"],
          ["zoom"],
          FEATURED_LOGO_MIN_ZOOM,
          0.64,
          16,
          0.82,
        ],
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
    });

    const logoLayerIds = [
      "buzz-featured-logo",
      "buzz-featured-hot-logo",
      "buzz-all-logo",
      "buzz-all-hot-logo",
      "buzz-all-logo-dense",
      "buzz-selected-logo",
    ];
    const stopBuzzPulse = startBuzzPulseAnimation(map);
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
      const presentation = logoPresentationRef.current.get(id);
      if (!logoUrl || !presentation) return;

      const addLogoSprite = (image?: ImageBitmap | ImageData) => {
        const sprite = createVenueLogoSprite(image, presentation);
        if (sprite && !map.hasImage(id)) {
          map.addImage(id, sprite, { pixelRatio: 2 });
        }
      };

      loadingLogosRef.current.add(id);
      void map
        .loadImage(logoUrl)
        .then((image) => addLogoSprite(image.data))
        .catch(() => addLogoSprite())
        .finally(() => loadingLogosRef.current.delete(id));
    };
    const handleVenueClick = (event: mapboxgl.MapLayerMouseEvent) => {
      const id = String(event.features?.[0]?.properties?.id || "");
      if (id) selectVenueRef.current(id);
    };
    const handleHeatClick = (event: mapboxgl.MapLayerMouseEvent) => {
      const logoAtPoint = map.queryRenderedFeatures(event.point, {
        layers: logoLayerIds,
      }).length > 0;
      if (logoAtPoint || map.getZoom() >= ALL_LOGO_MIN_ZOOM) return;
      map.easeTo({
        center: event.lngLat,
        zoom: Math.min(12, map.getZoom() + 2.3),
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
    logoLayerIds.forEach((layerId) => {
      map.on("click", layerId, handleVenueClick);
      map.on("mouseenter", layerId, showPointer);
      map.on("mouseleave", layerId, hidePointer);
    });
    map.on("click", "buzz-area-heat", handleHeatClick);

    return () => {
      stopBuzzPulse();
      map.off("styleimagemissing", handleMissingLogo);
      logoLayerIds.forEach((layerId) => {
        map.off("click", layerId, handleVenueClick);
        map.off("mouseenter", layerId, showPointer);
        map.off("mouseleave", layerId, hidePointer);
      });
      map.off("click", "buzz-area-heat", handleHeatClick);
    };
  }, [mapReady]);

  useEffect(() => {
    const features: GeoJSON.Feature<GeoJSON.Point>[] = venues
      .filter(hasValidVenueCoordinates)
      .map((venue) => {
        const score = venueScore(venue);
        const logoKey = `${logoKeyFor(venue)}-buzz-${activityColor(score).slice(1)}`;
        logoUrlsRef.current.set(logoKey, logoUrlFor(venue));
        logoPresentationRef.current.set(logoKey, {
          name: venue.name,
          score,
        });
        return {
          type: "Feature",
          geometry: { type: "Point", coordinates: venueCoordinates(venue) },
          properties: {
            id: venue.id,
            score,
            buzzing: isBuzzingPinScore(score),
            logoKey,
            selected: selectedVenueId === venue.id,
          },
        };
      });
    const collection: GeoJSON.FeatureCollection<GeoJSON.Point> = {
      type: "FeatureCollection",
      features,
    };
    const featuredIds = new Set(
      selectFeaturedVenueIds(
        features.map((feature) => ({
          id: String(feature.properties?.id || ""),
          score: Number(feature.properties?.score || 0),
        })),
        selectedVenueId,
      ),
    );
    const featuredCollection: GeoJSON.FeatureCollection<GeoJSON.Point> = {
      type: "FeatureCollection",
      features: features.filter((feature) =>
        featuredIds.has(String(feature.properties?.id || ""))),
    };
    (mapRef.current?.getSource("buzz-map-venues") as mapboxgl.GeoJSONSource | undefined)?.setData(collection);
    (mapRef.current?.getSource("buzz-map-featured") as mapboxgl.GeoJSONSource | undefined)?.setData(featuredCollection);
  }, [logoKeyFor, logoUrlFor, selectedVenueId, venues]);

  return { mapElementRef, mapRef, mapReady, mapZoom };
}
