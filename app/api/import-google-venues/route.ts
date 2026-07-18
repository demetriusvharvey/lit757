/* eslint-disable @typescript-eslint/no-explicit-any -- Google Places payloads are normalized at runtime. */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const GOOGLE_KEY = process.env.GOOGLE_PLACES_API_KEY;

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const DEFAULT_SEARCHES = [
  "Norfolk VA bars",
  "Norfolk VA lounges",
  "Norfolk VA live music venues",
  "Norfolk VA restaurants",
  "Norfolk VA breweries",

  "Virginia Beach VA bars",
  "Virginia Beach VA clubs",
  "Virginia Beach VA hookah lounges",
  "Virginia Beach VA restaurants",
  "Virginia Beach VA live music venues",

  "Chesapeake VA restaurants",
  "Chesapeake VA bars",
  "Chesapeake VA breweries",

  "Portsmouth VA bars",
  "Portsmouth VA restaurants",
  "Portsmouth VA live music",

  "Hampton VA nightlife",
  "Hampton VA restaurants",
  "Hampton VA bars",

  "Newport News VA restaurants",
  "Newport News VA bars",
  "Newport News VA live music",

  "Suffolk VA breweries",
  "Suffolk VA restaurants",
  "Suffolk VA bars",
];

function cityFromQuery(query: string) {
  if (query.includes("Norfolk")) return "Norfolk";
  if (query.includes("Virginia Beach")) return "Virginia Beach";
  if (query.includes("Chesapeake")) return "Chesapeake";
  if (query.includes("Portsmouth")) return "Portsmouth";
  if (query.includes("Hampton")) return "Hampton";
  if (query.includes("Newport News")) return "Newport News";
  if (query.includes("Suffolk")) return "Suffolk";

  return "757";
}

function categoryFromQuery(query: string) {
  const q = query.toLowerCase();

  if (q.includes("hookah")) return "Hookah";
  if (q.includes("club")) return "Club";
  if (q.includes("lounge")) return "Lounge";
  if (q.includes("bar")) return "Bar";
  if (q.includes("brewery")) return "Brewery";
  if (q.includes("restaurant")) return "Restaurant";
  if (q.includes("live music")) return "Live Music";
  if (q.includes("nightlife")) return "Nightlife";

  return "Venue";
}

function cityFromAddress(address: string | null | undefined, fallback: string) {
  const match = String(address || "").match(
    /,\s*(Norfolk|Virginia Beach|Chesapeake|Portsmouth|Suffolk|Hampton|Newport News)\s*,\s*VA\b/i
  );

  if (!match?.[1]) return fallback;

  return match[1]
    .toLowerCase()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

async function getPlaceDetails(placeId: string) {
  const detailsRes = await fetch(
    `https://places.googleapis.com/v1/places/${placeId}`,
    {
      headers: {
        "X-Goog-Api-Key": GOOGLE_KEY!,
        "X-Goog-FieldMask":
          "id,displayName,formattedAddress,location,nationalPhoneNumber,internationalPhoneNumber,websiteUri,rating,regularOpeningHours,photos,types,primaryType",
      },
    }
  );

  return detailsRes.json();
}

export async function GET() {
  try {
    if (!GOOGLE_KEY) {
      return NextResponse.json(
        { error: "Missing GOOGLE_PLACES_API_KEY" },
        { status: 500 }
      );
    }

    const results: any[] = [];

    for (const searchText of DEFAULT_SEARCHES) {
      const city = cityFromQuery(searchText);
      const category = categoryFromQuery(searchText);

      const searchRes = await fetch(
        "https://places.googleapis.com/v1/places:searchText",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": GOOGLE_KEY,
            "X-Goog-FieldMask":
              "places.id,places.displayName,places.formattedAddress,places.location,places.types,places.primaryType",
          },
          body: JSON.stringify({
            textQuery: searchText,
            maxResultCount: 20,
          }),
        }
      );

      const searchJson = await searchRes.json();
      const places = searchJson.places || [];

      for (const place of places) {
        if (!place.id) continue;

        const { data: existingByGoogleId } = await supabaseAdmin
          .from("venues")
          .select("id,name")
          .eq("google_place_id", place.id)
          .maybeSingle();

        if (existingByGoogleId) {
          results.push({
            search: searchText,
            venue: existingByGoogleId.name,
            status: "already_exists",
          });

          continue;
        }

        const details = await getPlaceDetails(place.id);
        const resolvedCity = cityFromAddress(
          details.formattedAddress || place.formattedAddress,
          city
        );

        const name =
          details.displayName?.text || place.displayName?.text;

        const lat =
          details.location?.latitude ||
          place.location?.latitude;

        const lng =
          details.location?.longitude ||
          place.location?.longitude;

        if (!name || !lat || !lng) {
          results.push({
            search: searchText,
            status: "skipped_missing_name_or_location",
          });

          continue;
        }

        const resolvedPlaceId = details.id || place.id;
        const photoUrl = details.photos?.length && resolvedPlaceId
          ? `/api/venue-photo?placeId=${encodeURIComponent(resolvedPlaceId)}&slot=0`
          : null;

        const { data: existingByName } = await supabaseAdmin
          .from("venues")
          .select("id,name")
          .ilike("name", name)
          .eq("city", resolvedCity)
          .maybeSingle();

        if (existingByName) {
          results.push({
            search: searchText,
            venue: name,
            status: "duplicate_name_city",
          });

          continue;
        }

        const { error: insertError } =
          await supabaseAdmin.from("venues").insert({
            name,
            city: resolvedCity,
            address:
              details.formattedAddress ||
              place.formattedAddress ||
              null,

            lat,
            lng,

            category,
            type: category,

            google_place_id: resolvedPlaceId,

            phone:
              details.nationalPhoneNumber ||
              details.internationalPhoneNumber ||
              null,

            website: details.websiteUri || null,

            google_rating:
              details.rating || null,

            hours:
              details.regularOpeningHours || null,

            google_types:
              details.types || [],

            photo_url: photoUrl,

            photo_source:
              photoUrl ? "google" : null,

            enriched_at:
              new Date().toISOString(),
          });

        results.push({
          search: searchText,
          venue: name,
          city: resolvedCity,
          category,
          status: insertError ? "error" : "inserted",
          error: insertError?.message || null,
        });
      }
    }

    return NextResponse.json({
      success: true,
      searches: DEFAULT_SEARCHES.length,
      results,

      inserted: results.filter(
        (r) => r.status === "inserted"
      ).length,

      already_exists: results.filter(
        (r) => r.status === "already_exists"
      ).length,

      errors: results.filter(
        (r) => r.status === "error"
      ).length,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: error.message,
      },
      { status: 500 }
    );
  }
}
