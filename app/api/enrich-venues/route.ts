/* eslint-disable @typescript-eslint/no-explicit-any -- Google Places returns provider-defined JSON fields. */
import { NextResponse } from "next/server";
import { supabase } from "../../../src/lib/supabase";

const GOOGLE_KEY = process.env.GOOGLE_PLACES_API_KEY;

function cityFromAddress(address: string | null | undefined, fallback: string | null) {
  const match = String(address || "").match(
    /,\s*(Norfolk|Virginia Beach|Chesapeake|Portsmouth|Suffolk|Hampton|Newport News)\s*,\s*VA\b/i
  );

  if (!match?.[1]) return fallback;

  return match[1]
    .toLowerCase()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export async function GET() {
  try {
    if (!GOOGLE_KEY) {
      return NextResponse.json(
        { error: "Missing GOOGLE_PLACES_API_KEY" },
        { status: 500 }
      );
    }

    const { data: venues, error } = await supabase
      .from("venues")
      .select("*")
      .is("google_place_id", null)
      .limit(20);

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    const results = [];

    for (const venue of venues || []) {
      try {
        const searchText =
          `${venue.name} ${venue.city || ""} ${venue.address || ""}`.trim();

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
              maxResultCount: 1,
            }),
          }
        );

        const searchJson = await searchRes.json();

        const place = searchJson.places?.[0];

        if (!place?.id) {
          results.push({
            venue: venue.name,
            status: "not_found",
          });

          continue;
        }

        const detailsRes = await fetch(
          `https://places.googleapis.com/v1/places/${place.id}`,
          {
            headers: {
              "X-Goog-Api-Key": GOOGLE_KEY,
              "X-Goog-FieldMask":
                "id,displayName,formattedAddress,nationalPhoneNumber,internationalPhoneNumber,websiteUri,rating,regularOpeningHours,photos,types,primaryType",
            },
          }
        );

        const details = await detailsRes.json();

        const photoUrl = details.photos?.length && details.id
          ? `/api/venue-photo?placeId=${encodeURIComponent(details.id)}&slot=0`
          : null;

        const { error: updateError } = await supabase
          .from("venues")
          .update({
            google_place_id: details.id,
            address:
              details.formattedAddress || venue.address || null,
            city: cityFromAddress(
              details.formattedAddress || venue.address,
              venue.city || null
            ),
            phone:
              details.nationalPhoneNumber ||
              details.internationalPhoneNumber ||
              null,
            website: details.websiteUri || null,
            google_rating: details.rating || null,
            photo_url: photoUrl,
            photo_source: photoUrl ? "google" : null,
            hours: details.regularOpeningHours || null,
            google_types: details.types || [],
            enriched_at: new Date().toISOString(),
          })
          .eq("id", venue.id);

        results.push({
          venue: venue.name,
          google_place_id: details.id,
          status: updateError ? "error" : "updated",
          error: updateError?.message || null,
        });
      } catch (venueError: any) {
        results.push({
          venue: venue.name,
          status: "error",
          error: venueError.message,
        });
      }
    }

    return NextResponse.json({
      success: true,
      enriched: results.length,
      results,
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        error: err.message,
      },
      { status: 500 }
    );
  }
}
