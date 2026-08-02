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
  osmSourceUrl: string;
};

export type ExistingVenueForImport = {
  id: string;
  name: string;
  city?: string | null;
  lat?: number | string | null;
  lng?: number | string | null;
};

export const VERIFIED_NIGHTLIFE_IMPORT = {
  batchId: "priority-nightlife-wave-2-2026-08-02",
  verifiedAt: "2026-08-02T07:24:00.000Z",
  backup: {
    generatedAt: "2026-08-02T07:04:19.892Z",
    sha256: "7fcbf128c168202190571e46e6e51a05c409e9867b0571af1b2c68bbff3b8859",
    runUrl: "https://github.com/demetriusvharvey/lit757/actions/runs/30737077192",
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
      osmSourceUrl: "https://www.openstreetmap.org/way/402387223",
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
      osmSourceUrl: "https://www.openstreetmap.org/node/4025117504",
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
      osmSourceUrl: "https://www.openstreetmap.org/node/1857210264",
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
      osmSourceUrl: "https://www.openstreetmap.org/search?query=411%20Granby%20Street%2C%20Norfolk%2C%20VA%2023510",
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
      osmSourceUrl: "https://www.openstreetmap.org/node/5791196133",
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
      osmSourceUrl: "https://www.openstreetmap.org/node/13069846264",
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
      osmSourceUrl: "https://www.openstreetmap.org/node/4025117532",
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
      osmSourceUrl: "https://www.openstreetmap.org/node/4025117513",
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
      osmSourceUrl: "https://www.openstreetmap.org/way/356413302",
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
      osmSourceUrl: "https://www.openstreetmap.org/node/4025117527",
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
      osmSourceUrl: "https://www.openstreetmap.org/node/5791196140",
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
