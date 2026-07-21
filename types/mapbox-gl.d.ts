import "mapbox-gl";

declare module "mapbox-gl" {
  export interface MapStyleImageMissingEvent {
    id: string;
    type: "styleimagemissing";
    target: Map;
  }
}
