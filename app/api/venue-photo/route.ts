export const dynamic = "force-dynamic";
export const maxDuration = 20;

type GooglePlacePhoto = {
  name?: string;
  widthPx?: number;
  heightPx?: number;
};

type GooglePlaceDetails = {
  id?: string;
  displayName?: { text?: string };
  location?: { latitude?: number; longitude?: number };
  photos?: GooglePlacePhoto[];
};

type StreetViewMetadata = {
  status?: string;
  pano_id?: string;
  location?: { lat?: number; lng?: number };
  date?: string;
};

function isValidPlaceId(value: string) {
  return /^[A-Za-z0-9_-]{10,220}$/.test(value);
}

function isValidPhotoName(value: string) {
  return /^places\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_-]+$/.test(value);
}

function chooseBestPhoto(photos: GooglePlacePhoto[]) {
  return [...photos]
    .filter(photo => photo.name && isValidPhotoName(photo.name))
    .sort((left, right) => {
      const leftArea = Number(left.widthPx || 0) * Number(left.heightPx || 0);
      const rightArea = Number(right.widthPx || 0) * Number(right.heightPx || 0);
      const leftLandscape = Number(left.widthPx || 0) >= Number(left.heightPx || 0) ? 1 : 0;
      const rightLandscape = Number(right.widthPx || 0) >= Number(right.heightPx || 0) ? 1 : 0;
      return rightLandscape - leftLandscape || rightArea - leftArea;
    })[0];
}

function radians(value: number) {
  return value * Math.PI / 180;
}

function degrees(value: number) {
  return value * 180 / Math.PI;
}

function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number) {
  const dLat = radians(lat2 - lat1);
  const dLng = radians(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function headingTo(fromLat: number, fromLng: number, toLat: number, toLng: number) {
  const from = radians(fromLat);
  const to = radians(toLat);
  const delta = radians(toLng - fromLng);
  const y = Math.sin(delta) * Math.cos(to);
  const x = Math.cos(from) * Math.sin(to) - Math.sin(from) * Math.cos(to) * Math.cos(delta);
  return (degrees(Math.atan2(y, x)) + 360) % 360;
}

async function fetchStorefrontImage(apiKey: string, latitude: number, longitude: number) {
  const metadataUrl = new URL("https://maps.googleapis.com/maps/api/streetview/metadata");
  metadataUrl.searchParams.set("location", `${latitude},${longitude}`);
  metadataUrl.searchParams.set("radius", "90");
  metadataUrl.searchParams.set("source", "outdoor");
  metadataUrl.searchParams.set("key", apiKey);

  const metadataResponse = await fetch(metadataUrl, { next: { revalidate: 2_592_000 } });
  if (!metadataResponse.ok) return null;
  const metadata = await metadataResponse.json() as StreetViewMetadata;
  const panoLat = Number(metadata.location?.lat);
  const panoLng = Number(metadata.location?.lng);
  if (metadata.status !== "OK" || !metadata.pano_id || !Number.isFinite(panoLat) || !Number.isFinite(panoLng)) return null;
  if (distanceMeters(latitude, longitude, panoLat, panoLng) > 90) return null;

  const imageUrl = new URL("https://maps.googleapis.com/maps/api/streetview");
  imageUrl.searchParams.set("size", "1280x720");
  imageUrl.searchParams.set("pano", metadata.pano_id);
  imageUrl.searchParams.set("heading", headingTo(panoLat, panoLng, latitude, longitude).toFixed(1));
  imageUrl.searchParams.set("pitch", "4");
  imageUrl.searchParams.set("fov", "72");
  imageUrl.searchParams.set("return_error_code", "true");
  imageUrl.searchParams.set("key", apiKey);

  const imageResponse = await fetch(imageUrl, { next: { revalidate: 2_592_000 } });
  if (!imageResponse.ok) return null;
  const contentType = imageResponse.headers.get("content-type") || "";
  if (!contentType.startsWith("image/")) return null;
  return { imageResponse, panoramaDate: metadata.date || "" };
}

async function fetchPlacePhoto(apiKey: string, place: GooglePlaceDetails) {
  const photo = chooseBestPhoto(place.photos || []);
  if (!photo?.name) return null;
  const mediaResponse = await fetch(
    `https://places.googleapis.com/v1/${photo.name}/media?maxWidthPx=1280&maxHeightPx=840&skipHttpRedirect=true`,
    { headers: { "X-Goog-Api-Key": apiKey }, next: { revalidate: 604800 } },
  );
  if (!mediaResponse.ok) return null;
  const payload = await mediaResponse.json() as { photoUri?: string };
  if (!payload.photoUri) return null;
  const imageResponse = await fetch(payload.photoUri, { next: { revalidate: 604800 } });
  return imageResponse.ok ? imageResponse : null;
}

export async function GET(request: Request) {
  const placesKey = process.env.GOOGLE_PLACES_API_KEY;
  const streetViewKey = process.env.GOOGLE_STREET_VIEW_API_KEY || placesKey;
  const url = new URL(request.url);
  const placeId = url.searchParams.get("placeId") || "";
  const requestedLat = Number(url.searchParams.get("lat"));
  const requestedLng = Number(url.searchParams.get("lng"));

  if (!placesKey || !isValidPlaceId(placeId)) return new Response(null, { status: 404 });

  const detailsResponse = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
    headers: {
      "X-Goog-Api-Key": placesKey,
      "X-Goog-FieldMask": "id,displayName,location,photos",
    },
    next: { revalidate: 604800 },
  });
  if (!detailsResponse.ok) return new Response(null, { status: detailsResponse.status });

  const place = await detailsResponse.json() as GooglePlaceDetails;
  const latitude = Number.isFinite(requestedLat) ? requestedLat : Number(place.location?.latitude);
  const longitude = Number.isFinite(requestedLng) ? requestedLng : Number(place.location?.longitude);

  if (streetViewKey && Number.isFinite(latitude) && Number.isFinite(longitude)) {
    const storefront = await fetchStorefrontImage(streetViewKey, latitude, longitude);
    if (storefront) {
      return new Response(await storefront.imageResponse.arrayBuffer(), {
        headers: {
          "Content-Type": storefront.imageResponse.headers.get("content-type") || "image/jpeg",
          "Cache-Control": "public, s-maxage=2592000, stale-while-revalidate=7776000",
          "X-Venue-Photo-Source": "google-street-view-storefront",
          "X-Street-View-Date": storefront.panoramaDate,
          "X-Venue-Name": encodeURIComponent(place.displayName?.text || ""),
        },
      });
    }
  }

  const placePhoto = await fetchPlacePhoto(placesKey, place);
  if (!placePhoto) return new Response(null, { status: 404 });
  return new Response(await placePhoto.arrayBuffer(), {
    headers: {
      "Content-Type": placePhoto.headers.get("content-type") || "image/jpeg",
      "Cache-Control": "public, s-maxage=604800, stale-while-revalidate=2592000",
      "X-Venue-Photo-Source": "google-place-photo",
      "X-Venue-Name": encodeURIComponent(place.displayName?.text || ""),
    },
  });
}
