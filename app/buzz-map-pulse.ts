import type mapboxgl from "mapbox-gl";
import {
  ALL_LOGO_MIN_ZOOM,
  BUZZING_PIN_MIN_SCORE,
  FEATURED_LOGO_MIN_ZOOM,
  ON_FIRE_PIN_MIN_SCORE,
} from "./buzz-map-presentation";

export const BUZZ_PULSE_LAYER_IDS = [
  "buzz-featured-pulse",
  "buzz-all-pulse",
  "buzz-featured-event-pulse",
  "buzz-all-event-pulse",
] as const;

const pulseColor: mapboxgl.ExpressionSpecification = [
  "step",
  ["get", "score"],
  "#fb923c",
  ON_FIRE_PIN_MIN_SCORE,
  "#ef4444",
];

const buzzingFilter: mapboxgl.FilterSpecification = [
  ">=",
  ["get", "score"],
  BUZZING_PIN_MIN_SCORE,
];

const eventSoonFilter: mapboxgl.FilterSpecification = [
  "all",
  ["==", ["get", "eventSoon"], true],
  ["<", ["get", "score"], BUZZING_PIN_MIN_SCORE],
];

function pulsePaint(): mapboxgl.CircleLayerSpecification["paint"] {
  return {
    "circle-radius": 25,
    "circle-color": pulseColor,
    "circle-opacity": 0.18,
    "circle-blur": 0.42,
    "circle-stroke-color": pulseColor,
    "circle-stroke-width": 2.2,
    "circle-stroke-opacity": 0.58,
  };
}

function eventPulsePaint(): mapboxgl.CircleLayerSpecification["paint"] {
  return {
    "circle-radius": 23,
    "circle-color": "#8b5cf6",
    "circle-opacity": 0.19,
    "circle-blur": 0.38,
    "circle-stroke-color": "#c4b5fd",
    "circle-stroke-width": 2.2,
    "circle-stroke-opacity": 0.66,
  };
}

/**
 * The pulse layers sit behind guaranteed-visible logo layers. Orange/red is
 * reserved for strong activity scores; violet means a listed event is close
 * to its scheduled start. Neither treatment claims a headcount.
 */
export function addBuzzPulseLayers(map: mapboxgl.Map) {
  map.addLayer({
    id: BUZZ_PULSE_LAYER_IDS[0],
    type: "circle",
    source: "buzz-map-featured",
    minzoom: FEATURED_LOGO_MIN_ZOOM,
    maxzoom: ALL_LOGO_MIN_ZOOM,
    filter: buzzingFilter,
    paint: pulsePaint(),
  });
  map.addLayer({
    id: BUZZ_PULSE_LAYER_IDS[1],
    type: "circle",
    source: "buzz-map-venues",
    minzoom: ALL_LOGO_MIN_ZOOM,
    filter: buzzingFilter,
    paint: pulsePaint(),
  });
  map.addLayer({
    id: BUZZ_PULSE_LAYER_IDS[2],
    type: "circle",
    source: "buzz-map-featured",
    minzoom: FEATURED_LOGO_MIN_ZOOM,
    maxzoom: ALL_LOGO_MIN_ZOOM,
    filter: eventSoonFilter,
    paint: eventPulsePaint(),
  });
  map.addLayer({
    id: BUZZ_PULSE_LAYER_IDS[3],
    type: "circle",
    source: "buzz-map-venues",
    minzoom: ALL_LOGO_MIN_ZOOM,
    filter: eventSoonFilter,
    paint: eventPulsePaint(),
  });
}

export function buzzPulseFrame(timestamp: number) {
  const progress = (timestamp % 1_800) / 1_800;
  const eased = 1 - (1 - progress) ** 2;
  return {
    radius: 23 + eased * 13,
    opacity: 0.25 - eased * 0.19,
    strokeOpacity: 0.78 - eased * 0.58,
  };
}

/**
 * Animates at 30fps to keep mobile GPU work bounded. Reduced-motion users get
 * a static high-contrast halo with the same buzzing/on-fire meaning.
 */
export function startBuzzPulseAnimation(map: mapboxgl.Map) {
  const reducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;

  if (reducedMotion) return () => undefined;

  let animationFrame = 0;
  let lastPaintAt = 0;
  const animate = (timestamp: number) => {
    animationFrame = window.requestAnimationFrame(animate);
    if (timestamp - lastPaintAt < 33) return;
    lastPaintAt = timestamp;

    const { radius, opacity, strokeOpacity } = buzzPulseFrame(timestamp);

    BUZZ_PULSE_LAYER_IDS.forEach((layerId) => {
      if (!map.getLayer(layerId)) return;
      map.setPaintProperty(layerId, "circle-radius", [
        "interpolate",
        ["linear"],
        ["get", "score"],
        BUZZING_PIN_MIN_SCORE,
        radius,
        100,
        radius + 5,
      ]);
      map.setPaintProperty(layerId, "circle-opacity", opacity);
      map.setPaintProperty(
        layerId,
        "circle-stroke-opacity",
        strokeOpacity,
      );
    });
  };

  animationFrame = window.requestAnimationFrame(animate);
  return () => window.cancelAnimationFrame(animationFrame);
}
