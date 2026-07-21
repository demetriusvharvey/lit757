"use client";

import { useEffect } from "react";

const FALLBACK = "/venue-photo-fallback.svg";

function replaceBrokenPhoto(image: HTMLImageElement) {
  if (image.dataset.venueFallbackApplied === "true") {
    image.style.display = "none";
    return;
  }

  image.dataset.venueFallbackApplied = "true";
  image.src = FALLBACK;
}

export default function VenuePhotoRuntime() {
  useEffect(() => {
    const handleError = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLImageElement)) return;
      if (!target.closest(".buzz-map-app")) return;
      replaceBrokenPhoto(target);
    };

    const inspectLoadedImages = () => {
      document.querySelectorAll<HTMLImageElement>(".buzz-map-app img").forEach(image => {
        if (image.complete && image.naturalWidth === 0) replaceBrokenPhoto(image);
      });
    };

    document.addEventListener("error", handleError, true);
    const observer = new MutationObserver(inspectLoadedImages);
    observer.observe(document.body, { childList: true, subtree: true });
    inspectLoadedImages();

    return () => {
      document.removeEventListener("error", handleError, true);
      observer.disconnect();
    };
  }, []);

  return null;
}
