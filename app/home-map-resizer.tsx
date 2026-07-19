"use client";

import { useEffect } from "react";

export default function HomeMapResizer() {
  useEffect(() => {
    let stopped = false;
    let observer: ResizeObserver | null = null;
    let lastTouchAt = 0;
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

    const dispatchMapClick = (target: EventTarget | null, clientX: number, clientY: number, screenX: number, screenY: number) => {
      const canvas = target instanceof Element ? target.closest(".mapboxgl-canvas") : null;
      if (!(canvas instanceof HTMLCanvasElement)) return;

      canvas.dispatchEvent(new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        clientX,
        clientY,
        screenX,
        screenY,
        view: window,
      }));
    };

    const onTouchEnd = (event: TouchEvent) => {
      const touch = event.changedTouches[0];
      if (!touch) return;
      lastTouchAt = Date.now();
      dispatchMapClick(event.target, touch.clientX, touch.clientY, touch.screenX, touch.screenY);
    };

    const onPointerUp = (event: PointerEvent) => {
      if (event.pointerType !== "touch" || Date.now() - lastTouchAt < 500) return;
      dispatchMapClick(event.target, event.clientX, event.clientY, event.screenX, event.screenY);
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

    document.addEventListener("touchend", onTouchEnd, { passive: true, capture: true });
    document.addEventListener("pointerup", onPointerUp, true);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", resizeMap);
    window.addEventListener("orientationchange", resizeMap);

    return () => {
      stopped = true;
      observer?.disconnect();
      timers.forEach(window.clearTimeout);
      document.removeEventListener("touchend", onTouchEnd, true);
      document.removeEventListener("pointerup", onPointerUp, true);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", resizeMap);
      window.removeEventListener("orientationchange", resizeMap);
    };
  }, []);

  return null;
}
