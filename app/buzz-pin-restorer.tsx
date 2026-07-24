"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type mapboxgl from "mapbox-gl";
import { useMapController } from "./map-controller";

type Venue = {
  id: string;
  name: string;
  lat: number | string;
  lng: number | string;
  activity?: { score?: number };
};

type DiscoveryPayload = { venues?: Venue[]; picks?: Venue[] };
type TapCycle = { ids: string[]; index: number; x: number; y: number; at: number };

const SOURCE_ID = "buzz-restored-visible-venues";
const HITBOX_ID = "buzz-restored-pin-hitbox";
const HALO_ID = "buzz-restored-pin-halo";
const PIN_ID = "buzz-restored-pins";
const SCORE_ID = "buzz-restored-pin-score";
const TAP_RADIUS = 27;
const OLD_LAYER_IDS = [
  "buzz-mobile-clusters",
  "buzz-mobile-cluster-count",
  "buzz-mobile-pin-halo",
  "buzz-mobile-pins",
  "buzz-mobile-score",
  "buzz-mobile-hitbox",
];

const validVenue = (venue: Venue) => {
  const latitude = Number(venue.lat);
  const longitude = Number(venue.lng);
  return Number.isFinite(latitude) && Number.isFinite(longitude) && latitude !== 0 && longitude !== 0;
};

