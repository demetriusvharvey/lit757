"use client";

import { useEffect } from "react";
import mapboxgl from "mapbox-gl";

declare global {
  interface Window {
    __lit757Map?: mapboxgl.Map;
    __lit757LocationPatched?: boolean;
  }
}

const LOCATION_STORAGE_KEY = "lit757-user-location";
const LOCATION_ENABLED_KEY = "lit757-location-enabled";

type SavedLocation = {
  latitude: number;
  longitude: number;
  updatedAt?: number;
};

export default function LocationExperience() {
  useEffect(() => {
    let destroyed = false;
    let controlsHost: HTMLDivElement | null = null;
    let watchId: number | null = null;
    let currentZoom = 14.6;

    if (!window.__lit757LocationPatched) {
      window.__lit757LocationPatched = true;
      const originalAddControl = mapboxgl.Map.prototype.addControl;
      mapboxgl.Map.prototype.addControl = function patchedAddControl(control, position) {
        window.__lit757Map = this;
        window.dispatchEvent(new CustomEvent("lit757:map-ready"));
        return originalAddControl.call(this, control, position);
      };
    }

    const readSaved = (): SavedLocation | null => {
      try {
        const raw = localStorage.getItem(LOCATION_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as SavedLocation;
        if (!Number.isFinite(parsed.latitude) || !Number.isFinite(parsed.longitude)) return null;
        return parsed;
      } catch {
        return null;
      }
    };

    const centerMap = (latitude: number, longitude: number, zoom = currentZoom) => {
      const map = window.__lit757Map;
      if (!map) return false;
      map.resize();
      map.stop();
      map.easeTo({ center: [longitude, latitude], zoom, duration: 700 });
      return true;
    };

    const centerSaved = (zoom = currentZoom) => {
      const saved = readSaved();
      return saved ? centerMap(saved.latitude, saved.longitude, zoom) : false;
    };

    const retryCenter = (latitude: number, longitude: number, attempts = 18) => {
      if (destroyed || attempts <= 0) return;
      if (!centerMap(latitude, longitude)) {
        window.setTimeout(() => retryCenter(latitude, longitude, attempts - 1), 180);
      }
    };

    const updateControls = (active: boolean, labelText?: string) => {
      controlsHost?.classList.toggle("location-active", active);
      const label = controlsHost?.querySelector("[data-location-label]");
      if (label && labelText) label.textContent = labelText;
    };

    const saveAndCenter = (position: GeolocationPosition) => {
      const { latitude, longitude } = position.coords;
      localStorage.setItem(
        LOCATION_STORAGE_KEY,
        JSON.stringify({ latitude, longitude, updatedAt: Date.now() }),
      );
      localStorage.setItem(LOCATION_ENABLED_KEY, "true");
      retryCenter(latitude, longitude);
      updateControls(true, "Near me");
    };

    const onLocationError = (error: GeolocationPositionError) => {
      if (error.code === error.PERMISSION_DENIED) {
        localStorage.setItem(LOCATION_ENABLED_KEY, "false");
        updateControls(false, "Enable location");
      } else {
        updateControls(false, "Try location again");
      }
    };

    const startLocation = () => {
      if (!navigator.geolocation) {
        updateControls(false, "Location unavailable");
        return;
      }

      navigator.geolocation.getCurrentPosition(saveAndCenter, onLocationError, {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 30000,
      });

      if (watchId === null) {
        watchId = navigator.geolocation.watchPosition(saveAndCenter, onLocationError, {
          enableHighAccuracy: true,
          timeout: 20000,
          maximumAge: 60000,
        });
      }
    };

    const installControls = () => {
      if (destroyed) return;
      const mapSection = document.querySelector<HTMLElement>(".mobile-native-map");
      if (!mapSection) {
        window.setTimeout(installControls, 120);
        return;
      }

      const existing = mapSection.querySelector<HTMLDivElement>(".location-map-controls");
      if (existing) {
        controlsHost = existing;
      } else {
        controlsHost = document.createElement("div");
        controlsHost.className = "location-map-controls";
        controlsHost.innerHTML = `
          <button type="button" class="location-center-button" aria-label="Center map on my location">
            <span class="location-dot"></span>
            <span data-location-label>Use my location</span>
          </button>
          <button type="button" class="nearby-radius-button" aria-label="Change nearby radius">Nearby · 1 mi</button>
        `;
        mapSection.appendChild(controlsHost);
      }

      controlsHost.querySelector(".location-center-button")?.addEventListener("click", () => {
        const saved = readSaved();
        if (saved) retryCenter(saved.latitude, saved.longitude);
        startLocation();
      });

      const radiusButton = controlsHost.querySelector<HTMLButtonElement>(".nearby-radius-button");
      const radii = [
        { label: "Nearby · 1 mi", zoom: 14.6 },
        { label: "Nearby · 3 mi", zoom: 12.9 },
        { label: "Nearby · 10 mi", zoom: 10.8 },
      ];
      let radiusIndex = 0;
      radiusButton?.addEventListener("click", () => {
        radiusIndex = (radiusIndex + 1) % radii.length;
        const radius = radii[radiusIndex];
        currentZoom = radius.zoom;
        radiusButton.textContent = radius.label;
        if (!centerSaved(radius.zoom)) startLocation();
      });

      const saved = readSaved();
      if (saved) {
        updateControls(true, "Near me");
        retryCenter(saved.latitude, saved.longitude);
      }

      if (localStorage.getItem(LOCATION_ENABLED_KEY) !== "false") {
        startLocation();
      }
    };

    const recenterAfterDiscovery = () => {
      const saved = readSaved();
      if (!saved || localStorage.getItem(LOCATION_ENABLED_KEY) === "false") return;
      window.setTimeout(() => retryCenter(saved.latitude, saved.longitude), 850);
    };

    window.addEventListener("lit757:map-ready", recenterAfterDiscovery);
    window.addEventListener("activity757:discovery", recenterAfterDiscovery);
    installControls();

    return () => {
      destroyed = true;
      if (watchId !== null && navigator.geolocation) navigator.geolocation.clearWatch(watchId);
      window.removeEventListener("lit757:map-ready", recenterAfterDiscovery);
      window.removeEventListener("activity757:discovery", recenterAfterDiscovery);
      controlsHost?.remove();
    };
  }, []);

  return null;
}
