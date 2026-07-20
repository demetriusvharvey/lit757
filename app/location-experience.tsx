"use client";

import { useEffect } from "react";
import mapboxgl from "mapbox-gl";

declare global {
  interface Window {
    __lit757Map?: mapboxgl.Map;
    __lit757UserLocation?: { latitude: number; longitude: number; updatedAt: number };
  }
}

const LOCATION_STORAGE_KEY = "lit757-user-location";
const LOCATION_MODE_KEY = "lit757-location-enabled";
const LOCATION_ZOOM = 14.4;

export default function LocationExperience() {
  useEffect(() => {
    let destroyed = false;
    let controlsHost: HTMLDivElement | null = null;
    let watchId: number | null = null;

    const findMap = () => {
      if (window.__lit757Map) return window.__lit757Map;
      const container = document.querySelector<HTMLElement>(".mobile-native-mapbox");
      const map = container && (container as HTMLElement & { __mapbox?: mapboxgl.Map }).__mapbox;
      if (map) window.__lit757Map = map;
      return window.__lit757Map;
    };

    const centerMap = (latitude: number, longitude: number, zoom = LOCATION_ZOOM) => {
      const map = findMap();
      if (!map) return false;
      map.resize();
      map.easeTo({ center: [longitude, latitude], zoom, duration: 800 });
      return true;
    };

    const keepCentered = (latitude: number, longitude: number) => {
      let attempts = 0;
      const retry = () => {
        if (destroyed) return;
        if (!centerMap(latitude, longitude) && attempts++ < 35) window.setTimeout(retry, 140);
      };
      retry();
      window.setTimeout(() => centerMap(latitude, longitude), 900);
      window.setTimeout(() => centerMap(latitude, longitude), 2200);
    };

    const setLabel = (text: string, active = false) => {
      controlsHost?.classList.toggle("location-active", active);
      const label = controlsHost?.querySelector("[data-location-label]");
      if (label) label.textContent = text;
    };

    const saveAndCenter = (position: GeolocationPosition) => {
      const { latitude, longitude } = position.coords;
      const saved = { latitude, longitude, updatedAt: Date.now() };
      window.__lit757UserLocation = saved;
      localStorage.setItem(LOCATION_STORAGE_KEY, JSON.stringify(saved));
      localStorage.setItem(LOCATION_MODE_KEY, "true");
      setLabel("Near me", true);
      keepCentered(latitude, longitude);
    };

    const onLocationError = () => {
      localStorage.setItem(LOCATION_MODE_KEY, "false");
      setLabel("Enable location", false);
    };

    const requestLocation = () => {
      if (!navigator.geolocation) return onLocationError();
      setLabel("Locating…", true);
      navigator.geolocation.getCurrentPosition(saveAndCenter, onLocationError, {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 30000,
      });
    };

    const startWatching = () => {
      if (!navigator.geolocation || watchId !== null) return;
      watchId = navigator.geolocation.watchPosition(saveAndCenter, () => undefined, {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 60000,
      });
    };

    const installControls = () => {
      if (destroyed) return;
      const mapSection = document.querySelector<HTMLElement>(".mobile-native-map");
      if (!mapSection) return void window.setTimeout(installControls, 120);

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

      controlsHost.querySelector(".location-center-button")?.addEventListener("click", requestLocation);

      const savedRaw = localStorage.getItem(LOCATION_STORAGE_KEY);
      const enabled = localStorage.getItem(LOCATION_MODE_KEY) !== "false";
      if (savedRaw && enabled) {
        try {
          const saved = JSON.parse(savedRaw) as { latitude: number; longitude: number; updatedAt: number };
          window.__lit757UserLocation = saved;
          setLabel("Near me", true);
          keepCentered(saved.latitude, saved.longitude);
          requestLocation();
          startWatching();
          return;
        } catch {}
      }
      if (enabled) requestLocation();
    };

    installControls();
    return () => {
      destroyed = true;
      if (watchId !== null) navigator.geolocation?.clearWatch(watchId);
      controlsHost?.remove();
    };
  }, []);

  return null;
}
