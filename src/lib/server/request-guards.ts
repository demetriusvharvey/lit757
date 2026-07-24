import { timingSafeEqual } from "node:crypto";

export class RequestGuardError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "RequestGuardError";
  }
}

function constantTimeEqual(actual: string | null, expected: string) {
  if (!actual) return false;
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

export function hasBearerSecret(request: Request, secret: string | undefined, minimumLength = 32) {
  if (!secret || secret.length < minimumLength) return false;
  return constantTimeEqual(request.headers.get("authorization"), `Bearer ${secret}`);
}

export function requestClientKey(request: Request) {
  // Vercel overwrites these forwarding headers. Do not use a browser-supplied
  // identifier for abuse controls because an attacker could rotate it freely.
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")
    || "unknown";
}

export function createFixedWindowLimiter() {
  const buckets = new Map<string, { count: number; resetAt: number }>();

  return (key: string, limit: number, windowMs: number, now = Date.now()) => {
    // This protects each serverless instance from bursts. A durable shared
    // limiter can replace it later without changing route-level validation.
    for (const [bucketKey, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(bucketKey);
    }
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return false;
    }
    bucket.count += 1;
    return bucket.count > limit;
  };
}

export const exceedsRequestRate = createFixedWindowLimiter();

export async function readBoundedJson(request: Request, maxBytes: number): Promise<Record<string, unknown>> {
  const contentLength = Number(request.headers.get("content-length") || "0");
  if (!Number.isFinite(contentLength) || contentLength < 0) {
    throw new RequestGuardError("Invalid Content-Length", 400);
  }
  if (contentLength > maxBytes) throw new RequestGuardError("Request too large", 413);

  const raw = await request.text();
  if (!raw) throw new RequestGuardError("Invalid request body", 400);
  if (Buffer.byteLength(raw, "utf8") > maxBytes) throw new RequestGuardError("Request too large", 413);

  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new RequestGuardError("JSON object required", 400);
    }
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof RequestGuardError) throw error;
    throw new RequestGuardError("Invalid JSON", 400);
  }
}

export function guardErrorResponse(error: unknown, fallback = "Invalid request") {
  const status = error instanceof RequestGuardError ? error.status : 400;
  const message = error instanceof RequestGuardError ? error.message : fallback;
  return Response.json({ error: message }, { status });
}
