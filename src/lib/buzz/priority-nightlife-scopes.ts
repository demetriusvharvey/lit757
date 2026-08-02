import { nearestActivityDistrict } from "./districts";

export type PriorityNightlifeScope = {
  id: "virginia-beach-oceanfront" | "downtown-norfolk" | "portsmouth-city";
  name: string;
  definition: string;
};

export type VenueLocation = {
  city?: string | null;
  lat?: number | string | null;
  lng?: number | string | null;
};

export const PRIORITY_NIGHTLIFE_SCOPES: PriorityNightlifeScope[] = [
  {
    id: "virginia-beach-oceanfront",
    name: "Virginia Beach Oceanfront",
    definition: "Nearest Buzz activity district: Virginia Beach Oceanfront (1.8-mile district radius).",
  },
  {
    id: "downtown-norfolk",
    name: "Downtown Norfolk & Waterside",
    definition: "Nearest Buzz activity district: Downtown Norfolk & Waterside (1.3-mile district radius).",
  },
  {
    id: "portsmouth-city",
    name: "Portsmouth",
    definition: "Venue city is Portsmouth, plus city-untagged points whose nearest Buzz district is Olde Towne Portsmouth.",
  },
];

function normalizedCity(value: unknown) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z]/g, "");
}

function coordinate(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed !== 0 ? parsed : null;
}

/**
 * Assigns one location to Buzz's priority coverage scopes without relying on
 * radius alone. This matters across the Elizabeth River, where Downtown
 * Norfolk and Olde Towne Portsmouth activity radii overlap.
 */
export function priorityNightlifeScopeIds(location: VenueLocation) {
  const latitude = coordinate(location.lat);
  const longitude = coordinate(location.lng);
  const city = String(location.city || "").trim() || null;
  const districtId = latitude !== null && longitude !== null
    ? nearestActivityDistrict(latitude, longitude, city)?.id || null
    : null;
  const scopeIds: PriorityNightlifeScope["id"][] = [];

  if (districtId === "virginia-beach-oceanfront") scopeIds.push("virginia-beach-oceanfront");
  if (districtId === "downtown-norfolk-waterside") scopeIds.push("downtown-norfolk");
  if (
    normalizedCity(city) === "portsmouth"
    || (!city && districtId === "olde-towne-portsmouth")
  ) {
    scopeIds.push("portsmouth-city");
  }

  return scopeIds;
}
