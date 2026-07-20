# Buzz pilot provider notes

## BestTime

Use BestTime as the first broad foot-traffic provider, not as the sole source of truth.

- Start with 10 venues and inspect address matching manually.
- Expand to a diverse 100-venue Hampton Roads cohort only after matching is clean.
- Track `covered`, `forecast_only`, `no_data`, and `error` separately.
- Refresh mapped venues during each clock hour.
- Treat live busyness as relative to that venue's own normal peak—not an absolute headcount.
- Forecast-only data cannot produce `Heating Up` or `On Fire` by itself.
- Store the external venue ID so future calls do not spend forecast-creation credits unnecessarily.

## Ticketmaster

Inventory Status is supporting commercial-demand evidence. It must not be interpreted as proof that attendees have arrived. Entry scans, when a partner exposes them, are first-party occupancy evidence and may carry significantly more weight.

## PredictHQ

Predicted attendance and event rank help identify where activity is likely. They remain forecast evidence until combined with timely live foot traffic, verified users, ticket scans, or a partner pulse.

## First-party data

User and venue reports expire quickly. Venue reports should be audited, and user reports must be geofenced, rate-limited, deduplicated, and compared for consensus.

## Pilot success criteria

Do not market Buzz as authoritative until the calibration report shows:

- 100+ matched field observations
- 20+ unique venues
- at least 85% precision for `Heating Up` or above
- no more than 10% false-positive rate

The product promise depends more on avoiding false claims than maximizing the number of places labeled busy.
