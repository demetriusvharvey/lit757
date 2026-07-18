async function main() {
  const baseUrl = String(process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    throw new Error("Missing CRON_SECRET. Load .env.local before running this script.");
  }

  for (let batch = 1; batch <= 20; batch += 1) {
    const response = await fetch(`${baseUrl}/api/refresh-venue-photos?limit=100`, {
      headers: { Authorization: `Bearer ${secret}` },
    });
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || `Photo refresh failed with ${response.status}`);
    }

    console.log(
      `Batch ${batch}: ${result.verified || 0} storefronts verified, ` +
        `${result.unavailable || 0} safely left without a photo, ` +
        `${result.failed || 0} failed.`
    );

    if (!result.processed) break;
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
