import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type Venue = {
  id: string;
  name: string;
  city?: string | null;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
};

type PlaceCandidate = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  types?: string[];
};

const normalize = (value: unknown) => String(value || "").toLowerCase().normalize("NFKD").replace(/\p{Diacritic}/gu, "").replace(/&/g, " and ").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

function tokenSimilarity(left: string, right: string) {
  const a = new Set(normalize(left).split(" ").filter(Boolean));
  const b = new Set(normalize(right).split(" ").filter(Boolean));
  if (!a.size || !b.size) return 0;
  const overlap = [...a].filter(token => b.has(token)).length;
  return (2 * overlap) / (a.size + b.size);
}

function candidateScore(venue: Venue, candidate: PlaceCandidate) {
  const candidateName = candidate.displayName?.text || "";
  const address = candidate.formattedAddress || "";
  const nameScore = tokenSimilarity(venue.name, candidateName);
  const cityScore = venue.city && normalize(address).includes(normalize(venue.city)) ? 1 : 0;
  const addressScore = venue.address ? tokenSimilarity(venue.address, address) : 0;
  return nameScore * 0.68 + cityScore * 0.2 + addressScore * 0.12;
}

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

async function searchPlace(apiKey: string, venue: Venue) {
  const textQuery = [venue.name, venue.address, venue.city, "Virginia"].filter(Boolean).join(", ");
  const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location,places.types",
    },
    body: JSON.stringify({ textQuery, maxResultCount: 5, languageCode: "en" }),
    cache: "no-store",
  });
  if (!response.ok) return { candidate: null, score: 0, error: `Google ${response.status}` };
  const payload = await response.json() as { places?: PlaceCandidate[] };
  const ranked = (payload.places || [])
    .map(candidate => ({ candidate, score: candidateScore(venue, candidate) }))
    .sort((left, right) => right.score - left.score);
  return { candidate: ranked[0]?.candidate || null, score: ranked[0]?.score || 0, error: null };
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return NextResponse.json({ success: false, error: "GOOGLE_PLACES_API_KEY is missing" }, { status: 500 });

  const body = await request.json().catch(() => ({})) as { limit?: number; dryRun?: boolean };
  const limit = Math.max(1, Math.min(25, Math.round(Number(body.limit || 10))));
  const dryRun = body.dryRun !== false;
  const { data, error } = await db
    .from("venues")
    .select("id,name,city,address,lat,lng")
    .is("google_place_id", null)
    .order("name")
    .limit(limit);
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  const results = [];
  for (const venue of (data || []) as Venue[]) {
    const match = await searchPlace(apiKey, venue);
    const candidate = match.candidate;
    const accepted = Boolean(candidate?.id && match.score >= 0.78);
    let updated = false;
    let updateError: string | null = null;

    if (accepted && !dryRun && candidate) {
      const latitude = Number(candidate.location?.latitude);
      const longitude = Number(candidate.location?.longitude);
      const update = await db.from("venues").update({
        google_place_id: candidate.id,
        address: candidate.formattedAddress || venue.address || null,
        lat: Number.isFinite(latitude) ? latitude : venue.lat,
        lng: Number.isFinite(longitude) ? longitude : venue.lng,
        enriched_at: new Date().toISOString(),
        photo_source: "google_places_enrichment",
      }).eq("id", venue.id);
      updated = !update.error;
      updateError = update.error?.message || null;
    }

    results.push({
      venueId: venue.id,
      venueName: venue.name,
      candidateId: candidate?.id || null,
      candidateName: candidate?.displayName?.text || null,
      candidateAddress: candidate?.formattedAddress || null,
      confidence: Number(match.score.toFixed(3)),
      accepted,
      updated,
      error: match.error || updateError,
    });
  }

  return NextResponse.json({
    success: true,
    dryRun,
    threshold: 0.78,
    processed: results.length,
    accepted: results.filter(result => result.accepted).length,
    updated: results.filter(result => result.updated).length,
    results,
  }, { headers: { "Cache-Control": "private, no-store" } });
}
