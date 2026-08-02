import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("verified nightlife import is protected, dry-run by default, and insert-only", () => {
  const source = readFileSync(
    new URL("../../../app/api/venues/verified-nightlife/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /isCronAuthorized\(request\)/);
  assert.match(source, /searchParams\.get\("dryRun"\) !== "0"/);
  assert.match(source, /confirmation !== WRITE_CONFIRMATION/);
  assert.match(source, /\.insert\(/);
  assert.doesNotMatch(source, /\.update\(|\.upsert\(|\.delete\(/);
});
