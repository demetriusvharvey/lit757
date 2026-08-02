"use client";

import { useEffect } from "react";
import {
  contributePassivePresence,
  passivePresenceRecentlySent,
} from "../src/lib/buzz/passive-presence-client";

export default function PassivePresenceRuntime() {
  useEffect(() => {
    if (!navigator.geolocation) return;
    let cancelled = false;
    let timer: number | null = null;

    const sendGrantedLocation = async () => {
      if (cancelled || document.visibilityState !== "visible" || passivePresenceRecentlySent()) return;
      try {
        const permission = await navigator.permissions?.query({ name: "geolocation" });
        if (!permission || permission.state !== "granted") return;
      } catch {
        // Never trigger a surprise permission prompt when permission state is unavailable.
        return;
      }

      navigator.geolocation.getCurrentPosition(
        position => {
          void contributePassivePresence({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
          });
        },
        () => undefined,
        { enableHighAccuracy: false, maximumAge: 120_000, timeout: 12_000 },
      );
    };

    const start = window.setTimeout(() => { void sendGrantedLocation(); }, 1800);
    timer = window.setInterval(() => { void sendGrantedLocation(); }, 6 * 60 * 1000);
    const onVisibility = () => { if (document.visibilityState === "visible") void sendGrantedLocation(); };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      window.clearTimeout(start);
      if (timer !== null) window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return null;
}
