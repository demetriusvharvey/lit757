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

type PanoramaCandidate = {
  panoId: string;
  lat: number;
  lng: number;
  date: string;
  distance: number;
};

const FALLBACKS: Record<string, { label: string; glyph: string }> = {
  food: { label: "Food & dining", glyph: "🍽" },
  nightlife: { label: "Drinks & nightlife", glyph: "♪" },
  events: { label: "Events", glyph: "✦" },
  activity: { label: "Local activity", glyph: "◉" },
  outdoors: { label: "Outdoors", glyph: "⌁" },
  shopping: { label: "Shopping", glyph: "◇" },
  other: { label: "Local place", glyph: "●" },
};

function isValidPlaceId(value: string) {
  return /^[A-Za-z0-9_-]{10,220}$/.test(value);
}

function isValidPhotoName(value: string) {
  return /^places\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_-]+$/.test(value);
}

function photoScore(photo: GooglePlacePhoto) {
  const width = Number(photo.widthPx || 0);
  const height = Number(photo.heightPx || 0);
  if (!width || !height) return 0;
  const ratio = width / height;
  const landscape = ratio >= 1.25 && ratio <= 2.2 ? 1 : 0;
  const cardRatio = 1 - Math.min(1, Math.abs(ratio - 1.55) / 1.55);
  const resolution = Math.min(1, (width * height) / 2_000_000);
  return landscape * 100 + cardRatio * 30 + resolution * 20;
}

function chooseBestPhoto(photos: GooglePlacePhoto[]) {
  return [...photos]
    .filter(photo => photo.name && isValidPhotoName(photo.name))
    .sort((left, right) => photoScore(right) - photoScore(left))[0];
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

function searchPoints(latitude: number, longitude: number) {
  const latStep = 24 / 111_320;
  const lngStep = 24 / (111_320 * Math.max(0.2, Math.cos(radians(latitude))));
  return [
    [latitude, longitude],
    [latitude + latStep, longitude],
    [latitude - latStep, longitude],
    [latitude, longitude + lngStep],
    [latitude, longitude - lngStep],
  ] as const;
}

async function findPanorama(apiKey: string, latitude: number, longitude: number) {
  const results = await Promise.all(searchPoints(latitude, longitude).map(async ([lat, lng]) => {
    const metadataUrl = new URL("https://maps.googleapis.com/maps/api/streetview/metadata");
    metadataUrl.searchParams.set("location", `${lat},${lng}`);
    metadataUrl.searchParams.set("radius", "70");
    metadataUrl.searchParams.set("source", "outdoor");
    metadataUrl.searchParams.set("key", apiKey);
    const response = await fetch(metadataUrl, { next: { revalidate: 2_592_000 } });
    if (!response.ok) return null;
    const metadata = await response.json() as StreetViewMetadata;
    const panoLat = Number(metadata.location?.lat);
    const panoLng = Number(metadata.location?.lng);
    if (metadata.status !== "OK" || !metadata.pano_id || !Number.isFinite(panoLat) || !Number.isFinite(panoLng)) return null;
    const distance = distanceMeters(latitude, longitude, panoLat, panoLng);
    if (distance < 4 || distance > 95) return null;
    return { panoId: metadata.pano_id, lat: panoLat, lng: panoLng, date: metadata.date || "", distance } satisfies PanoramaCandidate;
  }));

  const unique = new Map<string, PanoramaCandidate>();
  for (const result of results) {
    if (!result) continue;
    const current = unique.get(result.panoId);
    if (!current || result.distance < current.distance) unique.set(result.panoId, result);
  }
  return [...unique.values()].sort((left, right) => {
    const leftIdeal = Math.abs(left.distance - 28);
    const rightIdeal = Math.abs(right.distance - 28);
    return leftIdeal - rightIdeal || left.distance - right.distance;
  })[0] || null;
}

async function fetchStorefrontImage(apiKey: string, latitude: number, longitude: number) {
  const panorama = await findPanorama(apiKey, latitude, longitude);
  if (!panorama) return null;
  const imageUrl = new URL("https://maps.googleapis.com/maps/api/streetview");
  imageUrl.searchParams.set("size", "1280x720");
  imageUrl.searchParams.set("pano", panorama.panoId);
  imageUrl.searchParams.set("heading", headingTo(panorama.lat, panorama.lng, latitude, longitude).toFixed(1));
  imageUrl.searchParams.set("pitch", "3");
  imageUrl.searchParams.set("fov", panorama.distance < 18 ? "82" : panorama.distance > 55 ? "58" : "68");
  imageUrl.searchParams.set("return_error_code", "true");
  imageUrl.searchParams.set("key", apiKey);
  const imageResponse = await fetch(imageUrl, { next: { revalidate: 2_592_000 } });
  if (!imageResponse.ok || !(imageResponse.headers.get("content-type") || "").startsWith("image/")) return null;
  return { imageResponse, panorama };
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

function escapeXml(value: string) {
  return value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[character] || character));
}

