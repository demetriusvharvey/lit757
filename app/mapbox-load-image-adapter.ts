import mapboxgl from "mapbox-gl";

type LoadImageCallback = (error?: Error | null, image?: unknown) => void;
type AdaptedMapPrototype = {
  loadImage: (url: string, callback?: LoadImageCallback) => unknown;
  __buzzPromiseImageLoader?: boolean;
};

const prototype = mapboxgl.Map.prototype as unknown as AdaptedMapPrototype;

if (!prototype.__buzzPromiseImageLoader) {
  const originalLoadImage = prototype.loadImage;

  prototype.loadImage = function loadImage(url: string, callback?: LoadImageCallback) {
    if (typeof callback === "function") {
      return originalLoadImage.call(this, url, callback);
    }

    return new Promise<{ data: unknown }>((resolve, reject) => {
      originalLoadImage.call(this, url, (error, image) => {
        if (error) {
          reject(error);
          return;
        }
        if (!image) {
          reject(new Error("Mapbox returned no image"));
          return;
        }
        resolve({ data: image });
      });
    });
  };

  prototype.__buzzPromiseImageLoader = true;
}
