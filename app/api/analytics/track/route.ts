import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const EVENT_NAMES = new Set([
  "share_attempt",
  "share_complete",
  "share_cancel",
  "share_fallback",
  "copy_link",
  "sms_open",
  "story_download",
  "shared_link_open",
  "venue_view",
  "favorite_add",
  "watch_add",
]);

const METADATA_KEYS = new Set([
  "entry",
  "fallback",
  "selectedFilter",
  "mapMode",
  "shareFile",
  "notification",
  "result",
]);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_ID_PATTERN = /^[a-zA-Z0-9_-]{8,128}$/;

type TrackBody = {
  eventName?: unknown;
  venueId?: unknown;
  anonymousId?: unknown;
  sessionId?: unknown;
  referralId?: unknown;
  source?: unknown;
  channel?: unknown;
  truthMode?: unknown;
  metadata?: unknown;
};

function cleanString(value: unknown, maximum = 80) {
  if (typeof value !== "string") return null;
  const clean = value.replace(/\s+/g, " ").trim().slice(0, maximum);
  return clean || null;
}

function safeId(value: unknown, required = false) {
  const clean = cleanString(value, 128);
  if (!clean) return required ? null : undefined;
  return SAFE_ID_PATTERN.test(clean) ? clean : null;
}

function safeMetadata(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const output: Record<string, string | number | boolean> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!METADATA_KEYS.has(key)) continue;
    if (typeof raw === "boolean" || typeof raw === "number") output[key] = raw;
    else if (typeof raw === "string") output[key] = raw.replace(/\s+/g, " ").trim().slice(0, 120);
  }
  return output;
}

async function authenticatedUserId(request: Request, db: ReturnType<typeof createClient>) {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  if (!token) return null;
  const { data, error } = await db.auth.getUser(token);
  return error ? null : data.user?.id || null;
}

export async function POST(request: Request) {
  let body: TrackBody;
  try {
    body = await request.json() as TrackBody;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const eventName = cleanString(body.eventName, 40);
  const anonymousId = safeId(body.anonymousId, true);
  const sessionId = safeId(body.sessionId);
  const referralId = safeId(body.referralId);
  if (!eventName || !EVENT_NAMES.has(eventName)) {
    return NextResponse.json({ success: false, error: "Unsupported analytics event" }, { status: 400 });
  }
  if (!anonymousId) {
    return NextResponse.json({ success: false, error: "A valid anonymous analytics ID is required" }, { status: 400 });
  }
  if (sessionId === null || referralId === null) {
    return NextResponse.json({ success: false, error: "Invalid analytics identifier" }, { status: 400 });
  }

  const venueId = cleanString(body.venueId, 64);
  if (venueId && !UUID_PATTERN.test(venueId)) {
    return NextResponse.json({ success: false, error: "Invalid venue ID" }, { status: 400 });
  }
  const truthMode = cleanString(body.truthMode, 20);
  if (truthMode && truthMode !== "live" && truthMode !== "forecast") {
    return NextResponse.json({ success: false, error: "Invalid truth mode" }, { status: 400 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.info("Buzz analytics event", { eventName, venueId, anonymousId, referralId, persisted: false });
    return NextResponse.json({ success: true, persisted: false }, { status: 202 });
  }

  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const userId = await authenticatedUserId(request, db);
  const { error } = await db.from("buzz_conversion_events").insert({
    event_name: eventName,
    venue_id: venueId || null,
    user_id: userId,
    anonymous_id: anonymousId,
    session_id: sessionId || null,
    referral_id: referralId || null,
    source: cleanString(body.source, 80),
    channel: cleanString(body.channel, 40),
    truth_mode: truthMode || null,
    metadata: safeMetadata(body.metadata),
  });

  if (error) {
    console.warn("Buzz analytics persistence unavailable", error.message, { eventName, venueId, referralId });
    return NextResponse.json({ success: true, persisted: false }, { status: 202 });
  }

  return NextResponse.json({ success: true, persisted: true }, {
    status: 201,
    headers: { "Cache-Control": "private, no-store" },
  });
}
