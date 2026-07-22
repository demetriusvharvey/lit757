import { NextResponse } from "next/server";
import {
  fetchCoastalConditions,
  HAMPTON_ROADS_COASTAL_STATIONS,
} from "../../../../src/lib/integrations/noaa-coops";

export const dynamic = "force-dynamic";
export const maxDuration = 45;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const requested = url.searchParams.get("station")?.trim().toLowerCase()
    || url.searchParams.get("city")?.trim().toLowerCase()
    || "virginia-beach";
  const station = HAMPTON_ROADS_COASTAL_STATIONS.find(item => (
    item.id === requested
    || item.stationId === requested
    || item.city.toLowerCase() === requested
  ));

  if (!station) {
    return NextResponse.json({
      success: false,
      provider: "NOAA CO-OPS",
      error: "Unknown Hampton Roads coastal station",
      availableStations: HAMPTON_ROADS_COASTAL_STATIONS.map(item => ({
        id: item.id,
        stationId: item.stationId,
        name: item.name,
        city: item.city,
      })),
    }, { status: 400 });
  }

  try {
    const conditions = await fetchCoastalConditions(station);
    return NextResponse.json({
      success: conditions.availability.predictions
        || conditions.availability.waterLevel
        || conditions.availability.wind
        || conditions.availability.waterTemperature,
      ...conditions,
      truthNote: "Coastal observations qualify beach and outdoor recommendations. They do not prove venue occupancy or make a venue Live.",
    }, {
      status: conditions.availability.predictions
        || conditions.availability.waterLevel
        || conditions.availability.wind
        || conditions.availability.waterTemperature ? 200 : 502,
      headers: { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=1800" },
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      provider: "NOAA CO-OPS",
      station,
      error: error instanceof Error ? error.message : "NOAA coastal request failed",
    }, { status: 502 });
  }
}
