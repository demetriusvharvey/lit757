import { distanceMiles, normalizeVenueName, venueNameSimilarity } from "./integrations/osm";
import type { PriorityNightlifeScope } from "./buzz/priority-nightlife-scopes";

export type VerifiedNightlifeVenue = {
  id: string;
  name: string;
  city: string;
  address: string;
  lat: number;
  lng: number;
  category: string;
  type: string;
  phone: string;
  website: string;
  scopeId: PriorityNightlifeScope["id"];
  officialSourceUrl: string;
  supportingSourceUrl: string;
};

export type ExistingVenueForImport = {
  id: string;
  name: string;
  city?: string | null;
  lat?: number | string | null;
  lng?: number | string | null;
};

export const VERIFIED_NIGHTLIFE_IMPORT = {
  batchId: "priority-nightlife-wave-5-2026-08-02",
  verifiedAt: "2026-08-02T15:38:42.000Z",
  backup: {
    generatedAt: "2026-08-02T15:37:28.271Z",
    sha256: "798bbcb2c05d329a591b5243792ec382763af328f142c15090fa790519048bbd",
    runUrl: "https://github.com/demetriusvharvey/lit757/actions/runs/30754758179",
  },
  venues: [
    {
      id: "f7d5714c-67e9-4713-8148-7d3ac958dac9",
      name: "Beach Pub",
      city: "Virginia Beach",
      address: "1001 Laskin Road, Virginia Beach, VA 23451",
      lat: 36.8573775,
      lng: -75.9913957,
      category: "Bars",
      type: "Pub / Restaurant",
      phone: "(757) 422-8817",
      website: "https://beachpubvb.com/",
      scopeId: "virginia-beach-oceanfront",
      officialSourceUrl: "https://beachpubvb.com/",
      supportingSourceUrl: "https://www.openstreetmap.org/way/402387223",
    },
    {
      id: "798bde16-8727-4867-916b-12ea8ed1b73f",
      name: "Abbey Road Pub & Restaurant",
      city: "Virginia Beach",
      address: "203 22nd Street, Virginia Beach, VA 23451",
      lat: 36.8502893,
      lng: -75.976001,
      category: "Bars",
      type: "Pub / Live Music",
      phone: "(757) 425-6330",
      website: "https://abbeyroadpub.com/",
      scopeId: "virginia-beach-oceanfront",
      officialSourceUrl: "https://abbeyroadpub.com/about-abbey-road/",
      supportingSourceUrl: "https://www.openstreetmap.org/node/4025117504",
    },
    {
      id: "5b193b81-df95-4e94-81cc-05ef7cf9725b",
      name: "Chicho's 11th Street Taphouse",
      city: "Virginia Beach",
      address: "1011 Atlantic Avenue, Virginia Beach, VA 23451",
      lat: 36.8395259,
      lng: -75.9720398,
      category: "Bars",
      type: "Taphouse / Bar",
      phone: "(757) 321-8354",
      website: "https://chichospizza.com/11th-street/",
      scopeId: "virginia-beach-oceanfront",
      officialSourceUrl: "https://chichospizza.com/11th-street/",
      supportingSourceUrl: "https://www.openstreetmap.org/node/1857210264",
    },
    {
      id: "d05d215d-097f-4ecf-be8c-dde2df8c2f6f",
      name: "Canvas Social Cuisine",
      city: "Norfolk",
      address: "411 Granby Street, Norfolk, VA 23510",
      lat: 36.8514774,
      lng: -76.2897883,
      category: "Bars",
      type: "Restaurant / Nightclub",
      phone: "(757) 937-6220",
      website: "https://www.downtownnorfolk.org/go/canvas-social-cuisine",
      scopeId: "downtown-norfolk",
      officialSourceUrl: "https://www.downtownnorfolk.org/go/canvas-social-cuisine",
      supportingSourceUrl: "https://www.openstreetmap.org/search?query=411%20Granby%20Street%2C%20Norfolk%2C%20VA%2023510",
    },
    {
      id: "4997ce0f-4cf0-4d4b-a611-5f1e118bfe4b",
      name: "Starr Hill Market Bar",
      city: "Norfolk",
      address: "333 Waterside Drive, Norfolk, VA 23510",
      lat: 36.8443469,
      lng: -76.2908321,
      category: "Bars",
      type: "Market Bar",
      phone: "(757) 426-7433",
      website: "https://watersidedistrict.com/eat-and-drink/starr-hill-market-bar",
      scopeId: "downtown-norfolk",
      officialSourceUrl: "https://watersidedistrict.com/Eat-and-Drink",
      supportingSourceUrl: "https://www.openstreetmap.org/node/5791196133",
    },
    {
      id: "156d4340-87b0-4fa2-b356-980f6dd76a1f",
      name: "Sun's Sub & Pub",
      city: "Portsmouth",
      address: "425 County Street, Portsmouth, VA 23704",
      lat: 36.8336389,
      lng: -76.3019317,
      category: "Bars",
      type: "Pub / Restaurant",
      phone: "(757) 399-1356",
      website: "https://oldetowneportsmouth.com/listings/suns-sub-pub/",
      scopeId: "portsmouth-city",
      officialSourceUrl: "https://oldetowneportsmouth.com/listings/suns-sub-pub/",
      supportingSourceUrl: "https://www.openstreetmap.org/node/13069846264",
    },
    {
      id: "8622b332-0e9c-4b41-84e9-e69e75aed839",
      name: "Sandbar Surf Bar",
      city: "Virginia Beach",
      address: "2110 Atlantic Avenue, Virginia Beach, VA 23451",
      lat: 36.8496343,
      lng: -75.9755848,
      category: "Bars",
      type: "Surf Bar / Restaurant",
      phone: "(757) 349-7301",
      website: "https://sandbarvb.com/",
      scopeId: "virginia-beach-oceanfront",
      officialSourceUrl: "https://sandbarvb.com/",
      supportingSourceUrl: "https://www.openstreetmap.org/node/4025117532",
    },
    {
      id: "d1f6d5ee-1971-4cd2-be4e-8ba94069c6ba",
      name: "Chemistry Tapas & Tonics",
      city: "Virginia Beach",
      address: "2110 Atlantic Avenue, Virginia Beach, VA 23451",
      lat: 36.8497445,
      lng: -75.975625,
      category: "Nightlife",
      type: "Nightclub / Cocktail Bar",
      phone: "(757) 349-7301",
      website: "https://www.vbblock.com/chemistry",
      scopeId: "virginia-beach-oceanfront",
      officialSourceUrl: "https://www.vbblock.com/chemistry",
      supportingSourceUrl: "https://www.openstreetmap.org/node/4025117513",
    },
    {
      id: "e6b6c351-6d1b-4668-9d9f-99c1f5957da2",
      name: "Pacifica",
      city: "Virginia Beach",
      address: "328 Laskin Road, Virginia Beach, VA 23451",
      lat: 36.8591241,
      lng: -75.9798143,
      category: "Bars",
      type: "Tapas / Cocktail Bar",
      phone: "(757) 909-5717",
      website: "https://www.pacificavb.com/",
      scopeId: "virginia-beach-oceanfront",
      officialSourceUrl: "https://www.visitvirginiabeach.com/listing/pacifica/129/",
      supportingSourceUrl: "https://www.openstreetmap.org/way/356413302",
    },
    {
      id: "c9a58de2-174c-4ca6-872f-9442690865c6",
      name: "Baja Cantina Mai Bar",
      city: "Virginia Beach",
      address: "206 23rd Street, Virginia Beach, VA 23451",
      lat: 36.8510119,
      lng: -75.9762171,
      category: "Bars",
      type: "Restaurant / Bar / Live Music",
      phone: "(757) 437-2920",
      website: "https://www.facebook.com/BajaCantina23rdst/",
      scopeId: "virginia-beach-oceanfront",
      officialSourceUrl: "https://s3.us-east-1.amazonaws.com/virginia-beach-departments-docs/cor/Businesses/New-Businesses/2026/New-Business-Listings-April-2026.pdf",
      supportingSourceUrl: "https://www.openstreetmap.org/node/4025117527",
    },
    {
      id: "3ad42abb-82a5-4c50-8902-e75dd3433f05",
      name: "VIN Wine Bar",
      city: "Norfolk",
      address: "333 Waterside Drive, Norfolk, VA 23510",
      lat: 36.8442193,
      lng: -76.2908874,
      category: "Bars",
      type: "Wine Bar",
      phone: "(757) 426-7433",
      website: "https://www.visitnorfolk.com/dining/waterside-district/",
      scopeId: "downtown-norfolk",
      officialSourceUrl: "https://www.visitnorfolk.com/dining/waterside-district/",
      supportingSourceUrl: "https://www.openstreetmap.org/node/5791196140",
    },
    {
      id: "05507eb1-be64-47ef-83a4-24a7455f24cb",
      name: "Hunt Room",
      city: "Virginia Beach",
      address: "4200 Atlantic Avenue, Virginia Beach, VA 23451",
      lat: 36.8691419,
      lng: -75.9835523,
      category: "Bars",
      type: "Tavern / Bar / Live Music",
      phone: "(757) 425-8555",
      website: "https://www.cavalierresortvb.com/dining/hunt-room",
      scopeId: "virginia-beach-oceanfront",
      officialSourceUrl: "https://www.cavalierresortvb.com/dining/hunt-room",
      supportingSourceUrl: "https://www.openstreetmap.org/way/765746330",
    },
    {
      id: "00504af2-7c26-4dd0-a140-b1084551c5dc",
      name: "The Raleigh Room",
      city: "Virginia Beach",
      address: "4200 Atlantic Avenue, Virginia Beach, VA 23451",
      lat: 36.8691419,
      lng: -75.9835523,
      category: "Bars",
      type: "Cocktail Lounge / Live Music",
      phone: "(757) 425-8555",
      website: "https://www.cavalierresortvb.com/dining/the-raleigh-room",
      scopeId: "virginia-beach-oceanfront",
      officialSourceUrl: "https://www.cavalierresortvb.com/dining/the-raleigh-room",
      supportingSourceUrl: "https://www.openstreetmap.org/way/765746330",
    },
    {
      id: "fe48809e-4d44-40e2-84c2-05f45d091187",
      name: "Arbuckle's Bar & Grill",
      city: "Virginia Beach",
      address: "4101 Atlantic Avenue, Virginia Beach, VA 23451",
      lat: 36.8693023,
      lng: -75.9806832,
      category: "Bars",
      type: "Restaurant / Bar",
      phone: "(757) 228-3100",
      website: "https://www.cavalierresortvb.com/dining/arbuckles-bar-and-grill",
      scopeId: "virginia-beach-oceanfront",
      officialSourceUrl: "https://www.cavalierresortvb.com/dining/arbuckles-bar-and-grill",
      supportingSourceUrl: "https://www.openstreetmap.org/way/1276371749",
    },
    {
      id: "b62ae585-9d60-4c77-aab9-cb8fb6471c8a",
      name: "The Deck Seagrill & Bar",
      city: "Virginia Beach",
      address: "4201 Atlantic Avenue, Virginia Beach, VA 23451",
      lat: 36.8701582,
      lng: -75.9808693,
      category: "Bars",
      type: "Oceanfront Restaurant / Bar / Live Music",
      phone: "(757) 937-4200",
      website: "https://www.cavalierresortvb.com/dining/the-deck",
      scopeId: "virginia-beach-oceanfront",
      officialSourceUrl: "https://www.cavalierresortvb.com/dining/the-deck",
      supportingSourceUrl: "https://www.openstreetmap.org/way/835598004",
    },
    {
      id: "3213afd9-8bf4-4daf-8cec-e40bd7f70559",
      name: "Tacos-N-Tequila",
      city: "Virginia Beach",
      address: "4101 Atlantic Avenue, Virginia Beach, VA 23451",
      lat: 36.8693023,
      lng: -75.9806832,
      category: "Bars",
      type: "Beach Cantina / Tequila Bar",
      phone: "(757) 228-3100",
      website: "https://www.cavalierresortvb.com/dining/tacos-n-tequila",
      scopeId: "virginia-beach-oceanfront",
      officialSourceUrl: "https://www.cavalierresortvb.com/dining/tacos-n-tequila",
      supportingSourceUrl: "https://www.openstreetmap.org/way/1276371749",
    },
    {
      id: "dddde20e-5961-4fea-bccf-33d08867e9e7",
      name: "Tarnished Truth Distilling Company",
      city: "Virginia Beach",
      address: "4200 Atlantic Avenue, Virginia Beach, VA 23451",
      lat: 36.8691419,
      lng: -75.9835523,
      category: "Experiences",
      type: "Distillery / Tasting Room",
      phone: "(757) 425-8555",
      website: "https://www.cavalierresortvb.com/distillery",
      scopeId: "virginia-beach-oceanfront",
      officialSourceUrl: "https://www.cavalierresortvb.com/distillery",
      supportingSourceUrl: "https://www.openstreetmap.org/way/765746330",
    },
    {
      id: "c4b14b17-b041-4547-b48b-1923b710d2be",
      name: "Crocs 19th Street Bistro",
      city: "Virginia Beach",
      address: "620 19th Street, Virginia Beach, VA 23451",
      lat: 36.845553,
      lng: -75.98317,
      category: "Bars",
      type: "Restaurant / Bar / Event Venue",
      phone: "(757) 428-5444",
      website: "https://crocs19thstreetbistro.com/",
      scopeId: "virginia-beach-oceanfront",
      officialSourceUrl: "https://crocs19thstreetbistro.com/",
      supportingSourceUrl: "https://posh.vip/e/tde-picture-day-81",
    },
    {
      id: "d47843a5-9dbe-44bc-9e40-e0ebc7daf102",
      name: "Seaside Raw Bar",
      city: "Virginia Beach",
      address: "2016 Atlantic Avenue, Virginia Beach, VA 23451",
      lat: 36.848449306496,
      lng: -75.975174906565,
      category: "Bars",
      type: "Raw Bar / Tavern / Live Entertainment",
      phone: "(757) 428-2760",
      website: "https://seasiderawbar.com/",
      scopeId: "virginia-beach-oceanfront",
      officialSourceUrl: "https://seasiderawbar.com/",
      supportingSourceUrl: "https://www.visitvirginiabeach.com/listing/seaside-raw-bar/63/",
    },
    {
      id: "ffae30bf-a89d-4316-b7ae-35ced4cf6e76",
      name: "Chesapeake Bay Distillery",
      city: "Virginia Beach",
      address: "437 Virginia Beach Boulevard, Virginia Beach, VA 23451",
      lat: 36.844511973922,
      lng: -75.978746920738,
      category: "Experiences",
      type: "Distillery / Tasting Room",
      phone: "",
      website: "https://www.chesapeakebaydistillery.com/",
      scopeId: "virginia-beach-oceanfront",
      officialSourceUrl: "https://www.chesapeakebaydistillery.com/",
      supportingSourceUrl: "https://www.visitvirginiabeach.com/listing/chesapeake-bay-distillery/2513/",
    },
    {
      id: "e64a9796-5096-432d-ae81-4ffa58be9b3c",
      name: "Tempt Restaurant & Lounge",
      city: "Virginia Beach",
      address: "3102 Holly Road, Suite 500, Virginia Beach, VA 23451",
      lat: 36.85922313388,
      lng: -75.982149811019,
      category: "Bars",
      type: "Restaurant / Lounge",
      phone: "(757) 437-8230",
      website: "https://temptvb.com/",
      scopeId: "virginia-beach-oceanfront",
      officialSourceUrl: "https://temptvb.com/",
      supportingSourceUrl: "https://www.abc.virginia.gov/licenses/find-a-license",
    },
    {
      id: "eab40ea4-b359-40a9-afe2-4ac2338ad4ce",
      name: "Aqua Social Club",
      city: "Virginia Beach",
      address: "705 Atlantic Avenue, Virginia Beach, VA 23451",
      lat: 36.835806729373,
      lng: -75.971589110302,
      category: "Bars",
      type: "Pool Bar / Restaurant",
      phone: "(757) 917-5164",
      website: "https://slimb6469.wixsite.com/website",
      scopeId: "virginia-beach-oceanfront",
      officialSourceUrl: "https://slimb6469.wixsite.com/website",
      supportingSourceUrl: "https://www.abc.virginia.gov/licenses/find-a-license",
    },
    {
      id: "eccfe7e5-6baa-4db0-97b8-63be3e43dfe7",
      name: "Big Sam's Inlet Cafe & Raw Bar",
      city: "Virginia Beach",
      address: "300 Winston Salem Avenue, Virginia Beach, VA 23451",
      lat: 36.832673502367,
      lng: -75.974139946794,
      category: "Bars",
      type: "Inlet Cafe / Raw Bar",
      phone: "(757) 428-4858",
      website: "https://bigsamsrawbar.com/",
      scopeId: "virginia-beach-oceanfront",
      officialSourceUrl: "https://bigsamsrawbar.com/",
      supportingSourceUrl: "https://www.dineinvb.com/member-restaurants/big-sams/",
    },
  ] satisfies VerifiedNightlifeVenue[],
} as const;

