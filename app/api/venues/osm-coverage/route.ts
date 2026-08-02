import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { isCronAuthorized } from "../../../../src/lib/cron-auth";
import { venueKinds } from "../../../../src/lib/venue-kind";
import { getCachedOsmVenueCandidates } from "../../../../src/lib/integrations/osm-cache";
import {
  PRIORITY_NIGHTLIFE_SCOPES,
  priorityNightlifeScopeIds,
  type PriorityNightlifeScope,
} from "../../../../src/lib/buzz/priority-nightlife-scopes";
import {
  buildOsmNightlifeCoverage,
  type OsmCoverageCandidate,
  type VenueForOsmMatch,
} from "../../../../src/lib/integrations/osm";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PAGE_SIZE = 1_000;
const MAX_DATABASE_VENUES = 10_000;
const CORE_CITIES = new Set([
  "chesapeake",
  "hampton",
  "newport news",
  "norfolk",
  "portsmouth",
  "suffolk",
  "virginia beach",
]);

function normalized(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function candidateScope(city: string | null) {
  if (!city) return "unknown-city";
  return CORE_CITIES.has(normalized(city)) ? "core-city" : "other-tagged-city";
}

function candidateCity(item: OsmCoverageCandidate) {
  return item.candidate.city || item.match?.venue.city || null;
}

function reviewLimit(request: Request) {
  const requested = Number(new URL(request.url).searchParams.get("limit") || 100);
  return Number.isFinite(requested) ? Math.max(1, Math.min(500, Math.round(requested))) : 100;
}

async function fetchAllVenues() {
  const db = getSupabaseAdmin();
  const venues: VenueForOsmMatch[] = [];

  for (let from = 0; from < MAX_DATABASE_VENUES; from += PAGE_SIZE) {
    const result = await db
      .from("venues")
      .select("id,name,city,address,lat,lng,phone,website,category,type")
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (result.error) throw new Error(`Venue inventory query failed: ${result.error.message}`);
    const page = (result.data || []) as VenueForOsmMatch[];
    venues.push(...page);
    if (page.length < PAGE_SIZE) break;
  }

  return {
    venues,
    truncated: venues.length >= MAX_DATABASE_VENUES,
  };
}

function cityBreakdown(items: OsmCoverageCandidate[]) {
  const counts: Record<string, { total: number; matched: number; unmatched: number }> = {};
  for (const item of items) {
    const city = candidateCity(item) || "Unknown city";
    counts[city] ||= { total: 0, matched: 0, unmatched: 0 };
    counts[city].total += 1;
    counts[city][item.match ? "matched" : "unmatched"] += 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function scopeBreakdown(items: OsmCoverageCandidate[]) {
  return items.reduce<Record<string, number>>((counts, item) => {
    const scope = candidateScope(candidateCity(item));
    counts[scope] = (counts[scope] || 0) + 1;
    return counts;
  }, {});
}

function metadataCompleteness(items: OsmCoverageCandidate[]) {
  const total = items.length;
  const coverage = (count: number) => total ? Number((count / total).toFixed(3)) : 0;
  return {
    address: coverage(items.filter(item => item.candidate.address).length),
    phone: coverage(items.filter(item => item.candidate.phone).length),
    website: coverage(items.filter(item => item.candidate.website).length),
    cityTag: coverage(items.filter(item => item.candidate.city).length),
  };
}

function evidenceBreakdown(items: OsmCoverageCandidate[]) {
  const counts = {
    primaryTag: { total: 0, matched: 0, unmatched: 0 },
    secondaryTag: { total: 0, matched: 0, unmatched: 0 },
    nameReview: { total: 0, matched: 0, unmatched: 0 },
  };
  for (const item of items) {
    const key = item.evidence === "primary-tag"
      ? "primaryTag"
      : item.evidence === "secondary-tag"
        ? "secondaryTag"
        : "nameReview";
    counts[key].total += 1;
    counts[key][item.match ? "matched" : "unmatched"] += 1;
  }
  return counts;
}

function candidateSummary(item: OsmCoverageCandidate) {
  const candidate = item.candidate;
  const city = candidateCity(item);
  return {
    name: candidate.name,
    city,
    citySource: candidate.city ? "openstreetmap" : item.match?.venue.city ? "matched-database" : "unknown",
    cityScope: candidateScope(city),
    latitude: candidate.latitude,
    longitude: candidate.longitude,
    address: candidate.address,
    phone: candidate.phone,
    website: candidate.website,
    type: candidate.type,
    evidence: item.evidence,
    osmUrl: candidate.osmUrl,
    sourceElements: item.sourceKeys,
  };
}

function venueSummary(venue: VenueForOsmMatch) {
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

function priorityScopeReport(
  scope: PriorityNightlifeScope,
  venues: VenueForOsmMatch[],
  candidates: OsmCoverageCandidate[],
) {
  const databaseInventory = venues
    .filter(venue => priorityNightlifeScopeIds(venue).includes(scope.id))
    .sort((left, right) => left.name.localeCompare(right.name));
  const nightlifeInventory = databaseInventory.filter(venue => venueKinds(venue).includes("nightlife"));
  const osmCandidates = candidates
    .filter(item => priorityNightlifeScopeIds({
      city: candidateCity(item),
      address: item.candidate.address || item.match?.venue.address || null,
      lat: item.candidate.latitude,
      lng: item.candidate.longitude,
    }).includes(scope.id));
  const matched = osmCandidates.filter(item => item.match);
  const unmatched = osmCandidates.filter(item => !item.match);

  return {
    id: scope.id,
    name: scope.name,
    definition: scope.definition,
    database: {
      totalVenues: databaseInventory.length,
      nightlifeVenues: nightlifeInventory.length,
      inventory: databaseInventory.map(venueSummary),
    },
    osm: {
      totalCandidates: osmCandidates.length,
      matchedCandidates: matched.length,
      unmatchedReviewCandidates: unmatched.length,
      byEvidence: evidenceBreakdown(osmCandidates),
      unmatched: unmatched
        .sort((left, right) => left.candidate.name.localeCompare(right.candidate.name))
        .map(candidateSummary),
      matched: matched
        .sort((left, right) => left.candidate.name.localeCompare(right.candidate.name))
        .map(item => ({
          ...candidateSummary(item),
          matchedVenue: venueSummary(item.match!.venue),
          nameScore: Number(item.match!.nameScore.toFixed(3)),
          distanceMiles: item.match!.distanceMiles === null
            ? null
            : Number(item.match!.distanceMiles.toFixed(3)),
        })),
    },
    truthNote: "The inventory is a protected production snapshot and the OSM list is a review source, not proof of completeness or current operation. Unmatched candidates still require current-license or first-party verification before import.",
  };
}

export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const [osm, database] = await Promise.all([
      getCachedOsmVenueCandidates(),
      fetchAllVenues(),
    ]);
    const coverage = buildOsmNightlifeCoverage(database.venues, osm.candidates);
    const unmatched = coverage.candidates.filter(item => !item.match);
    const matched = coverage.candidates.filter(item => item.match);
    const classificationGaps = matched.filter(item => {
      const venue = item.match?.venue;
      return venue && !venueKinds(venue).includes("nightlife");
    });
    const limit = reviewLimit(request);
    const reviewCandidates = unmatched
      .sort((left, right) => left.candidate.name.localeCompare(right.candidate.name))
      .slice(0, limit)
      .map(candidateSummary);

    return NextResponse.json({
      success: true,
      mode: "read-only-review",
      generatedAt: new Date().toISOString(),
      provider: "OpenStreetMap via Overpass API",
      attribution: "© OpenStreetMap contributors, ODbL 1.0",
      scope: {
        name: "Buzz Hampton Roads discovery bounds",
        bounds: "36.42,-76.95,37.38,-75.70",
        note: "Core-city, other-tagged-city, and unknown-city counts remain separate so untagged or wider-region candidates are not silently excluded.",
      },
      source: {
        osmBaseTimestamp: osm.osmBaseTimestamp,
        fetchedAt: osm.generatedAt,
        rawElementCount: osm.rawElementCount,
      },
      database: {
        venuesEvaluated: database.venues.length,
        truncatedAtSafetyLimit: database.truncated,
      },
      coverage: {
        rawNightlifeElements: coverage.rawNightlifeCandidates,
        uniqueNightlifeCandidates: coverage.uniqueNightlifeCandidates,
        duplicateElementsRemoved: coverage.duplicateElementsRemoved,
        matchedCandidates: coverage.matchedCandidates,
        unmatchedReviewCandidates: coverage.unmatchedCandidates,
        matchedAsNightlife: matched.length - classificationGaps.length,
        matchedClassificationGaps: classificationGaps.length,
        osmReviewCoverageRate: coverage.uniqueNightlifeCandidates
          ? Number((coverage.matchedCandidates / coverage.uniqueNightlifeCandidates).toFixed(3))
          : 0,
        byCity: cityBreakdown(coverage.candidates),
        byScope: scopeBreakdown(coverage.candidates),
        byEvidence: evidenceBreakdown(coverage.candidates),
        metadataCompleteness: metadataCompleteness(coverage.candidates),
      },
      priorityScopes: PRIORITY_NIGHTLIFE_SCOPES.map(scope => (
        priorityScopeReport(scope, database.venues, coverage.candidates)
      )),
      reviewCandidates,
      classificationGaps: classificationGaps.slice(0, limit).map(item => ({
        ...candidateSummary(item),
        matchedVenue: {
          id: item.match?.venue.id,
          name: item.match?.venue.name,
          category: item.match?.venue.category,
          type: item.match?.venue.type,
          nameScore: item.match ? Number(item.match.nameScore.toFixed(3)) : null,
          distanceMiles: item.match?.distanceMiles === null || item.match?.distanceMiles === undefined
            ? null
            : Number(item.match.distanceMiles.toFixed(3)),
        },
      })),
      reviewLimit: limit,
      truthNote: "This is a review queue, not proof of complete nightlife coverage. Primary and secondary OSM tags are kept separate from conservative name-only suggestions. OSM can be incomplete or stale; unmatched candidates require verification before any import. No venue or activity data is changed by this endpoint.",
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("OSM nightlife coverage audit failed", error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : "Coverage audit failed",
    }, { status: 502, headers: { "Cache-Control": "private, no-store" } });
  }
}
