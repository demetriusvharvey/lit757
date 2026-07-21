export type VenueLogoInput = {
  name?: unknown;
  website?: unknown;
};

function clean(value: unknown) {
  return String(value || "").trim();
}

export function getVenueLogo(venue: VenueLogoInput) {
  const params = new URLSearchParams({
    name: clean(venue.name) || "Local business",
    v: "1",
  });
  const website = clean(venue.website);
  if (website) params.set("website", website);
  return `/api/venue-logo?${params.toString()}`;
}
