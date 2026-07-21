export type VenueImageInput = {
  name?: unknown;
  kind?: unknown;
  category?: unknown;
  type?: unknown;
  googlePlaceId?: unknown;
  lat?: unknown;
  lng?: unknown;
};

function normalizedText(value: unknown) {
  return String(value || "").trim();
}

function imageCategory(venue: VenueImageInput) {
  const value = normalizedText(venue.kind || venue.category || venue.type).toLowerCase();

  if (/food|restaurant|dining|cafe|coffee|bakery|dessert/.test(value)) return "food";
  if (/nightlife|bar|club|lounge|brewery|cocktail|wine/.test(value)) return "nightlife";
  if (/event|concert|festival|theater|theatre|comedy|show/.test(value)) return "events";
  if (/outdoor|park|beach|trail|garden|nature/.test(value)) return "outdoors";
  if (/shop|mall|market|retail/.test(value)) return "shopping";
  if (/activity|entertainment|museum|arcade|bowling|golf|sports/.test(value)) return "activity";
  return "other";
}

export function getVenueImage(venue: VenueImageInput) {
  const params = new URLSearchParams({
    name: normalizedText(venue.name) || "Local place",
    category: imageCategory(venue),
  });

  const placeId = normalizedText(venue.googlePlaceId);
  if (placeId) params.set("placeId", placeId);

  const latitude = Number(venue.lat);
  const longitude = Number(venue.lng);
  if (Number.isFinite(latitude)) params.set("lat", String(latitude));
  if (Number.isFinite(longitude)) params.set("lng", String(longitude));

  return `/api/venue-photo?${params.toString()}`;
}
