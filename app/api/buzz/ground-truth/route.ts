import { randomUUID, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { recomputeBuzzScore } from "../../../../src/lib/buzz/repository";
import type { VenueForBuzz } from "../../../../src/lib/buzz/types";

export const dynamic = "force-dynamic";

const db = getSupabaseAdmin();

const bands = new Set(["quiet", "steady", "busy", "packed"]);
const MAX_BODY_BYTES = 16_384;
const MAX_NOTES_LENGTH = 1_000;
const MAX_METADATA_BYTES = 4_096;
const MAX_QUEUE_MINUTES = 240;
const MAX_OBSERVATION_AGE_MS = 6 * 60 * 60 * 1_000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1_000;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 20;
const REPLAY_WINDOW_MS = 10 * 60 * 1_000;

const rateBuckets = new Map<string, { count: number; resetAt: number }>();
const replayCache = new Map<string, number>();

function secureEqual(actual: string | null, expected: string) {
  if (!actual) return false;
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function authorized(request: Request) {
  const secret = process.env.BUZZ_GROUND_TRUTH_SECRET;
  if (!secret || secret.length < 32) return false;
  return secureEqual(request.headers.get("authorization"), `Bearer ${secret}`)
    || secureEqual(request.headers.get("x-buzz-ground-truth-secret"), secret);
}

function clientKey(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || "unknown";
}

function rateLimited(key: string, now: number) {
  for (const [bucketKey, bucket] of rateBuckets) {
    if (bucket.resetAt <= now) rateBuckets.delete(bucketKey);
  }
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  bucket.count += 1;
  return bucket.count > RATE_LIMIT;
}

function isReplay(idempotencyKey: string, now: number) {
  for (const [key, expiresAt] of replayCache) {
    if (expiresAt <= now) replayCache.delete(key);
  }
  if (replayCache.has(idempotencyKey)) return true;
  replayCache.set(idempotencyKey, now + REPLAY_WINDOW_MS);
  return false;
}

function bandScore(band: string) {
  if (band === "packed") return 95;
  if (band === "busy") return 75;
  if (band === "steady") return 45;
  return 15;
}

function finiteNumber(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function sanitizeMetadata(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const allowed = new Set(["source", "device", "verificationMethod", "observationId"]);
  const metadata = Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key, item]) => allowed.has(key) && ["string", "number", "boolean"].includes(typeof item))
      .map(([key, item]) => [key, typeof item === "string" ? item.slice(0, 200) : item]),
  );
  return JSON.stringify(metadata).length <= MAX_METADATA_BYTES ? metadata : {};
}

function response(body: Record<string, unknown>, status: number, requestId: string) {
  return NextResponse.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-request-id": requestId,
    },
  });
}

export async function POST(request: Request) {
  const requestId = randomUUID();
  const now = Date.now();

  if (!authorized(request)) return response({ success: false, error: "Unauthorized" }, 401, requestId);
  if (rateLimited(clientKey(request), now)) return response({ success: false, error: "Too many requests" }, 429, requestId);

  const contentLength = Number(request.headers.get("content-length") || "0");
  if (contentLength > MAX_BODY_BYTES) return response({ success: false, error: "Request too large" }, 413, requestId);

  const rawBody = await request.text().catch(() => "");
  if (!rawBody || Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
    return response({ success: false, error: "Invalid request body" }, 400, requestId);
  }

  const suppliedIdempotencyKey = request.headers.get("idempotency-key")?.trim();
  if (!suppliedIdempotencyKey || !/^[A-Za-z0-9._:-]{16,128}$/.test(suppliedIdempotencyKey)) {
    return response({ success: false, error: "A valid Idempotency-Key is required" }, 400, requestId);
  }
  const idempotencyKey = suppliedIdempotencyKey;
  if (isReplay(idempotencyKey, now)) return response({ success: false, error: "Duplicate observation" }, 409, requestId);

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return response({ success: false, error: "Invalid JSON" }, 400, requestId);
  }

  const venueId = typeof body.venueId === "string" ? body.venueId.trim() : "";
  const occupancyBand = typeof body.occupancyBand === "string" ? body.occupancyBand.toLowerCase() : "";
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(venueId) || !bands.has(occupancyBand)) {
    return response({ success: false, error: "Invalid venueId or occupancyBand" }, 400, requestId);
  }

  const observedAt = typeof body.observedAt === "string" ? new Date(body.observedAt) : new Date(now);
  const observedTime = observedAt.getTime();
  if (!Number.isFinite(observedTime)
    || observedTime < now - MAX_OBSERVATION_AGE_MS
    || observedTime > now + MAX_FUTURE_SKEW_MS) {
    return response({ success: false, error: "Observation time is outside the accepted window" }, 400, requestId);
  }

  const occupancyPct = body.occupancyPct == null ? null : finiteNumber(body.occupancyPct);
  const queueMinutes = body.queueMinutes == null ? null : finiteNumber(body.queueMinutes);
  if ((body.occupancyPct != null && occupancyPct == null)
    || (occupancyPct != null && (occupancyPct < 0 || occupancyPct > 100))
    || (body.queueMinutes != null && queueMinutes == null)
    || (queueMinutes != null && (queueMinutes < 0 || queueMinutes > MAX_QUEUE_MINUTES))) {
    return response({ success: false, error: "Invalid occupancy or queue value" }, 400, requestId);
  }

  const notes = body.notes == null ? null : String(body.notes).trim();
  if (notes && notes.length > MAX_NOTES_LENGTH) return response({ success: false, error: "Notes are too long" }, 400, requestId);

  const [{ data: snapshot }, { data: venue, error: venueError }] = await Promise.all([
    db.from("buzz_score_snapshots")
      .select("score,label,score_mode,confidence,version,computed_at")
      .eq("venue_id", venueId)
      .maybeSingle(),
    db.from("venues")
      .select("id,name,address,city,type,category,ai_score")
      .eq("id", venueId)
      .maybeSingle(),
  ]);
  if (venueError || !venue) return response({ success: false, error: "Venue not found" }, 404, requestId);

  const actualScore = occupancyPct == null ? bandScore(occupancyBand) : Math.round(occupancyPct);
  const metadata = {
    ...sanitizeMetadata(body.metadata),
    requestId,
    idempotencyKey,
    predictedScore: snapshot?.score == null ? null : Number(snapshot.score),
    predictedLabel: snapshot?.label || null,
    predictedMode: snapshot?.score_mode || null,
    predictedConfidence: snapshot?.confidence || null,
    predictedVersion: snapshot?.version || null,
    predictedAt: snapshot?.computed_at || null,
  };

  const { data, error } = await db.from("buzz_ground_truth").insert({
    venue_id: venueId,
    observed_at: observedAt.toISOString(),
    occupancy_band: occupancyBand,
    occupancy_pct: actualScore,
    queue_minutes: queueMinutes == null ? null : Math.round(queueMinutes),
    observer_type: "trusted_field_observer",
    notes,
    metadata,
  }).select("id").single();

  if (error) {
    console.error("Ground truth insert failed", { requestId, code: error.code });
    return response({ success: false, error: "Unable to record observation", requestId }, 500, requestId);
  }

  const modelUpdated = await recomputeBuzzScore(db, venue as VenueForBuzz, observedAt)
    .then(() => true)
    .catch(error => {
      console.error("Buzz recompute failed", { requestId, message: error instanceof Error ? error.message : "unknown" });
      return false;
    });

  return response({ success: true, observationId: data.id, modelUpdated }, 201, requestId);
}
