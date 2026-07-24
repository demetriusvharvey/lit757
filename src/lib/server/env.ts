const CORE_SERVER_VARIABLES = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_MAPBOX_TOKEN",
] as const;

export class EnvironmentConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvironmentConfigurationError";
  }
}

export function requireServerEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new EnvironmentConfigurationError(
      `Missing required server environment variable: ${name}`,
    );
  }
  return value;
}

export function readSupabaseServerEnvironment() {
  const url = requireServerEnvironment("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = requireServerEnvironment("SUPABASE_SERVICE_ROLE_KEY");

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new EnvironmentConfigurationError(
      "NEXT_PUBLIC_SUPABASE_URL must be a valid URL",
    );
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new EnvironmentConfigurationError(
      "NEXT_PUBLIC_SUPABASE_URL must use http or https",
    );
  }

  return { url, serviceRoleKey };
}

/**
 * Called by Next.js instrumentation before a Node server starts accepting
 * requests. Optional provider keys stay optional; only variables required for
 * the core web and mobile experience are startup-blocking.
 */
export function validateCoreServerEnvironment() {
  const missing = CORE_SERVER_VARIABLES.filter(
    (name) => !process.env[name]?.trim(),
  );
  if (missing.length) {
    throw new EnvironmentConfigurationError(
      `Missing required core environment variables: ${missing.join(", ")}`,
    );
  }
  readSupabaseServerEnvironment();
}
