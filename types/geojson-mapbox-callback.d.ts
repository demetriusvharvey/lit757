export {};

declare global {
  namespace GeoJSON {
    /**
     * Mapbox features are narrowed to Point before asynchronous cluster callbacks.
     * TypeScript loses that control-flow narrowing inside the callback because the
     * feature object is captured. This compatibility field keeps the coordinate
     * access typed while the runtime guard remains the source of truth.
     */
    interface GeometryCollection<G extends Geometry = Geometry> {
      coordinates: Position;
    }
  }
}
