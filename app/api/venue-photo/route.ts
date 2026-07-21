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
  photos?: GooglePlacePhoto[];
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
  const landscape = ratio >= 1.15 && ratio <= 2.4 ? 1 : 0;
  const cardRatio = 1 - Math.min(1, Math.abs(ratio - 1.55) / 1.55);
  const resolution = Math.min(1, (width * height) / 2_000_000);
  return landscape * 100 + cardRatio * 30 + resolution * 20;
}

function chooseBestPhoto(photos: GooglePlacePhoto[]) {
  return [...photos]
    .filter(photo => photo.name && isValidPhotoName(photo.name))
    .sort((left, right) => photoScore(right) - photoScore(left))[0];
}

function escapeXml(value: string) {
  return value.replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;",
  }[character] || character));
}

function fallbackImage(name: string, category: string, reason = "fallback") {
  const selected = FALLBACKS[category] || FALLBACKS.other;
  const safeName = escapeXml(name || selected.label);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#10151d"/><stop offset="1" stop-color="#281d3e"/></linearGradient><radialGradient id="r" cx="80%" cy="15%" r="65%"><stop stop-color="#8b5cf6" stop-opacity=".38"/><stop offset="1" stop-color="#8b5cf6" stop-opacity="0"/></radialGradient></defs><rect width="1280" height="720" fill="url(#g)"/><rect width="1280" height="720" fill="url(#r)"/><text x="90" y="250" fill="#b9a4ff" font-size="96" font-family="Arial, sans-serif">${selected.glyph}</text><text x="90" y="390" fill="#fff" font-size="54" font-weight="700" font-family="Arial, sans-serif">${safeName}</text><text x="90" y="455" fill="#aab0bd" font-size="28" font-family="Arial, sans-serif">${selected.label}</text><text x="90" y="620" fill="#817e8b" font-size="21" font-family="Arial, sans-serif">BUZZ · VERIFIED PHOTO COMING SOON</text></svg>`;
  return new Response(svg, {
    status: 200,
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
      "X-Venue-Photo-Source": "buzz-verified-fallback",
      "X-Venue-Photo-Reason": encodeURIComponent(reason.slice(0, 120)),
    },
  });
}

async function fetchVerifiedPlacePhoto(apiKey: string, placeId: string) {
  const detailsResponse = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
    headers: {
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "id,displayName,photos",
    },
    next: { revalidate: 604800 },
    signal: AbortSignal.timeout(8_000),
  });
  if (!detailsResponse.ok) {
    return { image: null as Response | null, place: null as GooglePlaceDetails | null, reason: `place-details-${detailsResponse.status}` };
  }

  const place = await detailsResponse.json() as GooglePlaceDetails;
  const photo = chooseBestPhoto(place.photos || []);
  if (!photo?.name) return { image: null, place, reason: "no-place-photo" };

  const mediaResponse = await fetch(
    `https://places.googleapis.com/v1/${photo.name}/media?maxWidthPx=1280&maxHeightPx=840&skipHttpRedirect=true`,
    {
      headers: { "X-Goog-Api-Key": apiKey },
      next: { revalidate: 604800 },
      signal: AbortSignal.timeout(8_000),
    },
  );
  if (!mediaResponse.ok) return { image: null, place, reason: `photo-media-${mediaResponse.status}` };

  const payload = await mediaResponse.json() as { photoUri?: string };
  if (!payload.photoUri) return { image: null, place, reason: "photo-uri-missing" };

  const imageResponse = await fetch(payload.photoUri, {
    next: { revalidate: 604800 },
    signal: AbortSignal.timeout(10_000),
  });
  const contentType = imageResponse.headers.get("content-type") || "";
  if (!imageResponse.ok || !contentType.startsWith("image/")) {
    return { image: null, place, reason: `photo-download-${imageResponse.status}` };
  }

  return { image: imageResponse, place, reason: null as string | null };
}

export async function GET(request: Request) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  const url = new URL(request.url);
  const placeId = url.searchParams.get("placeId") || "";
  const name = url.searchParams.get("name") || "Local place";
  const category = (url.searchParams.get("category") || "other").toLowerCase();

  if (!apiKey) return fallbackImage(name, category, "google-places-key-missing");
  if (!isValidPlaceId(placeId)) return fallbackImage(name, category, "google-place-id-missing-or-invalid");

  try {
    const result = await fetchVerifiedPlacePhoto(apiKey, placeId);
    if (!result.image) {
      return fallbackImage(result.place?.displayName?.text || name, category, result.reason || "no-verified-google-image");
    }

    return new Response(result.image.body, {
      status: 200,
      headers: {
        "Content-Type": result.image.headers.get("content-type") || "image/jpeg",
        "Cache-Control": "public, s-maxage=604800, stale-while-revalidate=2592000",
        "X-Venue-Photo-Source": "google-place-photo-verified",
        "X-Venue-Name": encodeURIComponent(result.place?.displayName?.text || name),
      },
    });
  } catch (error) {
    return fallbackImage(name, category, error instanceof Error ? error.message : "google-provider-error");
  }
}
