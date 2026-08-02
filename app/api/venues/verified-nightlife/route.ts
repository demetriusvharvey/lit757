import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { isCronAuthorized } from "../../../../src/lib/cron-auth";
import {
  VERIFIED_NIGHTLIFE_IMPORT,
  importableVerifiedNightlifeVenues,
  verifiedNightlifeInsertRow,
  type ExistingVenueForImport,
} from "../../../../src/lib/verified-nightlife-import";

export const dynamic = "force-dynamic";

const WRITE_CONFIRMATION = `apply:${VERIFIED_NIGHTLIFE_IMPORT.batchId}:${VERIFIED_NIGHTLIFE_IMPORT.backup.sha256}`;

function dryRun(request: Request) {
  return new URL(request.url).searchParams.get("dryRun") !== "0";
}

export async function POST(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const preview = dryRun(request);
  const confirmation = new URL(request.url).searchParams.get("confirm");
  if (!preview && confirmation !== WRITE_CONFIRMATION) {
    return NextResponse.json({
      success: false,
      error: "Write confirmation does not match the verified batch and production snapshot.",
    }, { status: 400 });
  }

  try {
    const db = getSupabaseAdmin();
    const inventoryResult = await db
      .from("venues")
      .select("id,name,city,lat,lng")
      .limit(10_000);
    if (inventoryResult.error) {
      throw new Error(`Venue inventory query failed: ${inventoryResult.error.message}`);
    }

    const plan = importableVerifiedNightlifeVenues(
      (inventoryResult.data || []) as ExistingVenueForImport[],
    );
    const reviewed = plan.additions.map(venue => ({
      id: venue.id,
      name: venue.name,
      city: venue.city,
      address: venue.address,
      scopeId: venue.scopeId,
      officialSourceUrl: venue.officialSourceUrl,
      supportingSourceUrl: venue.supportingSourceUrl,
    }));
    const duplicates = plan.duplicates.map(item => ({
      candidate: { id: item.candidate.id, name: item.candidate.name, city: item.candidate.city },
      existing: { id: item.existing.id, name: item.existing.name, city: item.existing.city || null },
    }));
    const base = {
      success: true,
      mode: preview ? "dry-run" : "apply",
      batchId: VERIFIED_NIGHTLIFE_IMPORT.batchId,
      backup: VERIFIED_NIGHTLIFE_IMPORT.backup,
      databaseVenuesEvaluated: (inventoryResult.data || []).length,
      reviewedAdditions: reviewed,
      existingDuplicates: duplicates,
      rollbackVenueIds: plan.additions.map(venue => venue.id),
      truthNote: "These rows add verified venue identity and location only. They do not assert current crowd activity or make a venue Live.",
    };

    if (preview || !plan.additions.length) {
      return NextResponse.json({ ...base, inserted: 0 }, {
        headers: { "Cache-Control": "private, no-store" },
      });
    }

    const enrichedAt = new Date().toISOString();
    const insertResult = await db
      .from("venues")
      .insert(plan.additions.map(venue => verifiedNightlifeInsertRow(venue, enrichedAt)))
      .select("id,name,city,address");
    if (insertResult.error) {
      throw new Error(`Verified venue insert failed: ${insertResult.error.message}`);
    }

    return NextResponse.json({
      ...base,
      inserted: insertResult.data?.length || 0,
      insertedVenues: insertResult.data || [],
      rollbackVenueIds: (insertResult.data || []).map(venue => venue.id),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Verified nightlife import failed", error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : "Verified nightlife import failed",
    }, { status: 502, headers: { "Cache-Control": "private, no-store" } });
  }
}
