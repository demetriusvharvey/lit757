# Buzz lean live-data pilot

This pilot uses the services already paid for (Vercel Pro and Supabase Pro) plus free data sources.

## What runs automatically

- Every 15 minutes: TomTom traffic around 25 priority venues and first-party signal recovery.
- Every hour: BestTime, Ticketmaster inventory, and PredictHQ refresh routes. Providers without keys safely skip.
- Every 4 hours: Ticketmaster/Eventbrite event discovery plus configured local ICS calendars.
- Venue partner pulses update the Buzz score immediately and expire after 30 minutes.
- Verified user reports update the Buzz score immediately and expire after 45 minutes.

## Required Vercel environment variables

- `CRON_SECRET`: strong random value used to authorize scheduled routes.
- `TICKETMASTER_API_KEY`: Ticketmaster Discovery API key.
- `TOMTOM_API_KEY`: TomTom Traffic API key.
- `BUZZ_PARTNER_INGEST_SECRET`: pilot access key entered by venue managers.
- `LOCAL_EVENT_FEEDS_JSON`: optional JSON array of HTTPS ICS feeds.

Optional providers safely skip when their keys are absent:

- `BESTTIME_API_KEY_PRIVATE`
- `TICKETMASTER_INVENTORY_API_KEY`
- `PREDICTHQ_ACCESS_TOKEN`
- `EVENTBRITE_PRIVATE_TOKEN`

Example local calendar configuration:

```json
[
  {
    "name": "Scope Arena",
    "url": "https://example.com/scope-calendar.ics",
    "source": "scope_arena",
    "venueName": "Scope Arena"
  }
]
```

ICS feeds should expose stable `UID`, `SUMMARY`, `DTSTART`, `DTEND`, `LOCATION`, and `URL` fields when possible.

## Required GitHub Actions secrets

Repository settings → Secrets and variables → Actions:

- `BUZZ_PRODUCTION_URL`: production origin, such as `https://lit757.vercel.app`.
- `CRON_SECRET`: the exact same value configured in Vercel.

The repository is public, but encrypted Actions secrets are not printed unless a workflow explicitly exposes them. The included workflows only send the secret in an HTTPS Authorization header.

## Venue manager pilot

Create a private manager link:

```text
https://lit757.vercel.app/partner-pulse?venueId=<VENUE_UUID>&venue=<VENUE_NAME>
```

The manager enters the partner access key and chooses Quiet, Steady, Busy, or Packed. Occupancy percentage, wait time, reservations, and ticket status are optional.

The initial pilot uses one shared partner access key. Before onboarding many unrelated businesses, replace it with per-venue rotating tokens.

## Truth rules

- Traffic is supporting evidence only and cannot make a venue Live by itself.
- Ticket availability and predicted attendance are forecasts, not proof of arrival.
- Live status requires current first-party occupancy, verified users, ticket scans, or supported live foot traffic.
- Every signal expires. Stale signals stop affecting the score.

## Initial coverage target

Start with 25 high-value Hampton Roads venues. Review `/api/data-health` for:

- upcoming events by source
- venues with usable photos
- current provider mappings
- unexpired signal counts
- fresh Buzz score coverage

Expand only after venue matching and false-positive rates are acceptable.
