"use client";

import { useEffect } from "react";
import { supabase } from "../src/lib/supabase";

const FAVORITES_KEY = "lit757-mobile-favorites";
const ALERTS_KEY = "lit757-mobile-alerts";
const VENUE_ALERTS_KEY = "lit757-venue-alerts";
const PUSH_STATUS_KEY = "lit757-push-status";
const HYDRATED_KEY = "lit757-preferences-hydrated";

type VenueAlert = { venueId: string; threshold: number };
type RemotePreferences = {
  saved?: Array<{ venue_id: string; venue_name?: string | null }>;
  alerts?: Array<{ venue_id: string; venue_name?: string | null; threshold?: number }>;
};
type DiscoverySnapshot = {
  venues?: Array<{ id: string; name?: string }>;
  picks?: Array<{ id: string; name?: string }>;
};

function readJson<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) || "") as T;
  } catch {
    return fallback;
  }
}

function writeStatus(status: string) {
  localStorage.setItem(PUSH_STATUS_KEY, status);
  window.dispatchEvent(new CustomEvent("lit757:push-status", { detail: status }));
}

function venueName(venueId: string) {
  const discovery = (window as typeof window & { __activity757LatestDiscovery?: DiscoverySnapshot }).__activity757LatestDiscovery;
  const venues = discovery?.venues || discovery?.picks || [];
  return venues.find(venue => String(venue.id) === String(venueId))?.name || null;
}

function decodePublicKey(publicKey: string): ArrayBuffer {
  const padding = "=".repeat((4 - (publicKey.length % 4)) % 4);
  const base64 = (publicKey + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const bytes = Uint8Array.from([...raw].map(character => character.charCodeAt(0)));
  return bytes.buffer as ArrayBuffer;
}

async function registerPush(accessToken: string) {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || typeof Notification === "undefined") {
    writeStatus("unsupported");
    return;
  }

  if (Notification.permission !== "granted") {
    writeStatus(Notification.permission === "denied" ? "denied" : "permission-needed");
    return;
  }

  const keyResponse = await fetch("/api/push/public-key", { cache: "no-store" });
  const keyPayload = await keyResponse.json() as { configured?: boolean; publicKey?: string };
  if (!keyPayload.configured || !keyPayload.publicKey) {
    writeStatus("setup-required");
    return;
  }

  const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: decodePublicKey(keyPayload.publicKey),
    });
  }

  const response = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(subscription.toJSON()),
  });

  if (!response.ok) throw new Error("Could not register this device for push notifications.");
  writeStatus("ready");
}

function updateAlertSheetStatus() {
  const sheets = [...document.querySelectorAll<HTMLElement>(".utility-sheet")];
  const sheet = sheets.find(candidate => candidate.querySelector(".utility-head span")?.textContent?.includes("SMART ALERTS"));
  if (!sheet) return;

  let status = sheet.querySelector<HTMLElement>(".push-runtime-status");
  if (!status) {
    status = document.createElement("div");
    status.className = "push-runtime-status";
    const alertCard = sheet.querySelector(".alert-card");
    alertCard?.insertAdjacentElement("afterend", status);
  }

  const current = localStorage.getItem(PUSH_STATUS_KEY) || "unknown";
  const messages: Record<string, string> = {
    ready: "✓ Push delivery is connected to this device.",
    "signed-out": "Sign in to sync saved places and receive alerts on this device.",
    unsupported: "On iPhone, add LIT757 to your Home Screen to enable web push alerts.",
    denied: "Notifications are blocked in your browser settings.",
    "permission-needed": "Tap Enable alerts to allow notifications.",
    "setup-required": "Push delivery is built but VAPID keys still need to be added in Vercel.",
    error: "Push setup could not finish. Try enabling alerts again.",
    unknown: "Saved places stay local until notification setup is complete.",
  };
  status.textContent = messages[current] || messages.unknown;
}

