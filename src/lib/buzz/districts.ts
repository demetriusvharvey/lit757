export type ActivityDistrict = {
  id: string;
  name: string;
  shortName: string;
  city: string;
  center: { lat: number; lng: number };
  radiusMiles: number;
  accent: string;
  points: Array<{ lat: number; lng: number; label: string }>;
};

export const ACTIVITY_DISTRICTS: ActivityDistrict[] = [
  {
    id: "virginia-beach-oceanfront",
    name: "Virginia Beach Oceanfront",
    shortName: "Oceanfront",
    city: "Virginia Beach",
    center: { lat: 36.8529, lng: -75.978 },
    radiusMiles: 1.8,
    accent: "#ff6b35",
    points: [
      { lat: 36.8529, lng: -75.978, label: "Atlantic Avenue central" },
      { lat: 36.8612, lng: -75.9815, label: "31st Street arrivals" },
      { lat: 36.8348, lng: -75.9745, label: "Rudee Inlet arrivals" },
    ],
  },
  {
    id: "virginia-beach-town-center",
    name: "Virginia Beach Town Center",
    shortName: "Town Center",
    city: "Virginia Beach",
    center: { lat: 36.8424, lng: -76.1356 },
    radiusMiles: 1.3,
    accent: "#ff9f43",
    points: [
      { lat: 36.8424, lng: -76.1356, label: "Town Center core" },
      { lat: 36.8384, lng: -76.1305, label: "Virginia Beach Boulevard" },
      { lat: 36.8451, lng: -76.1392, label: "Independence Boulevard" },
    ],
  },
  {
    id: "downtown-norfolk-waterside",
    name: "Downtown Norfolk & Waterside",
    shortName: "Downtown Norfolk",
    city: "Norfolk",
    center: { lat: 36.8468, lng: -76.292 },
    radiusMiles: 1.3,
    accent: "#ff5c5c",
    points: [
      { lat: 36.8468, lng: -76.292, label: "Waterside Drive" },
      { lat: 36.8515, lng: -76.2894, label: "Granby Street" },
      { lat: 36.8434, lng: -76.2872, label: "St. Paul's Boulevard" },
    ],
  },
  {
    id: "ghent-neon",
    name: "Ghent & NEON District",
    shortName: "Ghent & NEON",
    city: "Norfolk",
    center: { lat: 36.8702, lng: -76.2886 },
    radiusMiles: 1.3,
    accent: "#f973d2",
    points: [
      { lat: 36.8702, lng: -76.2886, label: "21st Street" },
      { lat: 36.8643, lng: -76.2856, label: "NEON district" },
      { lat: 36.8746, lng: -76.2952, label: "Colley Avenue" },
    ],
  },
  {
    id: "olde-towne-portsmouth",
    name: "Olde Towne Portsmouth",
    shortName: "Olde Towne",
    city: "Portsmouth",
    center: { lat: 36.8353, lng: -76.2983 },
    radiusMiles: 1.2,
    accent: "#b58cff",
    points: [
      { lat: 36.8353, lng: -76.2983, label: "High Street waterfront" },
      { lat: 36.8311, lng: -76.3062, label: "Effingham Street" },
      { lat: 36.8391, lng: -76.304, label: "Crawford connector" },
    ],
  },
  {
    id: "summit-pointe-greenbrier",
    name: "Summit Pointe & Greenbrier",
    shortName: "Summit Pointe",
    city: "Chesapeake",
    center: { lat: 36.7687, lng: -76.235 },
    radiusMiles: 1.5,
    accent: "#45d6a8",
    points: [
      { lat: 36.7687, lng: -76.235, label: "Summit Pointe core" },
      { lat: 36.7755, lng: -76.229, label: "Greenbrier Parkway" },
      { lat: 36.7604, lng: -76.2408, label: "Volvo Parkway arrivals" },
    ],
  },
  {
    id: "hampton-coliseum-peninsula-town-center",
    name: "Hampton Coliseum & Peninsula Town Center",
    shortName: "Hampton Coliseum",
    city: "Hampton",
    center: { lat: 37.039, lng: -76.392 },
    radiusMiles: 1.8,
    accent: "#42a5f5",
    points: [
      { lat: 37.039, lng: -76.3828, label: "Hampton Coliseum" },
      { lat: 37.0428, lng: -76.3937, label: "Peninsula Town Center" },
      { lat: 37.034, lng: -76.405, label: "Mercury Boulevard arrivals" },
    ],
  },
  {
    id: "city-center-oyster-point",
    name: "City Center at Oyster Point",
    shortName: "City Center",
    city: "Newport News",
    center: { lat: 37.0877, lng: -76.473 },
    radiusMiles: 1.5,
    accent: "#7ed957",
    points: [
      { lat: 37.0877, lng: -76.473, label: "City Center core" },
      { lat: 37.0914, lng: -76.4804, label: "Jefferson Avenue" },
      { lat: 37.0837, lng: -76.4652, label: "Oyster Point Road" },
    ],
  },
];

export function distanceMiles(lat1: number, lng1: number, lat2: number, lng2: number) {
  const radians = (value: number) => value * Math.PI / 180;
  const deltaLat = radians(lat2 - lat1);
  const deltaLng = radians(lng2 - lng1);
  const value = Math.sin(deltaLat / 2) ** 2 + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(deltaLng / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function normalizedCity(value: unknown) {
  return String(value || "").toLowerCase().replace(/[^a-z]/g, "");
}

export function venueBelongsToActivityDistrict(
  district: ActivityDistrict,
  latitude: number,
  longitude: number,
  city?: string | null,
  radiusPaddingMiles = 0,
) {
  if (city && normalizedCity(city) !== normalizedCity(district.city)) return false;
  return distanceMiles(district.center.lat, district.center.lng, latitude, longitude)
    <= district.radiusMiles + Math.max(0, radiusPaddingMiles);
}

export function nearestActivityDistrict(
  latitude: number,
  longitude: number,
  city?: string | null,
  radiusPaddingMiles = 0,
) {
  let nearest: { district: ActivityDistrict; distance: number } | null = null;
  for (const district of ACTIVITY_DISTRICTS) {
    if (!venueBelongsToActivityDistrict(district, latitude, longitude, city, radiusPaddingMiles)) continue;
    const distance = distanceMiles(district.center.lat, district.center.lng, latitude, longitude);
    if (!nearest || distance < nearest.distance) nearest = { district, distance };
  }
  return nearest?.district || null;
}
