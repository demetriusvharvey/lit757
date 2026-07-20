import "mapbox-gl";
import type { LngLatBounds as MapboxLngLatBounds } from "mapbox-gl";

declare module "mapbox-gl" {
  interface Map {
    /** A mounted map always has bounds; narrow the upstream nullable type for app code. */
    getBounds(): MapboxLngLatBounds;
  }
}
