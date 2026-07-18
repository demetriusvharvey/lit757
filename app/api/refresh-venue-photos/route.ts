import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isCronAuthorized } from "../../../src/lib/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type VenueRow = {
  id: string;
  name: string;
  city?: string | null;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  google_place_id?: string | null;
  photo_source?: string | null;
  google_rating?: number | null;
  hours?: Record<string, unknown> | null;
  phone?: string | null;
  website?: string | null;
  google_types?: string[] | null;
  enriched_at?: string | null;
};

type GooglePlace = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: {
    latitude?: number;
    longitude?: number;
  };
  rating?: number;
  regularOpeningHours?: Record<string, unknown>;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  websiteUri?: string;
  types?: string[];
  primaryType?: string;
};

const NAME_STOP_WORDS = new Set([
  "and",
  "bar",
  "club",
  "company",
  "grill",
  "inc",
  "llc",
  "lounge",
  "restaurant",
  "the",
  "va",
  "virginia",
]);

function normalizeBusinessName(value?: string | null) {
  const tokens = String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token && !NAME_STOP_WORDS.has(token));
  const normalizedTokens: string[] = [];

  for (const token of tokens) {
    if (/^\d$/.test(token) && /^\d+$/.test(normalizedTokens.at(-1) || "")) {
      normalizedTokens[normalizedTokens.length - 1] += token;
    } else {
      normalizedTokens.push(token);
    }
  }

  return normalizedTokens.join(" ").trim();
}

function nameMatchScore(expected?: string | null, actual?: string | null) {
  const left = normalizeBusinessName(expected);
  const right = normalizeBusinessName(actual);

  if (!left || !right) return 0;
  if (left === right) return 82;
  if (
    Math.min(left.length, right.length) >= 5 &&
    (left.includes(right) || right.includes(left))
  ) {
    return 68;
  }

  const leftTokens = new Set(left.split(" "));
  const rightTokens = new Set(right.split(" "));
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;

  return union ? (intersection / union) * 72 : 0;
}

function distanceMiles(
  fromLat?: number | null,
  fromLng?: number | null,
  toLat?: number | null,
  toLng?: number | null
) {
  const values = [fromLat, fromLng, toLat, toLng].map(Number);
  if (!values.every(Number.isFinite)) return null;

  const [lat1, lng1, lat2, lng2] = values;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLng / 2) ** 2;

  return 3958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isIn757(place: GooglePlace) {
  const latitude = Number(place.location?.latitude);
  const longitude = Number(place.location?.longitude);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return true;
  return longitude >= -76.9 && longitude <= -75.7 && latitude >= 36.42 && latitude <= 37.38;
}

function candidateScore(venue: VenueRow, place: GooglePlace) {
  if (!isIn757(place)) return -Infinity;

  let score = nameMatchScore(venue.name, place.displayName?.text);
  const expectedCity = String(venue.city || "").toLowerCase();
  const candidateAddress = String(place.formattedAddress || "").toLowerCase();

  if (expectedCity && candidateAddress.includes(expectedCity)) score += 16;

  const distance = distanceMiles(
    venue.lat,
    venue.lng,
    place.location?.latitude,
    place.location?.longitude
  );

  if (distance !== null) {
    if (distance <= 0.15) score += 32;
    else if (distance <= 0.5) score += 25;
    else if (distance <= 2) score += 12;
    else if (distance > 8) score -= 80;
    else if (distance > 4) score -= 30;
  }

  return score;
}

function placeLocation(place: GooglePlace, venue: VenueRow) {
  if (place.formattedAddress) return place.formattedAddress;
  if (venue.address) return venue.address;

  const latitude = Number(place.location?.latitude ?? venue.lat);
  const longitude = Number(place.location?.longitude ?? venue.lng);
  return Number.isFinite(latitude) && Number.isFinite(longitude)
    ? `${latitude},${longitude}`
    : "";
}

async function getPlaceDetails(placeId: string, apiKey: string) {
  const response = await fetch(
    `https://places.googleapis.com/v1/places/${placeId}`,
    {
      headers: {
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask":
          "id,displayName,formattedAddress,location,rating,regularOpeningHours,nationalPhoneNumber,internationalPhoneNumber,websiteUri,types,primaryType",
      },
      cache: "no-store",
    }
  );

  if (!response.ok) return null;
  return (await response.json()) as GooglePlace;
}