function normalizedCity(value: unknown) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z]/g, "");
}

function coordinate(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed !== 0 ? parsed : null;
}

export function findVerifiedImportDuplicate(
  candidate: VerifiedNightlifeVenue,
  existing: readonly ExistingVenueForImport[],
) {
  return existing.find(venue => {
    if (venue.id === candidate.id) return true;
    if (normalizedCity(venue.city) !== normalizedCity(candidate.city)) return false;
    const similarity = venueNameSimilarity(venue.name, candidate.name);
    if (similarity < 0.92) return false;
    const latitude = coordinate(venue.lat);
    const longitude = coordinate(venue.lng);
    if (latitude === null || longitude === null) {
      return normalizeVenueName(venue.name) === normalizeVenueName(candidate.name);
    }
    return distanceMiles(latitude, longitude, candidate.lat, candidate.lng) <= 0.35;
  }) || null;
}

export function importableVerifiedNightlifeVenues(existing: readonly ExistingVenueForImport[]) {
  const duplicates: Array<{ candidate: VerifiedNightlifeVenue; existing: ExistingVenueForImport }> = [];
  const additions: VerifiedNightlifeVenue[] = [];
  for (const candidate of VERIFIED_NIGHTLIFE_IMPORT.venues) {
    const duplicate = findVerifiedImportDuplicate(candidate, existing);
    if (duplicate) duplicates.push({ candidate, existing: duplicate });
    else additions.push(candidate);
  }
  return { additions, duplicates };
}

export function verifiedNightlifeInsertRow(candidate: VerifiedNightlifeVenue, enrichedAt: string) {
  return {
    id: candidate.id,
    name: candidate.name,
    city: candidate.city,
    address: candidate.address,
    lat: candidate.lat,
    lng: candidate.lng,
    category: candidate.category,
    type: candidate.type,
    phone: candidate.phone,
    website: candidate.website,
    enriched_at: enrichedAt,
  };
}
