"use client";

import { useEffect } from "react";
import mapboxgl from "mapbox-gl";
import { useMapController } from "./map-controller";

const LOCATION_STORAGE_KEY = "lit757-user-location";
const LOCATION_MODE_KEY = "lit757-location-enabled";
const LOCATION_ZOOM = 14.2;

type SavedLocation = {
  latitude: number;
  longitude: number;
  accuracy: number;
  updatedAt: number;
};

export default function LocationExperience() {
  const { map, setUserLocation } = useMapController();

  useEffect(() => {
    if (!map) return;

    let watchId: number | null = null;
    let marker: mapboxgl.Marker | null = null;
    let controlsHost: HTMLDivElement | null = null;
    let styleElement: HTMLStyleElement | null = document.createElement("style");
    let initialFocusComplete = false;

    styleElement.dataset.lit757MapFoundation = "true";
    styleElement.textContent = `
      @keyframes lit757-user-pulse{0%{transform:scale(.72);opacity:.8}70%,100%{transform:scale(1.35);opacity:0}}
      .user-location-marker{--user-accuracy-size:64px;position:relative;width:30px;height:30px;padding:0;border:0;background:transparent;cursor:pointer;overflow:visible}
      .user-location-accuracy{position:absolute;left:50%;top:50%;width:var(--user-accuracy-size);height:var(--user-accuracy-size);transform:translate(-50%,-50%);border:1px solid rgba(137,104,255,.26);border-radius:50%;background:rgba(108,78,255,.1);box-shadow:0 0 30px rgba(114,77,255,.2)}
      .user-location-pulse{position:absolute;left:6px;top:6px;width:18px;height:18px;border:2px solid rgba(177,153,255,.75);border-radius:50%;animation:lit757-user-pulse 1.8s ease-out infinite}
      .user-location-dot{position:absolute;left:8px;top:8px;width:14px;height:14px;border:3px solid #fff;border-radius:50%;background:#7957ff;box-shadow:0 4px 18px rgba(121,87,255,.72)}
      .user-location-label{position:absolute;left:50%;bottom:27px;transform:translateX(-50%);padding:5px 8px;border:1px solid rgba(255,255,255,.2);border-radius:999px;background:rgba(8,10,15,.94);color:#fff;font:900 9px/1 Inter,Arial,sans-serif;letter-spacing:.12em;box-shadow:0 7px 20px rgba(0,0,0,.38);white-space:nowrap}
      .user-location-marker.compact .user-location-label{display:none}
      .mobile-live-updates-cue{position:absolute;left:50%;bottom:14px;z-index:9;transform:translateX(-50%);display:flex;align-items:center;gap:7px;height:38px;padding:0 14px;border:1px solid rgba(255,255,255,.16);border-radius:999px;background:rgba(7,10,14,.92);color:#fff;font:800 12px/1 Inter,Arial,sans-serif;box-shadow:0 10px 28px rgba(0,0,0,.42);backdrop-filter:blur(16px);white-space:nowrap}
      .mobile-live-updates-cue:active{transform:translateX(-50%) scale(.96)}
      .feed-row.selected{border-color:rgba(151,112,255,.75);box-shadow:0 0 0 2px rgba(129,88,255,.18),0 14px 30px rgba(0,0,0,.28)}
    `;
    document.head.appendChild(styleElement);

    const setLabel = (text: string, active = false) => {
      controlsHost?.classList.toggle("location-active", active);
      const label = controlsHost?.querySelector("[data-location-label]");
      if (label) label.textContent = text;
    };

    const updateMarkerZoomState = () => {
      marker?.getElement().classList.toggle("compact", map.getZoom() < 13);
    };

    const renderMarker = (location: SavedLocation) => {
      setUserLocation(location);
      if (!marker) {
        const element = document.createElement("button");
        element.type = "button";
        element.className = "user-location-marker";
        element.setAttribute("aria-label", "You are here");
        element.innerHTML = `
          <span class="user-location-accuracy" aria-hidden="true"></span>
          <span class="user-location-pulse" aria-hidden="true"></span>
          <span class="user-location-dot" aria-hidden="true"></span>
          <span class="user-location-label">YOU</span>
        `;
        marker = new mapboxgl.Marker({ element, anchor: "center" })
          .setLngLat([location.longitude, location.latitude])
          .addTo(map);
      } else {
        marker.setLngLat([location.longitude, location.latitude]);
      }

      const size = Math.max(46, Math.min(128, 42 + location.accuracy * 0.35));
      marker.getElement().style.setProperty("--user-accuracy-size", `${size}px`);
      marker.getElement().onclick = () => map.easeTo({ center: [location.longitude, location.latitude], zoom: LOCATION_ZOOM, duration: 550 });
      updateMarkerZoomState();
    };

    const savePosition = (position: GeolocationPosition, focus = false) => {
      const location: SavedLocation = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: Math.max(0, position.coords.accuracy || 0),
        updatedAt: Date.now(),
      };
      localStorage.setItem(LOCATION_STORAGE_KEY, JSON.stringify(location));
      localStorage.setItem(LOCATION_MODE_KEY, "true");
      setLabel("Near me", true);
      renderMarker(location);
      if (focus) {
        map.resize();
        map.easeTo({ center: [location.longitude, location.latitude], zoom: LOCATION_ZOOM, duration: initialFocusComplete ? 550 : 0 });
        initialFocusComplete = true;
      }
    };

    const onLocationError = () => {
      localStorage.setItem(LOCATION_MODE_KEY, "false");
      setLabel("Enable location", false);
    };

    const requestLocation = (focus = true) => {
      if (!navigator.geolocation) return onLocationError();
      setLabel("Locating…", true);
      navigator.geolocation.getCurrentPosition(
        position => savePosition(position, focus),
        onLocationError,
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
      );
    };

    const startWatching = () => {
      if (!navigator.geolocation || watchId !== null) return;
      watchId = navigator.geolocation.watchPosition(
        position => savePosition(position, false),
        () => undefined,
        { enableHighAccuracy: true, timeout: 20000, maximumAge: 15000 }
      );
    };

    const mapSection = document.querySelector<HTMLElement>(".mobile-native-map");
    if (mapSection) {
      controlsHost = mapSection.querySelector<HTMLDivElement>(".location-map-controls");
      if (!controlsHost) {
        controlsHost = document.createElement("div");
        controlsHost.className = "location-map-controls";
        controlsHost.innerHTML = `
          <button type="button" class="location-center-button" aria-label="Center map on my location">
            <span class="location-dot"></span>
            <span data-location-label>Near me</span>
          </button>
        `;
        mapSection.appendChild(controlsHost);
      }
      controlsHost.querySelector(".location-center-button")?.addEventListener("click", () => requestLocation(true));
    }

    map.on("zoom", updateMarkerZoomState);

    const enabled = localStorage.getItem(LOCATION_MODE_KEY) !== "false";
    const savedRaw = localStorage.getItem(LOCATION_STORAGE_KEY);
    if (enabled && savedRaw) {
      try {
        const saved = JSON.parse(savedRaw) as SavedLocation;
        renderMarker(saved);
        map.jumpTo({ center: [saved.longitude, saved.latitude], zoom: LOCATION_ZOOM });
        initialFocusComplete = true;
        requestLocation(false);
      } catch {
        requestLocation(true);
      }
    } else if (enabled) {
      requestLocation(true);
    }
    if (enabled) startWatching();

    return () => {
      map.off("zoom", updateMarkerZoomState);
      if (watchId !== null) navigator.geolocation?.clearWatch(watchId);
      marker?.remove();
      controlsHost?.remove();
      styleElement?.remove();
      styleElement = null;
      setUserLocation(null);
    };
  }, [map, setUserLocation]);

  return null;
}
