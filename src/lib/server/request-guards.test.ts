import assert from "node:assert/strict";
import test from "node:test";
import {
  createFixedWindowLimiter,
  hasBearerSecret,
  readBoundedJson,
  RequestGuardError,
} from "./request-guards";

test("bearer secrets fail closed and use the configured minimum length", () => {
  const secret = "a".repeat(32);
  assert.equal(hasBearerSecret(new Request("https://buzz.test"), undefined), false);
  assert.equal(hasBearerSecret(new Request("https://buzz.test"), "short"), false);
  assert.equal(hasBearerSecret(new Request("https://buzz.test", {
    headers: { authorization: `Bearer ${secret}` },
  }), secret), true);
});

test("bounded JSON accepts objects and rejects invalid or oversized bodies", async () => {
  const valid = new Request("https://buzz.test", {
    method: "POST",
    body: JSON.stringify({ venueId: "venue-1" }),
  });
  assert.deepEqual(await readBoundedJson(valid, 1_024), { venueId: "venue-1" });

  await assert.rejects(
    readBoundedJson(new Request("https://buzz.test", { method: "POST", body: "[]" }), 1_024),
    (error: unknown) => error instanceof RequestGuardError && error.status === 400,
  );
  await assert.rejects(
    readBoundedJson(new Request("https://buzz.test", { method: "POST", body: JSON.stringify({ data: "x".repeat(100) }) }), 16),
    (error: unknown) => error instanceof RequestGuardError && error.status === 413,
  );
});

test("fixed-window limiter resets after the configured interval", () => {
  const limited = createFixedWindowLimiter();
  assert.equal(limited("client", 2, 1_000, 0), false);
  assert.equal(limited("client", 2, 1_000, 1), false);
  assert.equal(limited("client", 2, 1_000, 2), true);
  assert.equal(limited("client", 2, 1_000, 1_001), false);
});
