import { NextResponse } from "next/server";
import { fetchNwsWeather, HAMPTON_ROADS_WEATHER_POINTS, weatherActivityImpact } from "../../../../src/lib/integrations/nws";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function number(value: string | null) {
  if (value === null || !Number.isFinite(Number(value))) return null;
  return Number(value);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const requested = url.searchParams.get("city")?.trim().toLowerCase();
  const cityPoint = HAMPTON_ROADS_WEATHER_POINTS.find(point => point.city.toLowerCase() === requested || point.id === requested);
  const latitude = number(url.searchParams.get("lat")) ?? cityPoint?.latitude ?? HAMPTON_ROADS_WEATHER_POINTS[0].latitude;
  const longitude = number(url.searchParams.get("lng")) ?? cityPoint?.longitude ?? HAMPTON_ROADS_WEATHER_POINTS[0].longitude;
  if (latitude < 36.3 || latitude > 37.6 || longitude < -77.1 || longitude > -75.5) {
    return NextResponse.json({ success: false, error: "Point must be within Hampton Roads" }, { status: 400 });
  }
  try {
    const weather = await fetchNwsWeather(latitude, longitude);
    return NextResponse.json({
      success: true,
      provider: "National Weather Service",
      city: cityPoint?.city || null,
      ...weather,
      activityImpact: weatherActivityImpact(weather.hourly[0]),
    }, { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } });
  } catch (error) {
    return NextResponse.json({ success: false, provider: "National Weather Service", error: error instanceof Error ? error.message : "Weather request failed" }, { status: 502 });
  }
}
