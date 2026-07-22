import assert from "node:assert/strict";
import test from "node:test";
import {
  analyticsAnonymousId,
  analyticsSessionId,
  createReferralId,
  referralContext,
} from "../conversion-analytics";

test("creates URL-safe referral identifiers", () => {
  const first = createReferralId();
  const second = createReferralId();
  assert.match(first, /^[a-zA-Z0-9_-]{8,128}$/);
  assert.match(second, /^[a-zA-Z0-9_-]{8,128}$/);
  assert.notEqual(first, second);
});

test("parses valid Invite the Crew referral context", () => {
  const context = referralContext("https://buzz.example/?venue=abc&source=invite-the-crew&ref=ref_12345678");
  assert.equal(context.isInvite, true);
  assert.equal(context.venueId, "abc");
  assert.equal(context.source, "invite-the-crew");
  assert.equal(context.referralId, "ref_12345678");
});

test("rejects malformed referral IDs", () => {
  const context = referralContext("https://buzz.example/?venue=abc&source=invite-the-crew&ref=bad%20id");
  assert.equal(context.referralId, null);
  assert.equal(context.isInvite, true);
});

test("server-side analytics IDs remain valid without browser storage", () => {
  assert.match(analyticsAnonymousId(), /^[a-zA-Z0-9_-]{8,128}$/);
  assert.match(analyticsSessionId(), /^[a-zA-Z0-9_-]{8,128}$/);
});
