"use client";

import { useEffect } from "react";

const SESSION_KEY = "buzz:passive-session-v1";
const LAST_SENT_KEY = "buzz:passive-last-sent-v1";

function sessionId() {
  try {
    const existing = localStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const created = typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().replace(/-/g, "")
      : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(SESSION_KEY, created);
    return created;
  } catch {
    return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
  }
}

function recentlySent() {
  try {
    const timestamp = Number(localStorage.getItem(LAST_SENT_KEY) || 0);
    return Number.isFinite(timestamp) && Date.now() - timestamp < 6 * 60 * 1000;
  } catch {
    return false;
  }
}

function markSent() {
  try {
    localStorage.setItem(LAST_SENT_KEY, String(Date.now()));
  } catch {
    // The server also de-duplicates heartbeats.
  }
}

export default function PassivePresenceRuntime() {
  useEffect(() => {
    if (!navigator.geolocation) return;
    let cancelled = false;
    let timer: number | null = null;

    const send = () => {
      if (cancelled || document.visibilityState !== "visible" || recentlySent()) return;
      navigator.geolocation.getCurrentPosition(
        position => {
          if (cancelled || position.coords.accuracy > 150) return;
          void fetch("/api/buzz/passive-presence", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sessionId: sessionId(),
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              accuracy: position.coords.accuracy,
            }),
            keepalive: true,
          }).then(response => {
            if (response.ok) markSent();
          }).catch(() => undefined);
        },
        () => undefined,
        { enableHighAccuracy: false, maximumAge: 120_000, timeout: 12_000 },
      );
    };

    const start = window.setTimeout(send, 1800);
    timer = window.setInterval(send, 6 * 60 * 1000);
    const onVisibility = () => { if (document.visibilityState === "visible") send(); };
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
