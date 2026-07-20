# Buzz Score v1 — Hampton Roads pilot

Buzz is a real-time measure of current activity for **things to do right now**. It is not a venue rating, a nightlife score, or a personalized recommendation score.

## What is implemented

- BestTime venue mapping, forecast creation, and live/forecast ingestion
- Ticketmaster Inventory Status ingestion for authorized event mappings
- PredictHQ event attendance forecast ingestion
- Signed-in, geofenced user crowd reports
- Opt-in venue partner pulse ingestion
- Expiring normalized signal storage
- Evidence-first Buzz Score v1 with live/forecast truth caps
- Current score snapshots and historical score snapshots
- Live vs Forecast, confidence, evidence age, and score explanation in the app
- Manual field-observation storage and calibration metrics

## Important BestTime limitation

A BestTime subscription does not automatically mean unlimited live data for every United States venue. Plans are limited by monthly unique venues and/or metered API credits. Live busyness is not available for every venue. The pilot must measure coverage before expanding.

## Required environment variables

```bash
# Existing
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
CRON_SECRET=

# Pilot providers
BESTTIME_API_KEY_PRIVATE=
TICKETMASTER_INVENTORY_API_KEY=
PREDICTHQ_ACCESS_TOKEN=

# First-party ingestion
BUZZ_PARTNER_INGEST_SECRET=
BUZZ_GROUND_TRUTH_SECRET=
```

Ticketmaster Inventory Status access is restricted. The route safely skips this provider until an authorized key is configured.

## 1. Apply database migrations

Apply:

- `20260720213000_buzz_pilot_data_stack.sql`
- `20260720220000_buzz_score_history.sql`

These create provider mappings, expiring signal snapshots, current scores, score history, partner pulses, user reports, and ground-truth observations.

## 2. Bootstrap BestTime coverage

Start with 10 venues to verify matching quality and credit usage:

```bash
curl -X POST \
  -H "Authorization: Bearer $CRON_SECRET" \
  "https://lit757.vercel.app/api/buzz/refresh?action=bootstrap&provider=besttime&limit=10"
```

Review `buzz_provider_venues` after every batch. Confirm that the provider name/address match the intended venue before expanding. Repeat in batches until the diverse pilot list reaches 100 venues.

Coverage states:

- `covered`: live and/or forecast signal available, including live when returned
- `forecast_only`: forecast available, no live value returned
- `no_data`: provider matched but returned no usable activity value
- `error`: matching or refresh failed

## 3. Refresh cadence

BestTime live data should be fetched during each clock hour. For 100 venues, run 25 least-recently-checked venues every 15 minutes:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  "https://lit757.vercel.app/api/buzz/refresh?provider=besttime&limit=25"
```

Run the remaining providers hourly:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  "https://lit757.vercel.app/api/buzz/refresh?provider=ticketmaster&limit=100"

curl -H "Authorization: Bearer $CRON_SECRET" \
  "https://lit757.vercel.app/api/buzz/refresh?provider=predicthq&limit=10"
```

First-party reports recompute a venue immediately. A periodic recovery pass is still available:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  "https://lit757.vercel.app/api/buzz/refresh?provider=first_party&limit=100"
```

Use Vercel Cron only when the project plan supports the required frequency. An external scheduler can call the same authenticated routes.

## 4. Ticketmaster mappings

Populate `buzz_provider_events` with:

- internal `event_id`
- internal `venue_id`
- provider `ticketmaster`
- Ticketmaster event ID as `external_id`

The refresh pipeline converts inventory status into expiring commercial-demand evidence. Ticket scarcity supports a score but does not prove the audience has arrived.

## 5. Venue partner pulse

Opted-in venues or an SMS/web workflow call:

```http
POST /api/buzz/partner-pulse
Authorization: Bearer <BUZZ_PARTNER_INGEST_SECRET>
Content-Type: application/json

{
  "venueId": "...",
  "occupancyBand": "busy",
  "occupancyPct": 78,
  "waitMinutes": 25,
  "reservationsStatus": "limited",
  "ticketsStatus": null,
  "submittedBy": "manager"
}
```

Partner pulses expire after 30 minutes. They are useful first-party evidence but should be audited and cross-checked against independent signals.

## 6. User crowd reports

The app displays a one-tap prompt after a venue is selected:

- Quiet
- Steady
- Busy
- Packed

A report only affects Buzz when:

- the user is signed in
- GPS accuracy is acceptable
- the user is within the venue geofence
- the user has not reported that venue during the previous 10 minutes

Reports expire after 45 minutes. Multiple independent reports are combined using unique users and agreement between reports.

## 7. Manual ground truth

Field observers submit actual observed crowd conditions:

```http
POST /api/buzz/ground-truth
Authorization: Bearer <BUZZ_GROUND_TRUTH_SECRET>
Content-Type: application/json

{
  "venueId": "...",
  "occupancyBand": "packed",
  "occupancyPct": 92,
  "queueMinutes": 18,
  "observerType": "field_observer",
  "notes": "Nearly every seat occupied"
}
```

Collect observations across at least 20–30 venues, different venue types, weekdays, weekends, and dayparts.

## 8. Calibration report

```bash
curl -H "Authorization: Bearer $BUZZ_GROUND_TRUTH_SECRET" \
  "https://lit757.vercel.app/api/buzz/calibration?days=30&threshold=76&windowMinutes=30"
```

The report returns precision, recall, false-positive rate, accuracy, mean absolute error, live-vs-forecast performance, and a release gate.

Initial release target:

- at least 100 matched observations
- at least 20 unique venues
- at least 85% precision when Buzz claims `Heating Up` or above
- no more than 10% false-positive rate

## Truth rules in code

- Ratings, photos, distance, and personalization do not change Buzz.
- Forecast-only scores are capped below `Heating Up`.
- One live signal family cannot produce an extreme score unless it is strong first-party occupancy evidence.
- Scores of 85+ require two live signal families or strong first-party occupancy evidence.
- Only the strongest signal inside a correlated signal family is counted.
- Every signal expires and decays with age.
- The app explicitly labels scores as Live or Forecast.
