import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { generateShortOpenAiText } from "./openai-chat";
import { isResourceOwner } from "./ownership";

// Protected route modules create the shared admin client at module load. These
// intentionally non-routable values let contract tests exercise every guard
// that runs before a database call.
process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "integration-test-service-role";

test("ground-truth API rejects requests without its server secret", async () => {
  const { POST } = await import("../../../app/api/buzz/ground-truth/route");
  const response = await POST(
    new Request("https://buzz.example/api/buzz/ground-truth", {
      method: "POST",
      body: JSON.stringify({}),
    }),
  );

  assert.equal(response.status, 401);
  assert.match((await response.json()).error, /Unauthorized/);
});

test("calibration training rejects requests without the ground-truth secret", async () => {
  const { GET } = await import("../../../app/api/buzz/calibrate/route");
  const response = await GET(new Request("https://buzz.example/api/buzz/calibrate"));

  assert.equal(response.status, 401);
  assert.match((await response.json()).error, /Unauthorized/);
});

test("calibration training does not accept CRON_SECRET as a substitute", async () => {
  // CRON_SECRET is handed to schedulers for refresh work. Training reads raw
  // ground truth and writes the artifact that can move public scores, so it
  // must stay on the narrower ground-truth boundary.
  const cronSecret = "cron-secret-value-at-least-32-characters-long";
  const previousCron = process.env.CRON_SECRET;
  const previousTruth = process.env.BUZZ_GROUND_TRUTH_SECRET;
  process.env.CRON_SECRET = cronSecret;
  delete process.env.BUZZ_GROUND_TRUTH_SECRET;

  try {
    const { GET } = await import("../../../app/api/buzz/calibrate/route");
    const response = await GET(
      new Request("https://buzz.example/api/buzz/calibrate", {
        headers: { authorization: `Bearer ${cronSecret}` },
      }),
    );

    assert.equal(response.status, 401);
  } finally {
    if (previousCron === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previousCron;
    if (previousTruth === undefined) delete process.env.BUZZ_GROUND_TRUTH_SECRET;
    else process.env.BUZZ_GROUND_TRUTH_SECRET = previousTruth;
  }
});

test("partner ingestion enforces its request-size limit before database work", async () => {
  const secret = "partner-integration-secret-at-least-32-characters";
  process.env.BUZZ_PARTNER_INGEST_SECRET = secret;
  const { POST } = await import("../../../app/api/buzz/partner-pulse/route");
  const response = await POST(
    new Request("https://buzz.example/api/buzz/partner-pulse", {
      method: "POST",
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "application/json",
        "content-length": "16385",
        "x-forwarded-for": "198.51.100.21",
      },
      body: "{}",
    }),
  );

  assert.equal(response.status, 413);
  assert.match((await response.json()).error, /too large/i);
});

test("service-role ownership checks reject cross-account claims", () => {
  assert.equal(isResourceOwner("user-a", "user-a"), true);
  assert.equal(isResourceOwner("user-a", "user-b"), false);
  assert.equal(isResourceOwner(null, "user-a"), false);
});

test("AI helper falls back without calling a provider when no key exists", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  const fetchSpy = mock.method(globalThis, "fetch", async () => {
    throw new Error("fetch should not be called without a key");
  });
  try {
    const result = await generateShortOpenAiText({
      prompt: "Recommend somewhere nearby",
      system: "Be concise",
      maxTokens: 40,
    });
    assert.equal(result, null);
    assert.equal(fetchSpy.mock.callCount(), 0);
  } finally {
    mock.restoreAll();
    if (previousKey == null) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
});

test("AI helper returns its fallback signal on provider failure", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "integration-test-key";
  mock.method(globalThis, "fetch", async () =>
    new Response(JSON.stringify({ error: "unavailable" }), { status: 503 }),
  );
  try {
    const result = await generateShortOpenAiText({
      prompt: "Recommend somewhere nearby",
      system: "Be concise",
      maxTokens: 40,
    });
    assert.equal(result, null);
  } finally {
    mock.restoreAll();
    if (previousKey == null) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
});
