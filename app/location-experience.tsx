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
const AUTO_LOCATION_KEY = "lit757-auto-location";

// Capture the real Mapbox instance before any React effects create the map.
// The previous version patched this inside useEffect, which could run too late.
if (typeof window !== "undefined" && !window.__lit757LocationPatched) {
  window.__lit757LocationPatched = true;
  const OriginalMap = mapboxgl.Map;
  try {
    (mapboxgl as unknown as { Map: typeof mapboxgl.Map }).Map = class Lit757Map extends OriginalMap {
      constructor(options: mapboxgl.MapOptions) {
        super(options);
        window.__lit757Map = this;
      }
    } as typeof mapboxgl.Map;
  } catch {
    // The map still works even if the runtime prevents replacing this export.
  }
}

export default function LocationExperience() {
  useEffect(() => {
    let destroyed = false;
    let controlsHost: HTMLDivElement | null = null;
    let watchId: number | null = null;
    let centerRetry: number | null = null;
    let selectedZoom = 14.6;

    const setLabel = (text: string) => {
      const label = controlsHost?.querySelector("[data-location-label]");
      if (label) label.textContent = text;
    };

    const centerMap = (latitude: number, longitude: number, zoom = selectedZoom) => {
      const map = window.__lit757Map;
      if (!map || !map.isStyleLoaded()) return false;
      map.resize();
      map.stop();
      map.easeTo({ center: [longitude, latitude], zoom, duration: 900, essential: true });
      return true;
    };

    const centerWhenReady = (latitude: number, longitude: number, zoom = selectedZoom, attempts = 0) => {
      if (destroyed) return;
      if (centerMap(latitude, longitude, zoom)) return;
      if (attempts >= 30) {
        setLabel("Tap to retry");
        return;
      }
      centerRetry = window.setTimeout(() => centerWhenReady(latitude, longitude, zoom, attempts + 1), 180);
    };

    const saveAndCenter = (position: GeolocationPosition) => {
      const { latitude, longitude, accuracy } = position.coords;
      localStorage.setItem(LOCATION_STORAGE_KEY, JSON.stringify({ latitude, longitude, accuracy, updatedAt: Date.now() }));
      localStorage.setItem(AUTO_LOCATION_KEY, "true");
      controlsHost?.classList.add("location-active");
      setLabel("Near me");
      centerWhenReady(latitude, longitude, selectedZoom);
    };

    const handleLocationError = (error: GeolocationPositionError) => {
      if (error.code === error.PERMISSION_DENIED) {
        localStorage.setItem(AUTO_LOCATION_KEY, "false");
        setLabel("Enable location");
      } else {
        setLabel("Tap to retry");
      }
    };

    const requestLocation = (follow = true) => {
      if (!navigator.geolocation) {
        setLabel("Location unavailable");
        return;
      }
      setLabel("Locating…");
      navigator.geolocation.getCurrentPosition(saveAndCenter, handleLocationError, {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      });
      if (follow && watchId === null) {
        watchId = navigator.geolocation.watchPosition(saveAndCenter, handleLocationError, {
          enableHighAccuracy: true,
          timeout: 20000,
          maximumAge: 30000,
        });
      }
    };

    const useSavedLocation = () => {
      const saved = localStorage.getItem(LOCATION_STORAGE_KEY);
      if (!saved) return false;
      try {
        const { latitude, longitude } = JSON.parse(saved) as { latitude: number; longitude: number };
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
        controlsHost?.classList.add("location-active");
        setLabel("Near me");
        centerWhenReady(latitude, longitude, selectedZoom);
        return true;
      } catch {
        return false;
      }
    };

    const installControls = () => {
      if (destroyed) return;
      const mapSection = document.querySelector<HTMLElement>(".mobile-native-map");
      if (!mapSection) {
        window.setTimeout(installControls, 120);
        return;
      }

      controlsHost = mapSection.querySelector<HTMLDivElement>(".location-map-controls");
      if (!controlsHost) {
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

      controlsHost.querySelector(".location-center-button")?.addEventListener("click", () => requestLocation(true));

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
        selectedZoom = radius.zoom;
        radiusButton.textContent = radius.label;
        if (!useSavedLocation()) requestLocation(true);
      });

      const autoLocation = localStorage.getItem(AUTO_LOCATION_KEY) !== "false";
      useSavedLocation();

      // Once permission has been granted, location remains the default experience.
      // Browsers still control permission, so the app cannot bypass a user denial.
      if (autoLocation && navigator.permissions?.query) {
        navigator.permissions.query({ name: "geolocation" as PermissionName }).then((status) => {
          if (status.state === "granted") requestLocation(true);
          else if (status.state === "prompt" && !localStorage.getItem(LOCATION_STORAGE_KEY)) requestLocation(false);
          else if (status.state === "denied") setLabel("Enable location");
          status.onchange = () => {
            if (status.state === "granted") requestLocation(true);
            if (status.state === "denied") setLabel("Enable location");
          };
        }).catch(() => {
          if (!localStorage.getItem(LOCATION_STORAGE_KEY)) requestLocation(false);
        });
      } else if (autoLocation && !localStorage.getItem(LOCATION_STORAGE_KEY)) {
        requestLocation(false);
      }
    };

    installControls();

    return () => {
      destroyed = true;
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      if (centerRetry !== null) window.clearTimeout(centerRetry);
      controlsHost?.remove();
    };
  }, []);

  return null;
}
