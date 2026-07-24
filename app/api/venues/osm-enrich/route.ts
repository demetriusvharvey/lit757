import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { getCachedOsmVenueCandidates } from "../../../../src/lib/integrations/osm-cache";
import {
  findBestOsmMatch,
  osmEnrichmentPatch,
  summarizeOsmCandidates,
  type VenueForOsmMatch,
} from "../../../../src/lib/integrations/osm";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const db = getSupabaseAdmin();

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  return request.headers.get("authorization") === `Bearer ${secret}`
    || request.headers.get("x-cron-secret") === secret;
}

function options(request: Request) {
  const url = new URL(request.url);
  const value = Number(url.searchParams.get("limit") || 250);
  return {
    dryRun: ["1", "true"].includes(String(url.searchParams.get("dryRun"))),
    limit: Number.isFinite(value) ? Math.max(1, Math.min(500, Math.round(value))) : 250,
  };
}

function needsEnrichment(venue: VenueForOsmMatch) {
  const blank = (value: unknown) => !String(value || "").trim();
  const generic = (value: unknown) => ["", "other", "unknown", "local spot", "local business", "place"]
    .includes(String(value || "").trim().toLowerCase());
  const lat = Number(venue.lat);
  const lng = Number(venue.lng);
  return blank(venue.address) || blank(venue.phone) || blank(venue.website)
    || generic(venue.category) || generic(venue.type)
    || !Number.isFinite(lat) || !Number.isFinite(lng) || lat === 0 || lng === 0;
}

async function run(request: Request) {
  if (!authorized(request)) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  const config = options(request);
  const [osm, venueResult] = await Promise.all([
    getCachedOsmVenueCandidates(),
    db.from("venues")
      .select("id,name,city,address,lat,lng,phone,website,category,type,enriched_at")
      .limit(2500),
  ]);
  if (venueResult.error) return NextResponse.json({ success: false, error: venueResult.error.message }, { status: 500 });

  const allVenues = (venueResult.data || []) as VenueForOsmMatch[];
  const venues = allVenues.filter(needsEnrichment).slice(0, config.limit);
  const generatedAt = new Date().toISOString();
  const proposals = venues.flatMap(venue => {
    const match = findBestOsmMatch(venue, osm.candidates);
    if (!match) return [];
    const patch = osmEnrichmentPatch(match, generatedAt);
    return patch ? [{ venue, match, patch }] : [];
  });

  const failures: Array<{ venueId: string; venueName: string; error: string }> = [];
  let updated = 0;
  if (!config.dryRun) {
    for (const proposal of proposals) {
      const result = await db.from("venues").update(proposal.patch).eq("id", proposal.venue.id);
      if (result.error) failures.push({
        venueId: proposal.venue.id,
        venueName: proposal.venue.name,
        error: result.error.message,
      });
      else updated += 1;
    }
  }

  const fieldsProposed: Record<string, number> = {};
  proposals.forEach(proposal => Object.keys(proposal.patch)
    .filter(key => key !== "enriched_at")
    .forEach(key => { fieldsProposed[key] = (fieldsProposed[key] || 0) + 1; }));

  return NextResponse.json({
    success: failures.length === 0,
    partial: failures.length > 0,
    generatedAt,
    provider: "OpenStreetMap via Overpass API",
    dryRun: config.dryRun,
    attribution: "© OpenStreetMap contributors, ODbL 1.0",
    truthNote: "OSM fills missing venue metadata only. Existing first-party and Google fields are not overwritten, and OSM is not an occupancy signal.",
    osm: { osmBaseTimestamp: osm.osmBaseTimestamp, rawElementCount: osm.rawElementCount, ...summarizeOsmCandidates(osm.candidates) },
    venues: {
      totalInDatabase: allVenues.length,
      needingEnrichment: allVenues.filter(needsEnrichment).length,
      evaluated: venues.length,
      matchedWithUsefulPatch: proposals.length,
      updated,
      failedUpdates: failures.length,
      fieldsProposed,
    },
    matches: proposals.slice(0, 50).map(proposal => ({
      venueId: proposal.venue.id,
      venueName: proposal.venue.name,
      osmName: proposal.match.candidate.name,
      osmUrl: proposal.match.candidate.osmUrl,
      nameScore: Number(proposal.match.nameScore.toFixed(3)),
      distanceMiles: proposal.match.distanceMiles === null ? null : Number(proposal.match.distanceMiles.toFixed(3)),
      fields: Object.keys(proposal.patch).filter(key => key !== "enriched_at"),
    })),
    failures: failures.slice(0, 50),
  }, { status: failures.length ? 207 : 200, headers: { "Cache-Control": "private, no-store" } });
}

export async function GET(request: Request) { return run(request); }
export async function POST(request: Request) { return run(request); }
