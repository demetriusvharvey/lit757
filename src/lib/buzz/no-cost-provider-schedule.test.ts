import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repositoryRoot = new URL("../../../", import.meta.url);

async function workflow(name: string) {
  return readFile(new URL(`.github/workflows/${name}`, repositoryRoot), "utf8");
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
