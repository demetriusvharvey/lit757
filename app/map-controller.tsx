"use client";

import type mapboxgl from "mapbox-gl";
import { createContext, useContext, useMemo, useState } from "react";

type UserLocation = {
  latitude: number;
  longitude: number;
  accuracy: number;
  updatedAt: number;
};

type MapControllerValue = {
  map: mapboxgl.Map | null;
  setMap: (map: mapboxgl.Map | null) => void;
  userLocation: UserLocation | null;
  setUserLocation: (location: UserLocation | null) => void;
  selectedVenueId: string | null;
  setSelectedVenueId: (venueId: string | null) => void;
  focusCoordinates: (longitude: number, latitude: number, zoom?: number, duration?: number) => boolean;
};

const MapControllerContext = createContext<MapControllerValue | null>(null);

export function MapControllerProvider({ children }: { children: React.ReactNode }) {
  const [map, setMap] = useState<mapboxgl.Map | null>(null);
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);
  const [selectedVenueId, setSelectedVenueId] = useState<string | null>(null);

  const value = useMemo<MapControllerValue>(() => ({
    map,
    setMap,
    userLocation,
    setUserLocation,
    selectedVenueId,
    setSelectedVenueId,
    focusCoordinates: (longitude, latitude, zoom = 14, duration = 650) => {
      if (!map) return false;
      map.resize();
      map.easeTo({ center: [longitude, latitude], zoom, duration });
      return true;
    },
  }), [map, selectedVenueId, userLocation]);

  return <MapControllerContext.Provider value={value}>{children}</MapControllerContext.Provider>;
}

export function useMapController() {
  const context = useContext(MapControllerContext);
  if (!context) throw new Error("useMapController must be used inside MapControllerProvider");
  return context;
}
