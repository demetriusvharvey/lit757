import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const migrationsDirectory = path.join(process.cwd(), "supabase", "migrations");

async function migrationFiles() {
  return (await readdir(migrationsDirectory))
    .filter((file) => file.endsWith(".sql"))
    .sort();
}

test("Supabase migration versions are unique and sort chronologically", async () => {
  const files = await migrationFiles();
  const versions = files.map((file) => file.split("_", 1)[0]);

  assert.equal(new Set(versions).size, versions.length, "duplicate migration version detected");
  assert.deepEqual(files, [...files].sort(), "migration filenames must sort in application order");
});

test("every table created by Buzz migrations enables row-level security", async () => {
  const files = await migrationFiles();
  const sql = (await Promise.all(
    files.map((file) => readFile(path.join(migrationsDirectory, file), "utf8")),
  )).join("\n");

  const createdTables = [...sql.matchAll(
    /create\s+table(?:\s+if\s+not\s+exists)?\s+public\.([a-z0-9_]+)/gi,
  )].map((match) => match[1]);

  for (const table of new Set(createdTables)) {
    assert.match(
      sql,
      new RegExp(`alter\\s+table(?:\\s+if\\s+exists)?\\s+public\\.${table}\\s+enable\\s+row\\s+level\\s+security`, "i"),
      `${table} must enable RLS`,
    );
  }
});

test("security reconciliation closes raw evidence access", async () => {
  const sql = await readFile(
    path.join(migrationsDirectory, "20260724150000_security_reconciliation.sql"),
    "utf8",
  );

  for (const requiredFragment of [
    "buzz_ground_truth",
    "buzz_signal_provenance",
    "buzz_observer_reputation",
    "buzz_group_rooms",
    "buzz_group_votes",
    "buzz_product_events",
    "force row level security",
    "protect_buzz_managed_fields",
  ]) {
    assert.ok(sql.includes(requiredFragment), `security migration must include ${requiredFragment}`);
  }
});
