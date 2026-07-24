import { timingSafeEqual } from "node:crypto";

const buckets = new Map<string, { count: number; resetAt: number }>();

export class MlRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "MlRequestError";
  }
}

function secureEqual(actual: string | null, expected: string) {
  if (!actual) return false;
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

export function requireMlApiSecret(request: Request) {
  const secret = process.env.ML_API_SECRET;
  if (!secret || secret.length < 32) return false;
  return secureEqual(request.headers.get("authorization"), `Bearer ${secret}`);
}

export function clientAddress(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")
    || "unknown";
}

export function exceedsRateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
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
}

export async function readJsonBody(request: Request, maxBytes: number) {
  const contentLength = Number(request.headers.get("content-length") || "0");
  if (contentLength > maxBytes) throw new MlRequestError("Request too large", 413);
  const raw = await request.text();
  if (!raw || Buffer.byteLength(raw, "utf8") > maxBytes) {
    throw new MlRequestError("Invalid request body", 400);
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new MlRequestError("Invalid JSON", 400);
  }
}
