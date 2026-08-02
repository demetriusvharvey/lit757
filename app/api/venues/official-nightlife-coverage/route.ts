import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { isCronAuthorized } from "../../../../src/lib/cron-auth";
import {
  PRIORITY_NIGHTLIFE_SCOPES,
  priorityNightlifeScopeIds,
  type PriorityNightlifeScope,
} from "../../../../src/lib/buzz/priority-nightlife-scopes";
import { venueKinds } from "../../../../src/lib/venue-kind";
import {
  buildOfficialNightlifeCoverage,
  DOWNTOWN_NORFOLK_NIGHTLIFE_URL,
  fetchDowntownNorfolkNightlife,
  fetchPortsmouthVisitorNightlife,
  PORTSMOUTH_VISITOR_DIRECTORY_API_URL,
  PORTSMOUTH_VISITOR_DIRECTORY_URL,
  type OfficialNightlifeCandidate,
  type OfficialNightlifeMatch,
  type VenueForOfficialDirectoryMatch,
} from "../../../../src/lib/integrations/official-nightlife-directories";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PAGE_SIZE = 1_000;
const MAX_DATABASE_VENUES = 10_000;
const OCEANFRONT_DIRECTORY_URL =
  "https://www.visitvirginiabeach.com/experiences/beaches-districts/oceanfront/";

type SourceResult = {
  id: OfficialNightlifeCandidate["sourceId"];
  authority: string;
  directoryUrl: string;
  dataUrl: string;
  candidates: OfficialNightlifeCandidate[];
  error: string | null;
};

function reviewLimit(request: Request) {
  const requested = Number(new URL(request.url).searchParams.get("limit") || 200);
  return Number.isFinite(requested) ? Math.max(1, Math.min(500, Math.round(requested))) : 200;
}

async function fetchAllVenues() {
  const db = getSupabaseAdmin();
  const venues: VenueForOfficialDirectoryMatch[] = [];

  for (let from = 0; from < MAX_DATABASE_VENUES; from += PAGE_SIZE) {
    const result = await db
      .from("venues")
      .select("id,name,city,address,lat,lng,phone,website,category,type")
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (result.error) throw new Error(`Venue inventory query failed: ${result.error.message}`);
    const page = (result.data || []) as VenueForOfficialDirectoryMatch[];
    venues.push(...page);
    if (page.length < PAGE_SIZE) break;
  }

  return { venues, truncated: venues.length >= MAX_DATABASE_VENUES };
}

async function sourceResult(
  metadata: Omit<SourceResult, "candidates" | "error">,
  fetcher: () => Promise<OfficialNightlifeCandidate[]>,
): Promise<SourceResult> {
  try {
    return { ...metadata, candidates: await fetcher(), error: null };
  } catch (error) {
    return {
      ...metadata,
      candidates: [],
      error: error instanceof Error ? error.message : "Source request failed",
    };
  }
}

function candidateSummary(candidate: OfficialNightlifeCandidate) {
  return {
    sourceId: candidate.sourceId,
    sourceUrl: candidate.sourceUrl,
    sourceItemId: candidate.sourceItemId,
    scopeId: candidate.scopeId,
    name: candidate.name,
    city: candidate.city,
    address: candidate.address,
    latitude: candidate.latitude,
    longitude: candidate.longitude,
    categories: candidate.categories,
    operatingStatus: candidate.operatingStatus,
    evidence: candidate.evidence,
  };
}

function venueSummary(venue: VenueForOfficialDirectoryMatch) {
  return {
    id: venue.id,
    name: venue.name,
    city: venue.city || null,
    address: venue.address || null,
    latitude: venue.lat === null || venue.lat === undefined ? null : Number(venue.lat),
    longitude: venue.lng === null || venue.lng === undefined ? null : Number(venue.lng),
    phone: venue.phone || null,
    website: venue.website || null,
    category: venue.category || null,
    type: venue.type || null,
    kinds: venueKinds(venue),
  };
}

function matchSummary(match: OfficialNightlifeMatch) {
  return {
    ...candidateSummary(match.candidate),
    matchedVenue: venueSummary(match.venue),
    nameScore: Number(match.nameScore.toFixed(3)),
    addressMatched: match.addressMatched,
    distanceMiles: match.distanceMiles === null
      ? null
      : Number(match.distanceMiles.toFixed(3)),
  };
}

function evidenceBreakdown(candidates: readonly OfficialNightlifeCandidate[]) {
  return candidates.reduce<Record<string, number>>((counts, candidate) => {
    counts[candidate.evidence] = (counts[candidate.evidence] || 0) + 1;
    return counts;
  }, {});
}

function scopeSourceStatus(scopeId: PriorityNightlifeScope["id"], sources: SourceResult[]) {
  if (scopeId === "virginia-beach-oceanfront") return "not-audited";
  const source = sources.find(item => item.candidates.some(candidate => candidate.scopeId === scopeId))
    || sources.find(item => (
      scopeId === "downtown-norfolk"
        ? item.id === "downtown-norfolk-nightlife"
        : item.id === "portsmouth-visitor-directory"
    ));
  return source?.error ? "source-failed" : "ok";
}

