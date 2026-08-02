const SESSION_KEY = "buzz:passive-session-v1";
const LAST_SENT_KEY = "buzz:passive-last-sent-v1";

export type PassivePresenceLocation = {
  latitude: number;
  longitude: number;
  accuracy: number;
};

function sessionId() {
  try {
    const existing = localStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const created = typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().replace(/-/g, "")
      : Array.from(crypto.getRandomValues(new Uint8Array(24)), byte => byte.toString(16).padStart(2, "0")).join("");
    localStorage.setItem(SESSION_KEY, created);
    return created;
  } catch {
    return null;
  }
}

export function passivePresenceRecentlySent() {
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

export async function contributePassivePresence(
  detail: PassivePresenceLocation,
  options: { explicit?: boolean } = {},
) {
  if (
    ![detail.latitude, detail.longitude, detail.accuracy].every(Number.isFinite)
    || detail.accuracy <= 0
    || detail.accuracy > 150
    || (!options.explicit && passivePresenceRecentlySent())
  ) return false;

  try {
    const anonymousSessionId = sessionId();
    if (!anonymousSessionId) return false;
    const response = await fetch("/api/buzz/passive-presence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: anonymousSessionId, ...detail }),
      keepalive: true,
      signal: AbortSignal.timeout(6_000),
    });
    const payload = await response.json().catch(() => null) as { accepted?: boolean } | null;
    if (response.ok && payload?.accepted) {
      markSent();
      return true;
    }
  } catch {
    // Presence is best-effort and must never interrupt discovery.
  }
  return false;
}
