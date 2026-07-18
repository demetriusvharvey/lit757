export function isCronAuthorized(request: Request) {
  const configuredSecret = process.env.CRON_SECRET;
  if (!configuredSecret) return false;

  const authorization = request.headers.get("authorization");
  if (authorization === `Bearer ${configuredSecret}`) return true;

  // Keep query-string auth for deliberate local/manual runs, while Vercel Cron
  // uses the Authorization header and no longer exposes the secret in vercel.json.
  const requestUrl = new URL(request.url);
  return requestUrl.searchParams.get("secret") === configuredSecret;
}
