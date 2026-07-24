import "mapbox-gl";

declare module "mapbox-gl" {
  export interface MapStyleImageMissingEvent {
    id: string;
    type: "styleimagemissing";
    target: Map;
  }

  export interface Map {
    loadImage(url: string): Promise<{ data: ImageBitmap | ImageData }>;
  }
}
