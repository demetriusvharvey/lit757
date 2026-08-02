import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const repositoryRoot = new URL("../../../", import.meta.url);

async function workflow(name: string) {
  return readFile(new URL(`.github/workflows/${name}`, repositoryRoot), "utf8");
}

async function repositoryFile(name: string) {
  return readFile(new URL(name, repositoryRoot), "utf8");
}

test("scheduled provider refreshes do not call exhausted BestTime credits", async () => {
  const [hourly, signalRefresh] = await Promise.all([
    workflow("buzz-hourly.yml"),
    workflow("buzz-signal-refresh.yml"),
  ]);

  assert.doesNotMatch(hourly, /provider=besttime/i);

  const footTrafficJob = signalRefresh.match(
    /^  foot-traffic:\n([\s\S]*?)(?=^  [a-z][a-z-]+:\n)/m,
  )?.[0];
  assert.ok(footTrafficJob, "BestTime manual activation job is missing");
  assert.match(footTrafficJob, /github\.event_name == 'workflow_dispatch'/);
  assert.doesNotMatch(footTrafficJob, /github\.event\.schedule/);
});

test("subscription providers and Google enrichment are absent from automatic schedules", async () => {
  const [hourly, signalRefresh, vercelConfig] = await Promise.all([
    workflow("buzz-hourly.yml"),
    workflow("buzz-signal-refresh.yml"),
    repositoryFile("vercel.json"),
  ]);

  assert.doesNotMatch(hourly, /^  schedule:/m);

  const forecastJob = signalRefresh.match(
    /(?:^|\n)  event-forecast:\n([\s\S]*)/,
  )?.[0];
  assert.ok(forecastJob, "PredictHQ manual job is missing");
  assert.match(forecastJob, /github\.event_name == 'workflow_dispatch'/);
  assert.doesNotMatch(forecastJob, /github\.event\.schedule/);

  const crons = JSON.parse(vercelConfig) as { crons?: Array<{ path?: string }> };
  assert.ok(crons.crons?.every(cron => cron.path !== "/api/refresh-venue-photos"));
});

test("TomTom automatic traffic sampling leaves at least thirty percent free headroom", async () => {
  const quarterHour = await workflow("buzz-quarter-hour.yml");
  assert.match(quarterHour, /cron: "\*\/15 \* \* \* \*"/);
  assert.match(quarterHour, /calls == 16/);

  const automaticCallsPerDay = 16 * 4 * 24;
  const documentedDailyFreeAllowance = 2_500;
  assert.ok(
    automaticCallsPerDay <= documentedDailyFreeAllowance * 0.7,
    `Automatic calls ${automaticCallsPerDay}; free allowance ${documentedDailyFreeAllowance}`,
  );
});

test("every Google Places route is billing-gated and bulk mutations require cron auth", async () => {
  const googleRoutes = [
    "app/api/admin/enrich-venue-places/route.ts",
    "app/api/enrich-venues/route.ts",
    "app/api/import-google-venues/route.ts",
    "app/api/refresh-venue-photos/route.ts",
    "app/api/venue-photo/route.ts",
    "app/api/venue-photos/route.ts",
  ];
  const sources = await Promise.all(googleRoutes.map(repositoryFile));
  for (const [index, source] of sources.entries()) {
    assert.match(source, /meteredProviderCallsEnabled\("google_places"\)/, googleRoutes[index]);
  }

  for (const path of ["app/api/enrich-venues/route.ts", "app/api/import-google-venues/route.ts"]) {
    const source = await repositoryFile(path);
    assert.match(source, /isCronAuthorized\(request\)/, path);
  }
});

test("public AI and signup-email paths are billing-gated", async () => {
  const [openAi, signupEmail] = await Promise.all([
    repositoryFile("src/lib/server/openai-chat.ts"),
    repositoryFile("app/api/auth/signup-notify/route.ts"),
  ]);
  assert.match(openAi, /meteredProviderCallsEnabled\("openai"\)/);
  assert.match(signupEmail, /meteredProviderCallsEnabled\("resend"\)/);
});

test("public external geocoding is billing-gated, bounded, and rate-limited", async () => {
  const route = await repositoryFile("app/api/location-search/route.ts");
  assert.match(route, /meteredProviderCallsEnabled\("mapbox_geocoding"\)/);
  assert.match(route, /query\.length > 120/);
  assert.match(route, /exceedsRequestRate/);
  assert.match(route, /searchLocalLocations\(query\)/);
});

test("production workflows are read-only and cannot push source changes", async () => {
  const workflowDirectory = new URL(".github/workflows/", repositoryRoot);
  const names = (await readdir(workflowDirectory)).filter(name => /\.ya?ml$/.test(name));
  const sources = await Promise.all(names.map(name => workflow(name)));

  for (const [index, source] of sources.entries()) {
    assert.doesNotMatch(source, /^\s*contents:\s*write\s*$/m, names[index]);
    assert.doesNotMatch(source, /^\s*git\s+push(?:\s|$)/m, names[index]);
  }
});
