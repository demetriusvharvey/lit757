export const dynamic = "force-dynamic";
export const maxDuration = 20;

type GooglePlaceDetails = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: {
    latitude?: number;
    longitude?: number;
  };
};

type StreetViewMetadata = {
  status?: string;
  location?: { lat?: number; lng?: number };
};

function isValidPlaceId(value: string) {
  return /^[A-Za-z0-9_-]{10,220}$/.test(value);
}

function streetViewLocation(place: GooglePlaceDetails) {
  if (place.formattedAddress) return place.formattedAddress;

  const latitude = Number(place.location?.latitude);
  const longitude = Number(place.location?.longitude);

  if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
    return `${latitude},${longitude}`;
  }

  return "";
}

function bearingToVenue(
  panorama?: StreetViewMetadata["location"],
  venue?: GooglePlaceDetails["location"]
) {
  const fromLat = Number(panorama?.lat);
  const fromLng = Number(panorama?.lng);
  const toLat = Number(venue?.latitude);
  const toLng = Number(venue?.longitude);
  if (![fromLat, fromLng, toLat, toLng].every(Number.isFinite)) return null;

  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const y = Math.sin(radians(toLng - fromLng)) * Math.cos(radians(toLat));
  const x =
    Math.cos(radians(fromLat)) * Math.sin(radians(toLat)) -
    Math.sin(radians(fromLat)) * Math.cos(radians(toLat)) * Math.cos(radians(toLng - fromLng));
  return (Math.atan2(y, x) * 180) / Math.PI + 360;
}

async function storefrontHeading(
  location: string,
  place: GooglePlaceDetails,
  apiKey: string
) {
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
  if (!response.ok) return null;
  const metadata = (await response.json()) as StreetViewMetadata;
  if (metadata.status !== "OK") return null;
  const bearing = bearingToVenue(metadata.location, place.location);
  return bearing === null ? null : String(Math.round(bearing % 360));
}

export async function GET(request: Request) {
  const apiKey =
    process.env.GOOGLE_STREET_VIEW_API_KEY ||
    process.env.GOOGLE_PLACES_API_KEY;
  const placeId = new URL(request.url).searchParams.get("placeId") || "";

  if (!apiKey || !isValidPlaceId(placeId)) {
    return new Response(null, { status: 404 });
  }

  const detailsResponse = await fetch(
    `https://places.googleapis.com/v1/places/${placeId}`,
    {
      headers: {
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "id,displayName,formattedAddress,location",
      },
      cache: "no-store",
    }
  );

  if (!detailsResponse.ok) {
    return new Response(null, { status: detailsResponse.status });
  }

  const place = (await detailsResponse.json()) as GooglePlaceDetails;
  const location = streetViewLocation(place);

  if (!location) {
    return new Response(null, { status: 404 });
  }

  const heading = await storefrontHeading(location, place, apiKey);

  const params = new URLSearchParams({
    size: "640x420",
    scale: "2",
    location,
    source: "outdoor",
    fov: "75",
    pitch: "2",
    radius: "100",
    return_error_code: "true",
    key: apiKey,
  });
  if (heading) params.set("heading", heading);
  const imageResponse = await fetch(
    `https://maps.googleapis.com/maps/api/streetview?${params.toString()}`,
    { cache: "no-store" }
  );

  if (!imageResponse.ok) {
    return new Response(null, { status: imageResponse.status });
  }

  return new Response(await imageResponse.arrayBuffer(), {
    headers: {
      "Content-Type": imageResponse.headers.get("content-type") || "image/jpeg",
      "Cache-Control": "private, no-store",
      "X-Venue-Photo-Source": "google-street-view",
    },
  });
}
