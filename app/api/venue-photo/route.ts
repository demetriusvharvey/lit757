export const dynamic = "force-dynamic";
export const maxDuration = 20;

type GooglePlacePhoto = {
  name?: string;
  widthPx?: number;
  heightPx?: number;
  authorAttributions?: Array<{ displayName?: string; uri?: string }>;
};

type GooglePlaceDetails = {
  id?: string;
  displayName?: { text?: string };
  photos?: GooglePlacePhoto[];
};

function isValidPlaceId(value: string) {
  return /^[A-Za-z0-9_-]{10,220}$/.test(value);
}

function isValidPhotoName(value: string) {
  return /^places\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_-]+$/.test(value);
}

function chooseBestPhoto(photos: GooglePlacePhoto[]) {
  return [...photos]
    .filter((photo) => photo.name && isValidPhotoName(photo.name))
    .sort((left, right) => {
      const leftArea = Number(left.widthPx || 0) * Number(left.heightPx || 0);
      const rightArea = Number(right.widthPx || 0) * Number(right.heightPx || 0);
      return rightArea - leftArea;
    })[0];
}

export async function GET(request: Request) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  const placeId = new URL(request.url).searchParams.get("placeId") || "";

  if (!apiKey || !isValidPlaceId(placeId)) {
    return new Response(null, { status: 404 });
  }

  const detailsResponse = await fetch(
    `https://places.googleapis.com/v1/places/${placeId}`,
    {
      headers: {
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "id,displayName,photos",
      },
      next: { revalidate: 86400 },
    }
  );

  if (!detailsResponse.ok) {
    return new Response(null, { status: detailsResponse.status });
  }

  const place = (await detailsResponse.json()) as GooglePlaceDetails;
  const photo = chooseBestPhoto(place.photos || []);

  // No Street View fallback: an empty branded placeholder is more trustworthy
  // than showing a nearby road, parking lot, or unrelated building.
  if (!photo?.name) {
    return new Response(null, { status: 404 });
  }

  const photoResponse = await fetch(
    `https://places.googleapis.com/v1/${photo.name}/media?maxWidthPx=1280&maxHeightPx=840&skipHttpRedirect=true`,
    {
      headers: { "X-Goog-Api-Key": apiKey },
      next: { revalidate: 86400 },
    }
  );

  if (!photoResponse.ok) {
    return new Response(null, { status: photoResponse.status });
  }

  const payload = (await photoResponse.json()) as { photoUri?: string };
  if (!payload.photoUri) {
    return new Response(null, { status: 404 });
  }

  const imageResponse = await fetch(payload.photoUri, {
    next: { revalidate: 86400 },
  });

  if (!imageResponse.ok) {
    return new Response(null, { status: imageResponse.status });
  }

  return new Response(await imageResponse.arrayBuffer(), {
    headers: {
      "Content-Type": imageResponse.headers.get("content-type") || "image/jpeg",
      "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800",
      "X-Venue-Photo-Source": "google-place-photo",
      "X-Venue-Name": encodeURIComponent(place.displayName?.text || ""),
    },
  });
}