function scopeReport(
  scope: PriorityNightlifeScope,
  venues: VenueForOfficialDirectoryMatch[],
  candidates: OfficialNightlifeCandidate[],
  sources: SourceResult[],
  limit: number,
) {
  const databaseInventory = venues
    .filter(venue => priorityNightlifeScopeIds(venue).includes(scope.id))
    .sort((left, right) => left.name.localeCompare(right.name));
  const nightlifeInventory = databaseInventory.filter(venue => venueKinds(venue).includes("nightlife"));
  const scopedCandidates = candidates.filter(candidate => candidate.scopeId === scope.id);
  const coverage = buildOfficialNightlifeCoverage(venues, scopedCandidates);
  const matched = coverage.reviewed.filter(item => item.match);
  const unmatched = coverage.reviewed.filter(item => !item.match);

  return {
    id: scope.id,
    name: scope.name,
    definition: scope.definition,
    sourceStatus: scopeSourceStatus(scope.id, sources),
    database: {
      totalVenues: databaseInventory.length,
      nightlifeVenues: nightlifeInventory.length,
      inventory: databaseInventory.map(venueSummary),
    },
    officialDirectory: {
      sourceCandidates: coverage.sourceCandidates,
      activeCandidates: coverage.activeCandidates,
      inactiveCandidates: coverage.inactiveCandidates,
      matchedCandidates: coverage.matchedCandidates,
      unmatchedReviewCandidates: coverage.unmatchedCandidates,
      officialDirectoryMatchRate: coverage.coverageRate,
      byEvidence: evidenceBreakdown(scopedCandidates),
      unmatched: unmatched.slice(0, limit).map(item => candidateSummary(item.candidate)),
      matched: matched.slice(0, limit).map(item => matchSummary(item.match!)),
      inactive: coverage.inactive.slice(0, limit).map(candidateSummary),
    },
    truthNote: scope.id === "virginia-beach-oceanfront"
      ? "No current official source found exposes a complete machine-readable Oceanfront bar and club directory. This scope is explicitly not audited here; its zero source candidates must never be interpreted as complete coverage."
      : "An official destination directory is stronger discovery evidence than an open map, but it can still be incomplete, broad, or stale. An unmatched listing is a verification lead, not automatic approval to insert a venue.",
  };
}

export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const [database, downtownNorfolk, portsmouth] = await Promise.all([
      fetchAllVenues(),
      sourceResult({
        id: "downtown-norfolk-nightlife",
        authority: "Downtown Norfolk Council",
        directoryUrl: DOWNTOWN_NORFOLK_NIGHTLIFE_URL,
        dataUrl: DOWNTOWN_NORFOLK_NIGHTLIFE_URL,
      }, fetchDowntownNorfolkNightlife),
      sourceResult({
        id: "portsmouth-visitor-directory",
        authority: "City of Portsmouth Department of Museums and Tourism",
        directoryUrl: PORTSMOUTH_VISITOR_DIRECTORY_URL,
        dataUrl: PORTSMOUTH_VISITOR_DIRECTORY_API_URL,
      }, fetchPortsmouthVisitorNightlife),
    ]);
    const sources = [downtownNorfolk, portsmouth];
    const candidates = sources.flatMap(source => source.candidates);
    if (!candidates.length) {
      throw new Error(`All official directory sources failed: ${sources.map(source => source.error).join(" | ")}`);
    }
    const coverage = buildOfficialNightlifeCoverage(database.venues, candidates);
    const limit = reviewLimit(request);
    const unmatched = coverage.reviewed.filter(item => !item.match);
    const matched = coverage.reviewed.filter(item => item.match);
    const classificationGaps = matched.filter(item => (
      item.match && !venueKinds(item.match.venue).includes("nightlife")
    ));

    return NextResponse.json({
      success: true,
      mode: "read-only-review",
      generatedAt: new Date().toISOString(),
      provider: "Official local destination directories",
      database: {
        venuesEvaluated: database.venues.length,
        truncatedAtSafetyLimit: database.truncated,
      },
      sources: [
        ...sources.map(source => ({
          id: source.id,
          authority: source.authority,
          directoryUrl: source.directoryUrl,
          dataUrl: source.dataUrl,
          status: source.error ? "failed" : "ok",
          candidates: source.candidates.length,
          error: source.error,
        })),
        {
          id: "virginia-beach-oceanfront",
          authority: "Virginia Beach Convention & Visitors Bureau",
          directoryUrl: OCEANFRONT_DIRECTORY_URL,
          dataUrl: null,
          status: "not-audited",
          candidates: 0,
          error: "The current official Oceanfront page does not enumerate a complete bar and club directory.",
        },
      ],
      coverage: {
        sourceCandidates: coverage.sourceCandidates,
        activeCandidates: coverage.activeCandidates,
        inactiveCandidates: coverage.inactiveCandidates,
        matchedCandidates: coverage.matchedCandidates,
        unmatchedReviewCandidates: coverage.unmatchedCandidates,
        matchedAsNightlife: matched.length - classificationGaps.length,
        matchedClassificationGaps: classificationGaps.length,
        officialDirectoryMatchRate: coverage.coverageRate,
        byEvidence: evidenceBreakdown(candidates),
      },
      priorityScopes: PRIORITY_NIGHTLIFE_SCOPES.map(scope => (
        scopeReport(scope, database.venues, candidates, sources, limit)
      )),
      reviewCandidates: unmatched.slice(0, limit).map(item => candidateSummary(item.candidate)),
      classificationGaps: classificationGaps.slice(0, limit).map(item => matchSummary(item.match!)),
      inactiveCandidates: coverage.inactive.slice(0, limit).map(candidateSummary),
      reviewLimit: limit,
      truthNote: "This protected endpoint is read-only. Official directories improve discovery evidence but do not prove completeness or current operation. Brewery/taphouse-only Portsmouth entries remain a separate review tier, closed-status entries are excluded from active matching, and every unmatched candidate requires first-party or current-license verification before import.",
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Official nightlife coverage audit failed", error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : "Official directory coverage audit failed",
    }, { status: 502, headers: { "Cache-Control": "private, no-store" } });
  }
}