async function findGooglePlace(venue: VenueRow, apiKey: string) {
  const query = [venue.name, venue.address, venue.city ? `${venue.city}, VA` : ""]
    .filter(Boolean)
    .join(", ");
  const latitude = Number(venue.lat);
  const longitude = Number(venue.lng);
  const body: Record<string, unknown> = {
    textQuery: query,
    maxResultCount: 3,
    languageCode: "en",
    regionCode: "US",
  };

  if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
    body.locationBias = {
      circle: {
        center: { latitude, longitude },
        radius: 4000,
      },
    };
  }

  const response = await fetch(
    "https://places.googleapis.com/v1/places:searchText",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask":
          "places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.regularOpeningHours,places.nationalPhoneNumber,places.internationalPhoneNumber,places.websiteUri,places.types,places.primaryType",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    }
  );

  if (!response.ok) return null;

  const data = (await response.json()) as { places?: GooglePlace[] };
  const ranked = (data.places || [])
    .map((place) => ({ place, score: candidateScore(venue, place) }))
    .sort((a, b) => b.score - a.score);

  return ranked[0]?.score >= 70 ? ranked[0].place : null;
}

async function hasOutdoorStreetView(
  location: string,
  apiKey: string
) {
  if (!location) return false;

  const params = new URLSearchParams({
    location,
    source: "outdoor",
    radius: "100",
    key: apiKey,
  });
  const response = await fetch(
    `https://maps.googleapis.com/maps/api/streetview/metadata?${params.toString()}`,
    { cache: "no-store" }
  );

  if (!response.ok) return false;
  const metadata = (await response.json()) as { status?: string };
  return metadata.status === "OK";
}

async function refreshVenue(venue: VenueRow, apiKey: string) {
  const place = venue.google_place_id
    ? await getPlaceDetails(venue.google_place_id, apiKey)
    : await findGooglePlace(venue, apiKey);

  if (!place?.id) {
    await supabaseAdmin
      .from("venues")
      .update({
        photo_url: null,
        photo_source: "storefront_unavailable",
        enriched_at: new Date().toISOString(),
      })
      .eq("id", venue.id);

    return { venue: venue.name, status: "no_verified_business_match" };
  }

  const storefrontAvailable = await hasOutdoorStreetView(
    placeLocation(place, venue),
    apiKey
  );
  const update = {
    google_place_id: place.id,
    address: place.formattedAddress || venue.address || null,
    lat: Number(place.location?.latitude ?? venue.lat) || null,
    lng: Number(place.location?.longitude ?? venue.lng) || null,
    photo_url: storefrontAvailable
      ? `/api/venue-photo?placeId=${encodeURIComponent(place.id)}`
      : null,
    photo_source: storefrontAvailable
      ? "google_streetview"
      : "storefront_unavailable",
    google_rating: place.rating ?? venue.google_rating ?? null,
    hours: place.regularOpeningHours ?? venue.hours ?? null,
    phone:
      place.nationalPhoneNumber ||
      place.internationalPhoneNumber ||
      venue.phone ||
      null,
    website: place.websiteUri || venue.website || null,
    google_types: place.types || venue.google_types || [],
    enriched_at: new Date().toISOString(),
  };
  const { error } = await supabaseAdmin
    .from("venues")
    .update(update)
    .eq("id", venue.id);

  return {
    venue: venue.name,
    status: error
      ? "update_failed"
      : storefrontAvailable
        ? "storefront_verified"
        : "street_view_unavailable",
    error: error?.message || null,
  };
}

export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const apiKey =
    process.env.GOOGLE_STREET_VIEW_API_KEY ||
    process.env.GOOGLE_PLACES_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { success: false, error: "Missing Google Maps API key" },
      { status: 500 }
    );
  }

  const url = new URL(request.url);
  const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit") || 75)));
  const retryUnavailable = url.searchParams.get("retry") === "1";
  const venueId = url.searchParams.get("venueId");
  let query = supabaseAdmin
    .from("venues")
    .select("id,name,city,address,lat,lng,google_place_id,photo_source,google_rating,hours,phone,website,google_types,enriched_at")
    .order("enriched_at", { ascending: true, nullsFirst: true })
    .limit(limit);

  if (venueId) {
    query = query.eq("id", venueId);
  } else if (retryUnavailable) {
    query = query.eq("photo_source", "storefront_unavailable");
  }

  const { data: venues, error } = await query;

  if (error) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }

  const results: Array<Awaited<ReturnType<typeof refreshVenue>>> = [];
  const batchSize = 5;

  for (let index = 0; index < (venues || []).length; index += batchSize) {
    const batch = (venues || []).slice(index, index + batchSize) as VenueRow[];
    results.push(
      ...(await Promise.all(batch.map((venue) => refreshVenue(venue, apiKey))))
    );
  }

  return NextResponse.json(
    {
      success: true,
      processed: results.length,
      verified: results.filter((result) => result.status === "storefront_verified").length,
      unavailable: results.filter((result) =>
        ["no_verified_business_match", "street_view_unavailable"].includes(result.status)
      ).length,
      failed: results.filter((result) => result.status === "update_failed").length,
      results,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
