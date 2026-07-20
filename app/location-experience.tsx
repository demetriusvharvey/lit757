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
const LOCATION_ZOOM = 14.2;

export default function LocationExperience() {
  useEffect(() => {
    let destroyed = false;
    let controlsHost: HTMLDivElement | null = null;
    let watchId: number | null = null;
    let centerTimers: number[] = [];
    let userMovedMap = false;
    let mapListenersInstalled = false;

    if (!window.__lit757MapCaptureInstalled) {
      window.__lit757MapCaptureInstalled = true;
      const originalResize = mapboxgl.Map.prototype.resize;
      const originalEaseTo = mapboxgl.Map.prototype.easeTo;
      const originalJumpTo = mapboxgl.Map.prototype.jumpTo;

      mapboxgl.Map.prototype.resize = function (...args) {
        window.__lit757Map = this;
        return originalResize.apply(this, args);
      };
      mapboxgl.Map.prototype.easeTo = function (...args) {
        window.__lit757Map = this;
        return originalEaseTo.apply(this, args);
      };
      mapboxgl.Map.prototype.jumpTo = function (...args) {
        window.__lit757Map = this;
        return originalJumpTo.apply(this, args);
      };
    }

    const clearCenterTimers = () => {
      centerTimers.forEach(timer => window.clearTimeout(timer));
      centerTimers = [];
    };

    const discoverMap = () => {
      const map = window.__lit757Map;
      if (map) return map;
      if (!document.querySelector(".mobile-native-map .mapboxgl-canvas")) return undefined;
      window.dispatchEvent(new Event("resize"));
      return window.__lit757Map;
    };

    const installMapListeners = (map: mapboxgl.Map) => {
      if (mapListenersInstalled) return;
      mapListenersInstalled = true;
      map.on("dragstart", () => {
        userMovedMap = true;
        clearCenterTimers();
      });
      map.on("zoomstart", event => {
        if (event.originalEvent) {
          userMovedMap = true;
          clearCenterTimers();
        }
      });
      map.on("rotatestart", () => {
        userMovedMap = true;
        clearCenterTimers();
      });
    };

    const centerMap = (latitude: number, longitude: number, immediate = false, force = false) => {
      if (userMovedMap && !force) return false;
      const map = discoverMap();
      if (!map) return false;
      installMapListeners(map);
      map.resize();
      const options = { center: [longitude, latitude] as [number, number], zoom: LOCATION_ZOOM };
      if (immediate) map.jumpTo(options);
      else map.easeTo({ ...options, duration: 650 });
      return true;
    };

    const focusLocationOnce = (latitude: number, longitude: number, force = false) => {
      clearCenterTimers();
      userMovedMap = false;
      const attempts = [0, 250, 700, 1400];
      attempts.forEach((delay, index) => {
        centerTimers.push(window.setTimeout(() => {
          if (!destroyed) centerMap(latitude, longitude, index === attempts.length - 1, force);
        }, delay));
      });
    };

    const setLabel = (text: string, active = false) => {
      controlsHost?.classList.toggle("location-active", active);
      const label = controlsHost?.querySelector("[data-location-label]");
      if (label) label.textContent = text;
    };

    const savePosition = (position: GeolocationPosition, shouldFocus = false) => {
      const { latitude, longitude } = position.coords;
      const saved = { latitude, longitude, updatedAt: Date.now() };
      window.__lit757UserLocation = saved;
      localStorage.setItem(LOCATION_STORAGE_KEY, JSON.stringify(saved));
      localStorage.setItem(LOCATION_MODE_KEY, "true");
      setLabel("Near me", true);
      if (shouldFocus) focusLocationOnce(latitude, longitude, true);
    };

    const onLocationError = () => {
      localStorage.setItem(LOCATION_MODE_KEY, "false");
      setLabel("Enable location", false);
    };

    const requestLocation = (forceFocus = true) => {
      if (!navigator.geolocation) return onLocationError();
      setLabel("Locating…", true);
      navigator.geolocation.getCurrentPosition(
        position => savePosition(position, forceFocus),
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

      controlsHost.querySelector(".location-center-button")?.addEventListener("click", () => requestLocation(true));

      const savedRaw = localStorage.getItem(LOCATION_STORAGE_KEY);
      const enabled = localStorage.getItem(LOCATION_MODE_KEY) !== "false";
      if (savedRaw && enabled) {
        try {
          const saved = JSON.parse(savedRaw) as { latitude: number; longitude: number; updatedAt: number };
          window.__lit757UserLocation = saved;
          setLabel("Near me", true);
          focusLocationOnce(saved.latitude, saved.longitude);
          requestLocation(false);
          startWatching();
          return;
        } catch {}
      }
      if (enabled) {
        requestLocation(true);
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
