"use client";

import { useEffect } from "react";

export default function HomeMapResizer() {
  useEffect(() => {
    let stopped = false;
    let observer: ResizeObserver | null = null;
    const timers: number[] = [];

    const resizeMap = () => {
      if (stopped) return;
      const mapSection = document.querySelector<HTMLElement>(".mobile-native-map");
      const mapBox = document.querySelector<HTMLElement>(".mobile-native-mapbox");
      if (!mapSection || !mapBox) return;

      mapSection.style.display = "block";
      mapSection.style.height = "390px";
      mapSection.style.minHeight = "390px";
      mapBox.style.display = "block";
      mapBox.style.width = "100%";
      mapBox.style.height = "100%";

      window.dispatchEvent(new Event("resize"));
    };

    const attach = () => {
      const mapSection = document.querySelector<HTMLElement>(".mobile-native-map");
      if (!mapSection) return false;

      resizeMap();
      observer = new ResizeObserver(resizeMap);
      observer.observe(mapSection);
      return true;
    };

    if (!attach()) {
      const mutationObserver = new MutationObserver(() => {
        if (attach()) mutationObserver.disconnect();
      });
      mutationObserver.observe(document.body, { childList: true, subtree: true });
      timers.push(window.setTimeout(() => mutationObserver.disconnect(), 10000));
    }

    [0, 100, 250, 500, 1000, 1800, 3000].forEach(delay => {
      timers.push(window.setTimeout(resizeMap, delay));
    });

    const onVisibility = () => {
      if (!document.hidden) {
        resizeMap();
        window.setTimeout(resizeMap, 150);
      }
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", resizeMap);
    window.addEventListener("orientationchange", resizeMap);

    return () => {
      stopped = true;
      observer?.disconnect();
      timers.forEach(window.clearTimeout);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", resizeMap);
      window.removeEventListener("orientationchange", resizeMap);
    };
  }, []);

  return null;
}