export default function BuzzPinRestorer() {
  const { map, selectedVenueId, setSelectedVenueId } = useMapController();
  const [venues, setVenues] = useState<Venue[]>([]);
  const receivedDiscoveryRef = useRef(false);
  const tapCycleRef = useRef<TapCycle | null>(null);
  const mappedRef = useRef<Venue[]>([]);

  const mapped = useMemo(() => venues.filter(validVenue), [venues]);
  useEffect(() => {
    // The Mapbox click listener is imperative and needs the latest filtered
    // venue list without being reinstalled on every data refresh.
    mappedRef.current = mapped;
  }, [mapped]);

  useEffect(() => {
    const receive = (event: Event) => {
      const payload = (event as CustomEvent<DiscoveryPayload>).detail;
      if (!payload) return;
      receivedDiscoveryRef.current = true;
      setVenues(payload.venues || payload.picks || []);
    };

    window.addEventListener("activity757:discovery", receive);
    void fetch("/api/nearby?limit=400", { cache: "no-store" })
      .then(response => response.ok ? response.json() : null)
      .then((payload: DiscoveryPayload | null) => {
        if (!receivedDiscoveryRef.current && payload) setVenues(payload.venues || payload.picks || []);
      })
      .catch(() => undefined);

    return () => window.removeEventListener("activity757:discovery", receive);
  }, []);

  useEffect(() => {
    if (!map) return;
    let cancelled = false;

    const chooseNearest = (event: mapboxgl.MapLayerMouseEvent) => {
      const box: [mapboxgl.PointLike, mapboxgl.PointLike] = [
        [event.point.x - TAP_RADIUS, event.point.y - TAP_RADIUS],
        [event.point.x + TAP_RADIUS, event.point.y + TAP_RADIUS],
      ];
      const unique = new Map<string, number>();
      for (const feature of map.queryRenderedFeatures(box, { layers: [HITBOX_ID] })) {
        const id = String(feature.properties?.id || "");
        if (!id || feature.geometry.type !== "Point") continue;
        const projected = map.project(feature.geometry.coordinates as [number, number]);
        const distance = Math.hypot(projected.x - event.point.x, projected.y - event.point.y);
        const previousDistance = unique.get(id);
        if (previousDistance == null || distance < previousDistance) unique.set(id, distance);
      }
      const ids = [...unique.entries()].sort((left, right) => left[1] - right[1]).map(([id]) => id);
      if (!ids.length) return;

      const previous = tapCycleRef.current;
      const repeated = Boolean(
        previous &&
        Date.now() - previous.at < 1500 &&
        Math.hypot(previous.x - event.point.x, previous.y - event.point.y) < 20 &&
        previous.ids.join("|") === ids.join("|")
      );
      const index = repeated && previous ? (previous.index + 1) % ids.length : 0;
      tapCycleRef.current = { ids, index, x: event.point.x, y: event.point.y, at: Date.now() };
      const venueId = ids[index];
      const venue = mappedRef.current.find(item => String(item.id) === venueId);
      if (!venue) return;
      setSelectedVenueId(venueId);
      if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(10);
      map.easeTo({ center: [Number(venue.lng), Number(venue.lat)], zoom: Math.max(map.getZoom(), 13), duration: 450 });
    };
    const enter = () => { map.getCanvas().style.cursor = "pointer"; };
    const leave = () => { map.getCanvas().style.cursor = ""; };

    const install = () => {
      if (cancelled || map.getSource(SOURCE_ID)) return;

      for (const layerId of OLD_LAYER_IDS) {
        if (map.getLayer(layerId)) map.setLayoutProperty(layerId, "visibility", "none");
      }

      const empty: GeoJSON.FeatureCollection<GeoJSON.Point> = { type: "FeatureCollection", features: [] };
      map.addSource(SOURCE_ID, { type: "geojson", data: empty });

      const heatColor: mapboxgl.ExpressionSpecification = [
        "interpolate", ["linear"], ["get", "score"],
        0, "#667085",
        42, "#3DDC97",
        58, "#C6E84B",
        70, "#FFD54A",
        82, "#FF9F43",
        90, "#FF5C5C",
      ];

      map.addLayer({
        id: HITBOX_ID,
        type: "circle",
        source: SOURCE_ID,
        paint: {
          "circle-radius": TAP_RADIUS,
          "circle-color": "rgba(255,255,255,0.01)",
          "circle-opacity": 0.01,
        },
      });
      map.addLayer({
        id: HALO_ID,
        type: "circle",
        source: SOURCE_ID,
        paint: {
          "circle-radius": ["case", ["==", ["get", "selected"], true], 21, ["interpolate", ["linear"], ["get", "score"], 35, 9, 100, 17]],
          "circle-color": heatColor,
          "circle-opacity": ["case", ["==", ["get", "selected"], true], 0.38, 0.2],
          "circle-blur": 0.72,
        },
      });
      map.addLayer({
        id: PIN_ID,
        type: "circle",
        source: SOURCE_ID,
        paint: {
          "circle-radius": ["case", ["==", ["get", "selected"], true], 11.5, ["interpolate", ["linear"], ["zoom"], 6, 6.5, 11, 8, 16, 10]],
          "circle-color": heatColor,
          "circle-opacity": 1,
          "circle-stroke-width": ["case", ["==", ["get", "selected"], true], 3.5, 2],
          "circle-stroke-color": "#FFFFFF",
        },
      });
      map.addLayer({
        id: SCORE_ID,
        type: "symbol",
        source: SOURCE_ID,
        minzoom: 12.5,
        layout: { "text-field": ["to-string", ["get", "score"]], "text-size": 9.5 },
        paint: { "text-color": "#FFFFFF" },
      });

      map.on("click", HITBOX_ID, chooseNearest);
      map.on("mouseenter", HITBOX_ID, enter);
      map.on("mouseleave", HITBOX_ID, leave);
    };

    if (map.isStyleLoaded()) install();
    else map.once("load", install);

    return () => {
      cancelled = true;
      map.off("load", install);
      if (map.getLayer(HITBOX_ID)) {
        map.off("click", HITBOX_ID, chooseNearest);
        map.off("mouseenter", HITBOX_ID, enter);
        map.off("mouseleave", HITBOX_ID, leave);
      }
    };
  }, [map, setSelectedVenueId]);

  useEffect(() => {
    if (!map) return;
    const source = map.getSource(SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
    if (!source) return;
    const features: GeoJSON.Feature<GeoJSON.Point>[] = mapped.map(venue => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [Number(venue.lng), Number(venue.lat)] },
      properties: {
        id: venue.id,
        name: venue.name,
        score: Math.max(0, Math.min(100, Math.round(Number(venue.activity?.score ?? 0)))),
        selected: venue.id === selectedVenueId,
      },
    }));
    source.setData({ type: "FeatureCollection", features });
  }, [map, mapped, selectedVenueId]);

  return null;
}
