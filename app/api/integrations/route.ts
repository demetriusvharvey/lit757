import { NextResponse } from "next/server";
import { integrationSnapshot } from "../../../src/lib/integration-catalog";

export const dynamic = "force-dynamic";

export async function GET() {
  const integrations = integrationSnapshot();
  const counts = integrations.reduce<Record<string, number>>((summary, integration) => {
    summary[integration.state] = (summary[integration.state] || 0) + 1;
    return summary;
  }, {});

  return NextResponse.json({
    success: true,
    generatedAt: new Date().toISOString(),
    counts,
    integrations,
    truthNote: "Discovery and forecast-context integrations cannot mark a venue Live without direct or verified evidence.",
  }, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
