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

export default function LocationExperience() {
  useEffect(() => {
    if (!window.__lit757LocationPatched) {
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
        // If Mapbox's export cannot be patched, the UI remains fully usable.
      }
    }

    let destroyed = false;
    let controlsHost: HTMLDivElement | null = null;

    const centerMap = (latitude: number, longitude: number, zoom = 14.2) => {
      const map = window.__lit757Map;
      if (!map) return false;
      map.resize();
      map.easeTo({ center: [longitude, latitude], zoom, duration: 850 });
      return true;
    };

    const saveAndCenter = (position: GeolocationPosition) => {
      const { latitude, longitude } = position.coords;
      localStorage.setItem(LOCATION_STORAGE_KEY, JSON.stringify({ latitude, longitude, updatedAt: Date.now() }));
      const tryCenter = () => {
        if (!centerMap(latitude, longitude)) window.setTimeout(tryCenter, 180);
      };
      tryCenter();
      controlsHost?.classList.add("location-active");
      const label = controlsHost?.querySelector("[data-location-label]");
      if (label) label.textContent = "Near me";
    };

    const requestLocation = () => {
      if (!navigator.geolocation) return;
      navigator.geolocation.getCurrentPosition(saveAndCenter, () => {
        const label = controlsHost?.querySelector("[data-location-label]");
        if (label) label.textContent = "Enable location";
      }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 120000 });
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
        return;
      }

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

      controlsHost.querySelector(".location-center-button")?.addEventListener("click", requestLocation);
      const radiusButton = controlsHost.querySelector<HTMLButtonElement>(".nearby-radius-button");
      const radii = [
        { label: "Nearby · 1 mi", zoom: 14.2 },
        { label: "Nearby · 3 mi", zoom: 12.8 },
        { label: "Nearby · 10 mi", zoom: 10.8 },
      ];
      let radiusIndex = 0;
      radiusButton?.addEventListener("click", () => {
        radiusIndex = (radiusIndex + 1) % radii.length;
        const radius = radii[radiusIndex];
        radiusButton.textContent = radius.label;
        const saved = localStorage.getItem(LOCATION_STORAGE_KEY);
        if (saved) {
          try {
            const { latitude, longitude } = JSON.parse(saved) as { latitude: number; longitude: number };
            centerMap(latitude, longitude, radius.zoom);
          } catch {}
        } else requestLocation();
      });

      const saved = localStorage.getItem(LOCATION_STORAGE_KEY);
      if (saved) {
        try {
          const { latitude, longitude } = JSON.parse(saved) as { latitude: number; longitude: number };
          controlsHost.classList.add("location-active");
          const label = controlsHost.querySelector("[data-location-label]");
          if (label) label.textContent = "Near me";
          const trySaved = () => {
            if (!centerMap(latitude, longitude)) window.setTimeout(trySaved, 180);
          };
          trySaved();
        } catch {
          requestLocation();
        }
      } else {
        requestLocation();
      }
    };

    installControls();
    return () => {
      destroyed = true;
      controlsHost?.remove();
    };
  }, []);

  return null;
}
