import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "../../../app/api/analytics/track/route";

function request(body: unknown) {
  return new Request("https://buzz.example/api/analytics/track", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("analytics route rejects unsupported event names", async () => {
  const response = await POST(request({
    eventName: "made_up_event",
    anonymousId: "anon_12345678",
  }));
  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.equal(payload.success, false);
  assert.match(payload.error, /Unsupported analytics event/);
});

test("analytics route requires a bounded anonymous identifier", async () => {
  const response = await POST(request({
    eventName: "share_attempt",
    anonymousId: "bad id",
  }));
  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.match(payload.error, /anonymous analytics ID/);
});

test("analytics route rejects non-UUID venue identifiers", async () => {
  const response = await POST(request({
    eventName: "venue_view",
    anonymousId: "anon_12345678",
    sessionId: "session_12345678",
    venueId: "google-place-id",
  }));
  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.match(payload.error, /Invalid venue ID/);
});

test("analytics route rejects unbounded metadata identifiers", async () => {
  const response = await POST(request({
    eventName: "share_attempt",
    anonymousId: "anon_12345678",
    sessionId: "session with spaces",
  }));
  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.match(payload.error, /Invalid analytics identifier/);
});