function fallbackImage(name: string, category: string) {
  const selected = FALLBACKS[category] || FALLBACKS.other;
  const safeName = escapeXml(name || selected.label);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#151821"/><stop offset="1" stop-color="#292235"/></linearGradient><radialGradient id="r"><stop stop-color="#8b5cf6" stop-opacity=".28"/><stop offset="1" stop-color="#8b5cf6" stop-opacity="0"/></radialGradient></defs><rect width="1280" height="720" fill="url(#g)"/><circle cx="1000" cy="80" r="500" fill="url(#r)"/><text x="90" y="250" fill="#b9a4ff" font-size="96" font-family="Arial, sans-serif">${selected.glyph}</text><text x="90" y="390" fill="#fff" font-size="54" font-weight="700" font-family="Arial, sans-serif">${safeName}</text><text x="90" y="455" fill="#aab0bd" font-size="28" font-family="Arial, sans-serif">${selected.label}</text><text x="90" y="620" fill="#817e8b" font-size="21" font-family="Arial, sans-serif">BUZZ · PHOTO COMING SOON</text></svg>`;
  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800",
      "X-Venue-Photo-Source": "buzz-category-fallback",
    },
  });
}

export async function GET(request: Request) {
  const placesKey = process.env.GOOGLE_PLACES_API_KEY;
  const streetViewKey = process.env.GOOGLE_STREET_VIEW_API_KEY || placesKey;
  const url = new URL(request.url);
  const placeId = url.searchParams.get("placeId") || "";
  const name = url.searchParams.get("name") || "Local place";
  const category = (url.searchParams.get("category") || "other").toLowerCase();
  const requestedLat = Number(url.searchParams.get("lat"));
  const requestedLng = Number(url.searchParams.get("lng"));

  if (!placesKey || !isValidPlaceId(placeId)) return fallbackImage(name, category);

  const detailsResponse = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
    headers: { "X-Goog-Api-Key": placesKey, "X-Goog-FieldMask": "id,displayName,location,photos" },
    next: { revalidate: 604800 },
  });
  if (!detailsResponse.ok) return fallbackImage(name, category);

  const place = await detailsResponse.json() as GooglePlaceDetails;
  const placeLat = Number(place.location?.latitude);
  const placeLng = Number(place.location?.longitude);
  const latitude = Number.isFinite(placeLat) ? placeLat : requestedLat;
  const longitude = Number.isFinite(placeLng) ? placeLng : requestedLng;

  if (streetViewKey && Number.isFinite(latitude) && Number.isFinite(longitude)) {
    const storefront = await fetchStorefrontImage(streetViewKey, latitude, longitude);
    if (storefront) {
      return new Response(await storefront.imageResponse.arrayBuffer(), {
        headers: {
          "Content-Type": storefront.imageResponse.headers.get("content-type") || "image/jpeg",
          "Cache-Control": "public, s-maxage=2592000, stale-while-revalidate=7776000",
          "X-Venue-Photo-Source": "google-street-view-storefront",
          "X-Street-View-Date": storefront.panorama.date,
          "X-Street-View-Distance": storefront.panorama.distance.toFixed(1),
          "X-Venue-Name": encodeURIComponent(place.displayName?.text || name),
        },
      });
    }
  }

  const placePhoto = await fetchPlacePhoto(placesKey, place);
  if (!placePhoto) return fallbackImage(place.displayName?.text || name, category);
  return new Response(await placePhoto.arrayBuffer(), {
    headers: {
      "Content-Type": placePhoto.headers.get("content-type") || "image/jpeg",
      "Cache-Control": "public, s-maxage=604800, stale-while-revalidate=2592000",
      "X-Venue-Photo-Source": "google-place-photo-ranked",
      "X-Venue-Name": encodeURIComponent(place.displayName?.text || name),
    },
  });
}
