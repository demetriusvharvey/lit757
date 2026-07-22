import { NextResponse } from "next/server";
import { fetchAllInstitutionCalendars } from "../../../../src/lib/events/institution-calendars";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const data = await fetchAllInstitutionCalendars();
  const successfulSources = data.results.filter(result => result.status === "ok").length;
  const byKind = data.summary.byKind;

  return NextResponse.json({
    success: successfulSources > 0,
    partial: data.summary.failedSources > 0,
    provider: "Official Hampton Roads institutions and venues",
    generatedAt: data.generatedAt,
    summary: data.summary,
    byKind,
    sources: data.results.map(result => ({
      id: result.source.id,
      name: result.source.name,
      kind: result.source.kind,
      city: result.source.city,
      format: result.source.format,
      status: result.status,
      eventCount: result.events.length,
      error: result.error,
      coverageNote: result.source.coverageNote || null,
      sourceUrl: result.source.url,
    })),
    truthNote: "Institution and venue calendars describe scheduled activity; they cannot establish live occupancy.",
  }, {
    status: successfulSources ? 200 : 502,
    headers: { "Cache-Control": "public, s-maxage=900, stale-while-revalidate=1800" },
  });
}
