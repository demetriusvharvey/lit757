# Buzz pilot provider notes

## BestTime

BestTime is currently unavailable because its free credits are exhausted. Its
workflow path is manual-only so scheduled refreshes cannot create metered usage
or repeatedly fail. Runtime calls also require `ALLOW_METERED_BESTTIME=true`;
Buzz's zero-cost production policy leaves this unset.

If free coverage becomes available again, use BestTime as supporting broad
foot-traffic evidence, never as the sole source of truth.

- Start with 10 venues and inspect address matching manually.
- Expand to a diverse 100-venue Hampton Roads cohort only after matching is clean.
- Track `covered`, `forecast_only`, `no_data`, and `error` separately.
- Refresh mapped venues only while verified free coverage is available.
- Treat live busyness as relative to that venue's own normal peak—not an absolute headcount.
- Forecast-only data cannot produce `Heating Up` or `On Fire` by itself.
- Store the external venue ID so future calls do not spend forecast-creation credits unnecessarily.

## Ticketmaster

Inventory Status is supporting commercial-demand evidence. It must not be interpreted as proof that attendees have arrived. Entry scans, when a partner exposes them, are first-party occupancy evidence and may carry significantly more weight.

## PredictHQ

Predicted attendance and event rank help identify where activity is likely. They remain forecast evidence until combined with timely live foot traffic, verified users, ticket scans, or a partner pulse.

PredictHQ is a trial/subscription provider. It is manual-only and default-denied
by `ALLOW_METERED_PREDICTHQ`; do not set that flag under the zero-cost policy.

## Google Places and OpenAI

Credentials alone do not activate Google Places, Google photo enrichment, or
OpenAI-generated copy. They require `ALLOW_METERED_GOOGLE_PLACES=true` or
`ALLOW_METERED_OPENAI=true`. Production intentionally uses Buzz photo and copy
fallbacks instead, so public traffic cannot create a provider bill.

The same rule applies to Resend with `ALLOW_METERED_RESEND=true`. Account setup
still succeeds when email delivery is disabled.

## Mapbox

Map rendering still uses the configured public Mapbox token. Nationwide
geocoding is a separate billing-capable path and requires
`ALLOW_METERED_MAPBOX_GEOCODING=true`. With the flag unset, Buzz searches its
local Hampton Roads city and activity-district index without calling Mapbox.
The external path also rejects oversized queries, limits requests per server
instance, and times out stalled provider calls.

## TomTom

Buzz samples two rotating roads in each of eight activity districts every 15
minutes: 1,536 automatic non-tile requests per day. This leaves more than 30%
headroom below TomTom's documented 2,500-request daily free allowance.

## First-party data

User and venue reports expire quickly. Venue reports should be audited, and user reports must be geofenced, rate-limited, deduplicated, and compared for consensus.

## Pilot success criteria

Do not market Buzz as authoritative until the calibration report shows:

- 100+ matched field observations
- 20+ unique venues
- at least 85% precision for `Heating Up` or above
- no more than 10% false-positive rate

The product promise depends more on avoiding false claims than maximizing the number of places labeled busy.
