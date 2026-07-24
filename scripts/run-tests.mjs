import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";

async function findTests(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return findTests(absolutePath);
    return entry.isFile() && entry.name.endsWith(".test.ts") ? [absolutePath] : [];
  }));
  return files.flat();
}

const testFiles = (await findTests(path.join(process.cwd(), "src"))).sort();
if (!testFiles.length) {
  console.error("No TypeScript test files were found under src.");
  process.exitCode = 1;
} else {
  // Enumerating paths here avoids shell- and Node-version-specific glob
  // behavior in local development and GitHub Actions.
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "--test", ...testFiles],
    { stdio: "inherit" },
  );

  child.on("error", (error) => {
    console.error(error);
    process.exitCode = 1;
  });
  child.on("exit", (code, signal) => {
    if (signal) {
      console.error(`Test runner stopped by ${signal}.`);
      process.exitCode = 1;
      return;
    }
    process.exitCode = code ?? 1;
  });
}
