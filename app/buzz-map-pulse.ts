import type mapboxgl from "mapbox-gl";
import {
  BUZZING_PIN_MIN_SCORE,
  ON_FIRE_PIN_MIN_SCORE,
} from "./buzz-map-presentation";

const CLOSE_GLOW_MIN_ZOOM = 12.25;
const CLOSE_PULSE_MIN_ZOOM = 12.75;
const STATUS_LABEL_MIN_ZOOM = 14.25;

export const BUZZ_PULSE_LAYER_IDS = ["buzz-all-pulse"] as const;
export const EVENT_PULSE_LAYER_IDS = ["buzz-all-event-pulse"] as const;
export const BUZZ_GLOW_LAYER_IDS = ["buzz-all-glow"] as const;
export const BUZZ_LABEL_LAYER_IDS = ["buzz-all-status-label"] as const;

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

function glowPaint(): mapboxgl.CircleLayerSpecification["paint"] {
  return {
    "circle-radius": [
      "interpolate",
      ["linear"],
      ["zoom"],
      CLOSE_GLOW_MIN_ZOOM,
      15,
      15,
      20,
      18,
      23,
    ],
    "circle-color": pulseColor,
    "circle-opacity": [
      "interpolate",
      ["linear"],
      ["zoom"],
      CLOSE_GLOW_MIN_ZOOM,
      0.1,
      15,
      0.16,
      18,
      0.2,
    ],
    "circle-blur": 0.68,
    "circle-stroke-color": pulseColor,
    "circle-stroke-width": 1.2,
    "circle-stroke-opacity": 0.48,
  };
}

function pulsePaint(): mapboxgl.CircleLayerSpecification["paint"] {
  return {
    "circle-radius": 22,
    "circle-color": pulseColor,
    "circle-opacity": 0.07,
    "circle-blur": 0.48,
    "circle-stroke-color": pulseColor,
    "circle-stroke-width": 1.5,
    "circle-stroke-opacity": 0.5,
  };
}

function eventPulsePaint(): mapboxgl.CircleLayerSpecification["paint"] {
  return {
    "circle-radius": 20,
    "circle-color": "#8b5cf6",
    "circle-opacity": 0.09,
    "circle-blur": 0.55,
    "circle-stroke-color": "#c4b5fd",
    "circle-stroke-width": 1.4,
    "circle-stroke-opacity": 0.48,
  };
}

function statusLabelLayer(): mapboxgl.SymbolLayerSpecification {
  return {
    id: BUZZ_LABEL_LAYER_IDS[0],
    type: "symbol",
    source: "buzz-map-venues",
    minzoom: STATUS_LABEL_MIN_ZOOM,
    filter: buzzingFilter,
    layout: {
      "text-field": [
        "step",
        ["get", "score"],
        "BUZZING",
        ON_FIRE_PIN_MIN_SCORE,
        "ON FIRE",
      ],
      "text-size": ["interpolate", ["linear"], ["zoom"], STATUS_LABEL_MIN_ZOOM, 9, 17, 10.5],
      "text-offset": [0, -3.15],
      "text-anchor": "center",
      "text-letter-spacing": 0.12,
      "text-allow-overlap": false,
      "text-ignore-placement": false,
      "symbol-sort-key": ["-", 100, ["get", "score"]],
    },
    paint: {
      "text-color": pulseColor,
      "text-halo-color": "rgba(4,7,11,.96)",
      "text-halo-width": 2,
      "text-halo-blur": 0.5,
    },
  };
}

/**
 * The heatmap owns the wide-area view. Individual venue treatments only fade
 * in once users are zoomed far enough that a specific block or venue is the
 * question. This keeps the map calm and prevents animated halos from reading
 * as rendering artifacts at neighborhood zoom.
 */
export function addBuzzPulseLayers(map: mapboxgl.Map) {
  map.addLayer({
    id: BUZZ_GLOW_LAYER_IDS[0],
    type: "circle",
    source: "buzz-map-venues",
    minzoom: CLOSE_GLOW_MIN_ZOOM,
    filter: buzzingFilter,
    paint: glowPaint(),
  });

  map.addLayer({
    id: BUZZ_PULSE_LAYER_IDS[0],
    type: "circle",
    source: "buzz-map-venues",
    minzoom: CLOSE_PULSE_MIN_ZOOM,
    filter: buzzingFilter,
    paint: pulsePaint(),
  });

  map.addLayer({
    id: EVENT_PULSE_LAYER_IDS[0],
    type: "circle",
    source: "buzz-map-venues",
    minzoom: CLOSE_PULSE_MIN_ZOOM,
    filter: eventSoonFilter,
    paint: eventPulsePaint(),
  });

  map.addLayer(statusLabelLayer());
}

export function buzzPulseFrame(timestamp: number) {
  const progress = (timestamp % 2_600) / 2_600;
  const eased = 1 - (1 - progress) ** 2;
  return {
    radius: 20 + eased * 13,
    opacity: 0.1 - eased * 0.085,
    strokeOpacity: 0.58 - eased * 0.5,
    strokeWidth: 1.6 - eased * 0.45,
  };
}

function eventPulseFrame(timestamp: number) {
  const progress = (timestamp % 3_000) / 3_000;
  const eased = 1 - (1 - progress) ** 2;
  return {
    radius: 19 + eased * 9,
    opacity: 0.1 - eased * 0.075,
    strokeOpacity: 0.5 - eased * 0.4,
  };
}

/**
 * A deliberately slow, low-contrast pulse keeps hot venues visible without
 * making the map shimmer. Animation is capped around 24fps and disappears
 * entirely for reduced-motion users, who still retain the static glow/label.
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
    if (timestamp - lastPaintAt < 42) return;
    lastPaintAt = timestamp;

    const buzz = buzzPulseFrame(timestamp);
    BUZZ_PULSE_LAYER_IDS.forEach((layerId) => {
      if (!map.getLayer(layerId)) return;
      map.setPaintProperty(layerId, "circle-radius", [
        "interpolate",
        ["linear"],
        ["get", "score"],
        BUZZING_PIN_MIN_SCORE,
        buzz.radius,
        100,
        buzz.radius + 3,
      ]);
      map.setPaintProperty(layerId, "circle-opacity", buzz.opacity);
      map.setPaintProperty(layerId, "circle-stroke-opacity", buzz.strokeOpacity);
      map.setPaintProperty(layerId, "circle-stroke-width", buzz.strokeWidth);
    });

    const event = eventPulseFrame(timestamp);
    EVENT_PULSE_LAYER_IDS.forEach((layerId) => {
      if (!map.getLayer(layerId)) return;
      map.setPaintProperty(layerId, "circle-radius", event.radius);
      map.setPaintProperty(layerId, "circle-opacity", event.opacity);
      map.setPaintProperty(layerId, "circle-stroke-opacity", event.strokeOpacity);
    });
  };

  animationFrame = window.requestAnimationFrame(animate);
  return () => window.cancelAnimationFrame(animationFrame);
}
