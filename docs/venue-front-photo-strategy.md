# Venue front photo strategy

Buzz prefers a recognizable exterior/storefront image for venue cards.

1. Resolve the venue's Google Place details and coordinates.
2. Request outdoor Street View metadata near the exact venue.
3. Only use the panorama when Google reports a valid outdoor panorama within 90 meters.
4. Aim the camera from the panorama toward the venue coordinates.
5. Fall back to the best landscape Google Place photo when Street View coverage is missing or too far away.
6. Keep a neutral category fallback in the UI when neither source is trustworthy.

Required server environment variables:

- `GOOGLE_PLACES_API_KEY`
- Optional dedicated key: `GOOGLE_STREET_VIEW_API_KEY`

The Street View Static API must be enabled for whichever key is used for exterior images.