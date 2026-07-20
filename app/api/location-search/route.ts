import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type MapboxFeature = {
  id?: string;
  bbox?: number[];
  geometry?: { coordinates?: number[] };
  properties?: {
    name?: string;
    name_preferred?: string;
    full_address?: string;
    place_formatted?: string;
    feature_type?: string;
    coordinates?: { longitude?: number; latitude?: number };
    bbox?: number[];
  };
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") || "").trim();
  if (query.length < 2) return NextResponse.json({ success: true, results: [] });

  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!token) return NextResponse.json({ success: false, error: "Location search is not configured", results: [] }, { status: 503 });

  const endpoint = new URL("https://api.mapbox.com/search/geocode/v6/forward");
  endpoint.searchParams.set("q", query);
  endpoint.searchParams.set("country", "US");
  endpoint.searchParams.set("limit", "8");
  endpoint.searchParams.set("types", "postcode,place,locality,neighborhood,address,poi");
  endpoint.searchParams.set("autocomplete", "true");
  endpoint.searchParams.set("access_token", token);

  const response = await fetch(endpoint, { cache: "no-store" });
  if (!response.ok) return NextResponse.json({ success: false, error: "Location search is temporarily unavailable", results: [] }, { status: 502 });

  const payload = await response.json() as { features?: MapboxFeature[] };
  const results = (payload.features || []).flatMap((feature) => {
    const longitude = Number(feature.properties?.coordinates?.longitude ?? feature.geometry?.coordinates?.[0]);
    const latitude = Number(feature.properties?.coordinates?.latitude ?? feature.geometry?.coordinates?.[1]);
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return [];
    const name = feature.properties?.name_preferred || feature.properties?.name || "Location";
    const detail = feature.properties?.full_address || feature.properties?.place_formatted || name;
    const bbox = feature.properties?.bbox || feature.bbox || null;
    return [{
      id: feature.id || `${longitude}:${latitude}`,
      name,
      detail,
      featureType: feature.properties?.feature_type || "place",
      longitude,
      latitude,
      bbox: Array.isArray(bbox) && bbox.length === 4 ? bbox : null,
    }];
  });

  return NextResponse.json({ success: true, results }, { headers: { "Cache-Control": "private, max-age=60" } });
}
