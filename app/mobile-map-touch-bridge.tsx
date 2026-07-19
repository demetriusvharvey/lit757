"use client";

import { useEffect } from "react";

export default function MobileMapTouchBridge() {
  useEffect(() => {
    let lastTouchAt = 0;

    const handleTouchEnd = (event: TouchEvent) => {
      const canvas = event.target instanceof Element ? event.target.closest(".mapboxgl-canvas") : null;
      const touch = event.changedTouches[0];
      if (!(canvas instanceof HTMLCanvasElement) || !touch) return;

      lastTouchAt = Date.now();
      canvas.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          clientX: touch.clientX,
          clientY: touch.clientY,
          screenX: touch.screenX,
          screenY: touch.screenY,
          view: window,
        }),
      );
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (event.pointerType !== "touch" || Date.now() - lastTouchAt < 500) return;
      const canvas = event.target instanceof Element ? event.target.closest(".mapboxgl-canvas") : null;
      if (!(canvas instanceof HTMLCanvasElement)) return;

      canvas.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          clientX: event.clientX,
          clientY: event.clientY,
          screenX: event.screenX,
          screenY: event.screenY,
          view: window,
        }),
      );
    };

    document.addEventListener("touchend", handleTouchEnd, { passive: true, capture: true });
    document.addEventListener("pointerup", handlePointerUp, true);

    return () => {
      document.removeEventListener("touchend", handleTouchEnd, true);
      document.removeEventListener("pointerup", handlePointerUp, true);
    };
  }, []);

  return null;
}