export default function NotificationRuntime() {
  useEffect(() => {
    let destroyed = false;
    let intervalId: number | null = null;
    let observer: MutationObserver | null = null;
    let unsubscribe: (() => void) | null = null;

    const boot = async () => {
      const synchronize = async (accessToken: string) => {
        const savedIds = readJson<string[]>(FAVORITES_KEY, []);
        const alerts = readJson<VenueAlert[]>(VENUE_ALERTS_KEY, []);
        const payload = {
          saved: savedIds.map(venueId => ({ venueId, venueName: venueName(venueId) })),
          alerts: alerts.map(alert => ({
            venueId: alert.venueId,
            venueName: venueName(alert.venueId),
            threshold: alert.threshold || 80,
          })),
        };

        const response = await fetch("/api/preferences", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify(payload),
        });
        if (!response.ok) throw new Error("Could not sync notification preferences.");
      };

      const hydrate = async (accessToken: string, userId: string) => {
        const response = await fetch("/api/preferences", {
          headers: { authorization: `Bearer ${accessToken}` },
          cache: "no-store",
        });
        if (!response.ok) throw new Error("Could not load saved notification preferences.");
        const remote = await response.json() as RemotePreferences;

        const localSaved = readJson<string[]>(FAVORITES_KEY, []);
        const localAlerts = readJson<VenueAlert[]>(VENUE_ALERTS_KEY, []);
        const mergedSaved = [...new Set([...localSaved, ...(remote.saved || []).map(row => String(row.venue_id))])];
        const alertMap = new Map<string, VenueAlert>();
        for (const row of remote.alerts || []) {
          alertMap.set(String(row.venue_id), { venueId: String(row.venue_id), threshold: Number(row.threshold) || 80 });
        }
        for (const alert of localAlerts) alertMap.set(String(alert.venueId), alert);
        const mergedAlerts = [...alertMap.values()];

        const savedChanged = JSON.stringify(mergedSaved) !== JSON.stringify(localSaved);
        const alertsChanged = JSON.stringify(mergedAlerts) !== JSON.stringify(localAlerts);
        localStorage.setItem(FAVORITES_KEY, JSON.stringify(mergedSaved));
        localStorage.setItem(VENUE_ALERTS_KEY, JSON.stringify(mergedAlerts));
        await synchronize(accessToken);

        const hydrationId = `${userId}:${mergedSaved.length}:${mergedAlerts.length}`;
        if ((savedChanged || alertsChanged) && sessionStorage.getItem(HYDRATED_KEY) !== hydrationId) {
          sessionStorage.setItem(HYDRATED_KEY, hydrationId);
          window.location.reload();
        }
      };

      const startForSession = async (session: { access_token: string; user: { id: string } } | null) => {
        if (intervalId !== null) window.clearInterval(intervalId);
        intervalId = null;

        if (!session) {
          writeStatus("signed-out");
          return;
        }

        try {
          await hydrate(session.access_token, session.user.id);
          let lastSignature = "";
          const syncIfChanged = async () => {
            const signature = `${localStorage.getItem(FAVORITES_KEY) || "[]"}|${localStorage.getItem(VENUE_ALERTS_KEY) || "[]"}`;
            if (signature !== lastSignature) {
              lastSignature = signature;
              await synchronize(session.access_token);
            }
            if (localStorage.getItem(ALERTS_KEY) === "true") {
              await registerPush(session.access_token);
            }
          };
          await syncIfChanged();
          intervalId = window.setInterval(() => void syncIfChanged().catch(() => writeStatus("error")), 1800);
        } catch {
          writeStatus("error");
        }
      };

      const { data } = await supabase.auth.getSession();
      if (!destroyed) await startForSession(data.session);
      const authListener = supabase.auth.onAuthStateChange((_event, session) => {
        if (!destroyed) void startForSession(session);
      });
      unsubscribe = () => authListener.data.subscription.unsubscribe();
    };

    observer = new MutationObserver(updateAlertSheetStatus);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("lit757:push-status", updateAlertSheetStatus);
    void boot();

    return () => {
      destroyed = true;
      if (intervalId !== null) window.clearInterval(intervalId);
      observer?.disconnect();
      unsubscribe?.();
      window.removeEventListener("lit757:push-status", updateAlertSheetStatus);
    };
  }, []);

  return null;
}
