"use client";

import { useEffect } from "react";
import mapboxgl from "mapbox-gl";

declare global {
  interface Window {
    __lit757Map?: mapboxgl.Map;
    __lit757UserLocation?: { latitude: number; longitude: number; updatedAt: number };
    __lit757MapCaptureInstalled?: boolean;
  }
}

const LOCATION_STORAGE_KEY = "lit757-user-location";
const LOCATION_MODE_KEY = "lit757-location-enabled";
const LOCATION_ZOOM = 14.6;

export default function LocationExperience() {
  useEffect(() => {
    let destroyed = false;
    let controlsHost: HTMLDivElement | null = null;
    let watchId: number | null = null;
    let centerTimers: number[] = [];

    // LocationExperience mounts before MobileHome. Capture the exact Mapbox instance
    // when MobileHome creates it instead of trying to discover a private DOM property.
    if (!window.__lit757MapCaptureInstalled) {
      window.__lit757MapCaptureInstalled = true;
      const OriginalMap = mapboxgl.Map;
      const CapturedMap = class extends OriginalMap {
        constructor(options: mapboxgl.MapOptions) {
          super(options);
          window.__lit757Map = this;
          this.once("load", () => {
            const saved = window.__lit757UserLocation;
            if (saved && localStorage.getItem(LOCATION_MODE_KEY) !== "false") {
              this.resize();
              this.jumpTo({ center: [saved.longitude, saved.latitude], zoom: LOCATION_ZOOM });
            }
          });
        }
      } as typeof mapboxgl.Map;

      try {
        (mapboxgl as unknown as { Map: typeof mapboxgl.Map }).Map = CapturedMap;
      } catch {
        try {
          Object.defineProperty(mapboxgl, "Map", { configurable: true, writable: true, value: CapturedMap });
        } catch {
          // The explicit map registration below still works on compatible builds.
        }
      }
    }

    const clearCenterTimers = () => {
      centerTimers.forEach(timer => window.clearTimeout(timer));
      centerTimers = [];
    };

    const centerMap = (latitude: number, longitude: number, immediate = false) => {
      const map = window.__lit757Map;
      if (!map) return false;
      map.resize();
      const options = { center: [longitude, latitude] as [number, number], zoom: LOCATION_ZOOM };
      if (immediate) map.jumpTo(options);
      else map.easeTo({ ...options, duration: 700 });
      return true;
    };

    const lockToLocation = (latitude: number, longitude: number) => {
      clearCenterTimers();
      let attempts = 0;
      const retry = () => {
        if (destroyed) return;
        if (!centerMap(latitude, longitude, attempts > 1) && attempts++ < 50) {
          centerTimers.push(window.setTimeout(retry, 100));
        }
      };
      retry();
      // Venue data can call fitBounds after the initial geolocation response.
      // Reapply the user view after those asynchronous map updates finish.
      [350, 800, 1400, 2400, 4000].forEach((delay, index) => {
        centerTimers.push(window.setTimeout(() => centerMap(latitude, longitude, index >= 2), delay));
      });
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
      lockToLocation(latitude, longitude);
    };

    const onLocationError = () => {
      setLabel("Enable location", false);
    };

    const requestLocation = () => {
      if (!navigator.geolocation) return onLocationError();
      setLabel("Locating…", true);
      navigator.geolocation.getCurrentPosition(saveAndCenter, onLocationError, {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      });
    };

    const startWatching = () => {
      if (!navigator.geolocation || watchId !== null) return;
      watchId = navigator.geolocation.watchPosition(saveAndCenter, () => undefined, {
        enableHighAccuracy: true,
        timeout: 20000,
        maximumAge: 15000,
      });
    };

    const installControls = () => {
      if (destroyed) return;
      const mapSection = document.querySelector<HTMLElement>(".mobile-native-map");
      if (!mapSection) return void window.setTimeout(installControls, 100);

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
          lockToLocation(saved.latitude, saved.longitude);
          requestLocation();
          startWatching();
          return;
        } catch {}
      }
      if (enabled) {
        requestLocation();
        startWatching();
      }
    };

    installControls();
    return () => {
      destroyed = true;
      clearCenterTimers();
      if (watchId !== null) navigator.geolocation?.clearWatch(watchId);
      controlsHost?.remove();
    };
  }, []);

  return null;
}
