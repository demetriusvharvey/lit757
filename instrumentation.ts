export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Dynamic import keeps Node-only startup validation out of edge bundles.
  const { validateCoreServerEnvironment } = await import(
    "./src/lib/server/env"
  );
  validateCoreServerEnvironment();
}
