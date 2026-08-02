import { NextResponse } from "next/server";
import { meteredProviderCallsEnabled } from "../../../src/lib/metered-providers";

export const dynamic = "force-dynamic";

type GooglePlaceDetails = {
  id?: string;
  formattedAddress?: string;
  location?: {
    latitude?: number;
    longitude?: number;
  };
  googleMapsUri?: string;
};

function isValidPlaceId(value: string) {
  return /^[A-Za-z0-9_-]{10,220}$/.test(value);
}

export async function GET(request: Request) {
  const placeId = new URL(request.url).searchParams.get("placeId") || "";

  if (!meteredProviderCallsEnabled("google_places")) {
    return NextResponse.json(
      { photos: [], disabled: true, reason: "zero_cost_policy" },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { photos: [], error: "Photo service unavailable" },
      { status: 503 }
    );
  }

  if (!isValidPlaceId(placeId)) {
    return NextResponse.json(
      { photos: [], error: "Invalid place" },
      { status: 400 }
    );
  }

  const response = await fetch(
    `https://places.googleapis.com/v1/places/${placeId}`,
    {
      headers: {
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "id,formattedAddress,location,googleMapsUri",
      },
      cache: "no-store",
    }
  );

  if (!response.ok) {
    return NextResponse.json({ photos: [] }, { status: response.status });
  }

  const place = (await response.json()) as GooglePlaceDetails;
  const hasLocation =
    Boolean(place.formattedAddress) ||
    (Number.isFinite(Number(place.location?.latitude)) &&
      Number.isFinite(Number(place.location?.longitude)));

  if (!hasLocation) {
    return NextResponse.json(
      { photos: [] },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  }

  return NextResponse.json(
    {
      photos: [
        {
          id: `${placeId}-storefront`,
          url: `/api/venue-photo?placeId=${encodeURIComponent(placeId)}`,
          width: 1280,
          height: 840,
          attribution: "Google Street View",
          attributionUrl: place.googleMapsUri || null,
          source: "Google Street View",
        },
      ],
    },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
