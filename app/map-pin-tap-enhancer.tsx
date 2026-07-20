"use client";

import { useEffect, useRef } from "react";
import type mapboxgl from "mapbox-gl";
import { useMapController } from "./map-controller";

// Keep the visual pins small, but treat taps within a 48px diameter as intentional.
const TAP_RADIUS_PX = 24;
const PIN_LAYERS = ["mobile-venue-pins", "mobile-live-dot"] as const;

export default function MapPinTapEnhancer() {
  const { map, selectedVenueId } = useMapController();
  const replayingRef = useRef(false);

  useEffect(() => {
    if (!map) return;

    const handleClick = (event: mapboxgl.MapMouseEvent) => {
      if (replayingRef.current) return;

      const availableLayers = PIN_LAYERS.filter(layer => Boolean(map.getLayer(layer)));
      if (!availableLayers.length) return;

      const directHits = map.queryRenderedFeatures(event.point, { layers: [...availableLayers] });
      if (directHits.length) return;

      const box: [mapboxgl.PointLike, mapboxgl.PointLike] = [
        [event.point.x - TAP_RADIUS_PX, event.point.y - TAP_RADIUS_PX],
        [event.point.x + TAP_RADIUS_PX, event.point.y + TAP_RADIUS_PX],
      ];
      const nearby = map.queryRenderedFeatures(box, { layers: [...availableLayers] });
      if (!nearby.length) return;

      const nearest = nearby
        .filter(feature => feature.geometry.type === "Point")
        .map(feature => {
          const coordinates = (feature.geometry as GeoJSON.Point).coordinates as [number, number];
          const projected = map.project(coordinates);
          const distance = Math.hypot(projected.x - event.point.x, projected.y - event.point.y);
          return { projected, distance };
        })
        .sort((left, right) => left.distance - right.distance)[0];

      if (!nearest || nearest.distance > TAP_RADIUS_PX) return;

      replayingRef.current = true;
      try {
        map.fire("click", {
          point: nearest.projected,
          lngLat: map.unproject(nearest.projected),
          originalEvent: event.originalEvent,
        });
      } finally {
        window.setTimeout(() => {
          replayingRef.current = false;
        }, 0);
      }
    };

    map.on("click", handleClick);
    return () => {
      map.off("click", handleClick);
    };
  }, [map]);

  useEffect(() => {
    if (!selectedVenueId || typeof navigator === "undefined" || !("vibrate" in navigator)) return;
    navigator.vibrate(10);
  }, [selectedVenueId]);

  return null;
}
