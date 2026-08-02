import assert from "node:assert/strict";
import test from "node:test";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

async function clientComponents(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async entry => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return clientComponents(absolute);
    return entry.isFile() && entry.name.endsWith(".tsx") ? [absolute] : [];
  }));
  return files.flat();
}

test("browser components reuse the shared Supabase auth client", async () => {
  const files = await clientComponents(path.join(process.cwd(), "app"));
  const offenders: string[] = [];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    if (/\bcreateClient\s*\(/.test(source) || /import\(["']@supabase\/supabase-js["']\)/.test(source)) {
      offenders.push(path.relative(process.cwd(), file));
    }
  }

  assert.deepEqual(offenders, []);
});

test("the shared browser module owns the only Supabase client constructor", async () => {
  const source = await readFile(path.join(process.cwd(), "src/lib/supabase.ts"), "utf8");
  assert.equal(source.match(/\bcreateClient\s*\(/g)?.length, 1);
});
