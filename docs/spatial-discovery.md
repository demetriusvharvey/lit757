# Nationwide Spatial Discovery

The mobile experience now discovers places by geography instead of a hard-coded market list.

## Supported scopes

- current latitude/longitude plus a 1, 3, 10, or 25 mile radius
- visible map bounds through **Search this area**
- venue and category search from Buzz's database
- Hampton Roads city and activity-district search from Buzz's local index
- optional United States location autocomplete through Mapbox geocoding only
  when `ALLOW_METERED_MAPBOX_GEOCODING=true`

## API routes

- `GET /api/nearby?lat=&lng=&radius=`
- `GET /api/nearby?bounds=west,south,east,north`
- `GET /api/nearby?q=&category=`
- `GET /api/location-search?q=`

The spatial venue API has no fixed Hampton Roads coordinate boundary. The current
Supabase venue inventory remains the limiting factor until additional markets
are ingested. External nationwide geocoding is billing-capable and therefore
disabled under the zero-cost production policy.

## Product behavior

- opening the app uses the member's location when permission is available
- changing radius reloads only the nearby area
- moving the map never snaps the member back
- **Search this area** reloads the visible map region
- map pins and venue cards share selection state
- city and ZIP results move the map and load venues around that destination

## Scaling path

1. Add normalized city, state, ZIP, neighborhood, and provider ID fields to venue ingestion.
2. Add a geospatial database index when inventory grows beyond the current in-memory filtering threshold.
3. Ingest new markets without changing the mobile client or spatial API contract.
