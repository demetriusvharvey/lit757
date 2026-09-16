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
] as const;

export const EVENT_PULSE_LAYER_IDS = [
  "buzz-featured-event-pulse",
  "buzz-all-event-pulse",
] as const;

export const BUZZ_GLOW_LAYER_IDS = [
  "buzz-featured-glow",
  "buzz-all-glow",
] as const;

export const BUZZ_LABEL_LAYER_IDS = [
  "buzz-featured-status-label",
  "buzz-all-status-label",
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

function glowPaint(): mapboxgl.CircleLayerSpecification["paint"] {
  return {
    "circle-radius": [
      "interpolate",
      ["linear"],
      ["zoom"],
      FEATURED_LOGO_MIN_ZOOM,
      25,
      14,
      30,
      18,
      34,
    ],
    "circle-color": pulseColor,
    "circle-opacity": 0.2,
    "circle-blur": 0.28,
    "circle-stroke-color": pulseColor,
    "circle-stroke-width": 2.8,
    "circle-stroke-opacity": 0.88,
  };
}

function pulsePaint(): mapboxgl.CircleLayerSpecification["paint"] {
  return {
    "circle-radius": 34,
    "circle-color": pulseColor,
    "circle-opacity": 0.16,
    "circle-blur": 0.2,
    "circle-stroke-color": pulseColor,
    "circle-stroke-width": 3.2,
    "circle-stroke-opacity": 0.82,
  };
}

function eventPulsePaint(): mapboxgl.CircleLayerSpecification["paint"] {
  return {
    "circle-radius": 25,
    "circle-color": "#8b5cf6",
    "circle-opacity": 0.18,
    "circle-blur": 0.36,
    "circle-stroke-color": "#c4b5fd",
    "circle-stroke-width": 2.2,
    "circle-stroke-opacity": 0.62,
  };
}

function statusLabelLayer(
  id: string,
  source: "buzz-map-featured" | "buzz-map-venues",
  minzoom: number,
  maxzoom?: number,
): mapboxgl.SymbolLayerSpecification {
  return {
    id,
    type: "symbol",
    source,
    minzoom,
    ...(maxzoom == null ? {} : { maxzoom }),
    filter: buzzingFilter,
    layout: {
      "text-field": [
        "step",
        ["get", "score"],
        "BUZZING",
        ON_FIRE_PIN_MIN_SCORE,
        "ON FIRE",
      ],
      "text-size": ["interpolate", ["linear"], ["zoom"], 11.5, 9, 14, 10.5, 17, 12],
      "text-offset": [0, -3.05],
      "text-anchor": "center",
      "text-letter-spacing": 0.13,
      "text-allow-overlap": false,
      "text-ignore-placement": false,
      "symbol-sort-key": ["-", 100, ["get", "score"]],
    },
    paint: {
      "text-color": pulseColor,
      "text-halo-color": "rgba(4,7,11,.96)",
      "text-halo-width": 2.2,
      "text-halo-blur": 0.6,
    },
  };
}

/**
 * Close zoom needs to answer a different question than the heat map: which
 * exact venue is hot? Buzzing venues therefore get a persistent inner glow,
 * an animated outer beacon, and a small status label at close zoom. The logo
 * remains the click target and stays visually dominant.
 */
export function addBuzzPulseLayers(map: mapboxgl.Map) {
  map.addLayer({
    id: BUZZ_GLOW_LAYER_IDS[0],
    type: "circle",
    source: "buzz-map-featured",
    minzoom: FEATURED_LOGO_MIN_ZOOM,
    maxzoom: ALL_LOGO_MIN_ZOOM,
    filter: buzzingFilter,
    paint: glowPaint(),
  });
  map.addLayer({
    id: BUZZ_GLOW_LAYER_IDS[1],
    type: "circle",
    source: "buzz-map-venues",
    minzoom: ALL_LOGO_MIN_ZOOM,
    filter: buzzingFilter,
    paint: glowPaint(),
  });

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
    id: EVENT_PULSE_LAYER_IDS[0],
    type: "circle",
    source: "buzz-map-featured",
    minzoom: FEATURED_LOGO_MIN_ZOOM,
    maxzoom: ALL_LOGO_MIN_ZOOM,
    filter: eventSoonFilter,
    paint: eventPulsePaint(),
  });
  map.addLayer({
    id: EVENT_PULSE_LAYER_IDS[1],
    type: "circle",
    source: "buzz-map-venues",
    minzoom: ALL_LOGO_MIN_ZOOM,
    filter: eventSoonFilter,
    paint: eventPulsePaint(),
  });

  // Labels intentionally begin late enough that neighborhood-level views stay
  // clean. Users see the animated beacon first, then explicit status text as
  // they zoom into individual blocks.
  map.addLayer(statusLabelLayer(
    BUZZ_LABEL_LAYER_IDS[0],
    "buzz-map-featured",
    11.2,
    ALL_LOGO_MIN_ZOOM,
  ));
  map.addLayer(statusLabelLayer(
    BUZZ_LABEL_LAYER_IDS[1],
    "buzz-map-venues",
    ALL_LOGO_MIN_ZOOM,
  ));
}

export function buzzPulseFrame(timestamp: number) {
  const progress = (timestamp % 1_650) / 1_650;
  const eased = 1 - (1 - progress) ** 2;
  return {
    radius: 31 + eased * 22,
    opacity: 0.24 - eased * 0.21,
    strokeOpacity: 0.92 - eased * 0.72,
    strokeWidth: 3.4 - eased * 1.1,
  };
}

function eventPulseFrame(timestamp: number) {
  const progress = (timestamp % 2_100) / 2_100;
  const eased = 1 - (1 - progress) ** 2;
  return {
    radius: 24 + eased * 12,
    opacity: 0.2 - eased * 0.15,
    strokeOpacity: 0.7 - eased * 0.45,
  };
}

/**
 * Animates at about 30fps to keep mobile GPU work bounded. Reduced-motion
 * users still get the persistent high-contrast glow and status label.
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
        buzz.radius + 7,
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
