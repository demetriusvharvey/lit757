export type ConversionEventName =
  | "share_attempt"
  | "share_complete"
  | "share_cancel"
  | "share_fallback"
  | "copy_link"
  | "sms_open"
  | "story_download"
  | "shared_link_open"
  | "venue_view"
  | "favorite_add"
  | "watch_add"
  // Backward-compatible UI aliases. They are canonicalized before transmission.
  | "share_copy"
  | "share_sms"
  | "share_native";

export type ConversionEvent = {
  eventName: ConversionEventName;
  venueId?: string | null;
  referralId?: string | null;
  source?: string | null;
  channel?: string | null;
  truthMode?: "live" | "forecast" | null;
  metadata?: Record<string, string | number | boolean | null | undefined>;
};

const ANONYMOUS_KEY = "buzz-analytics-anonymous-id";
const SESSION_KEY = "buzz-analytics-session-id";

const CANONICAL_EVENT: Partial<Record<ConversionEventName, ConversionEventName>> = {
  share_copy: "copy_link",
  share_sms: "sms_open",
  share_native: "share_complete",
};

function compactId(prefix: string) {
  const random = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID().replace(/-/g, "")
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${random}`.slice(0, 96);
}

function storageId(storage: Pick<Storage, "getItem" | "setItem"> | null, key: string, prefix: string) {
  if (!storage) return compactId(prefix);
  const existing = storage.getItem(key);
  if (existing && /^[a-zA-Z0-9_-]{8,128}$/.test(existing)) return existing;
  const created = compactId(prefix);
  try { storage.setItem(key, created); } catch { /* Analytics must never block the product. */ }
  return created;
}

export function createReferralId() {
  return compactId("ref");
}

export function analyticsAnonymousId() {
  return storageId(typeof window === "undefined" ? null : window.localStorage, ANONYMOUS_KEY, "anon");
}

export function analyticsSessionId() {
  return storageId(typeof window === "undefined" ? null : window.sessionStorage, SESSION_KEY, "session");
}

export function referralContext(value: string | URL) {
  const url = value instanceof URL ? value : new URL(value, "https://buzz.local");
  const referralId = url.searchParams.get("ref");
  const source = url.searchParams.get("source");
  const venueId = url.searchParams.get("venue");
  const mode = url.searchParams.get("mode");
  return {
    referralId: referralId && /^[a-zA-Z0-9_-]{8,128}$/.test(referralId) ? referralId : null,
    source: source?.slice(0, 80) || null,
    venueId: venueId?.slice(0, 64) || null,
    truthMode: mode === "live" ? "live" as const : mode === "forecast" ? "forecast" as const : null,
    isInvite: source === "invite-the-crew",
  };
}

export async function trackConversion(event: ConversionEvent, accessToken?: string | null) {
  if (typeof window === "undefined") return;
  const payload = {
    ...event,
    eventName: CANONICAL_EVENT[event.eventName] || event.eventName,
    anonymousId: analyticsAnonymousId(),
    sessionId: analyticsSessionId(),
    metadata: Object.fromEntries(
      Object.entries(event.metadata || {}).filter(([, value]) => value !== null && value !== undefined),
    ),
  };
  try {
    await fetch("/api/analytics/track", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify(payload),
      keepalive: true,
    });
  } catch {
    // Product analytics is intentionally best-effort and must never interrupt sharing or discovery.
  }
}
