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

    let destroyed = false;
    let watchId: number | null = null;
    let marker: mapboxgl.Marker | null = null;
    let controlsHost: HTMLDivElement | null = null;
    let initialFocusComplete = false;

    const setLabel = (text: string, active = false) => {
      controlsHost?.classList.toggle("location-active", active);
      const label = controlsHost?.querySelector("[data-location-label]");
      if (label) label.textContent = text;
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
        element.onclick = () => map.easeTo({ center: [location.longitude, location.latitude], zoom: LOCATION_ZOOM, duration: 550 });
        marker = new mapboxgl.Marker({ element, anchor: "center" })
          .setLngLat([location.longitude, location.latitude])
          .addTo(map);
      } else {
        marker.setLngLat([location.longitude, location.latitude]);
      }

      const size = Math.max(46, Math.min(128, 42 + location.accuracy * 0.35));
      marker.getElement().style.setProperty("--user-accuracy-size", `${size}px`);
      marker.getElement().onclick = () => map.easeTo({ center: [location.longitude, location.latitude], zoom: LOCATION_ZOOM, duration: 550 });
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
      destroyed = true;
      if (watchId !== null) navigator.geolocation?.clearWatch(watchId);
      marker?.remove();
      controlsHost?.remove();
      if (destroyed) setUserLocation(null);
    };
  }, [map, setUserLocation]);

  return null;
}
