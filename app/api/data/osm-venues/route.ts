import { NextResponse } from "next/server";
import { getCachedOsmVenueCandidates } from "../../../../src/lib/integrations/osm-cache";
import { OVERPASS_ENDPOINT, summarizeOsmCandidates } from "../../../../src/lib/integrations/osm";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    const data = await getCachedOsmVenueCandidates();
    const summary = summarizeOsmCandidates(data.candidates);
    return NextResponse.json({
      success: true,
      provider: "OpenStreetMap via Overpass API",
      generatedAt: data.generatedAt,
      osmBaseTimestamp: data.osmBaseTimestamp,
      endpoint: OVERPASS_ENDPOINT,
      bounds: "Hampton Roads",
      rawElementCount: data.rawElementCount,
      summary,
      sample: data.candidates.slice(0, 20).map(candidate => ({
        osmType: candidate.osmType,
        osmId: candidate.osmId,
        name: candidate.name,
        city: candidate.city,
        category: candidate.category,
        type: candidate.type,
        hasAddress: Boolean(candidate.address),
        hasPhone: Boolean(candidate.phone),
        hasWebsite: Boolean(candidate.website),
        osmUrl: candidate.osmUrl,
      })),
      attribution: "© OpenStreetMap contributors, ODbL 1.0",
      truthNote: "OSM enriches venue identity and location metadata. It is not an activity or occupancy signal.",
    }, {
      headers: { "Cache-Control": "public, s-maxage=21600, stale-while-revalidate=43200" },
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      provider: "OpenStreetMap via Overpass API",
      error: error instanceof Error ? error.message : "OpenStreetMap request failed",
      attribution: "© OpenStreetMap contributors, ODbL 1.0",
    }, { status: 502 });
  }
}
