# Buzz Score: evidence-first architecture

## Product definition

Buzz is a real-time discoverability product for **things to do right now**. It is not a nightlife ranking and it is not a venue quality rating.

The Buzz Score answers one question:

> How much real activity is happening at this place or event in the current moment?

Recommendation relevance, distance, ratings, photos, and personal preference belong in separate ranking fields. They must not inflate the displayed Buzz Score.

## Truth rules

1. A score above 75 requires timely activity evidence.
2. A score above 85 requires corroboration from at least two independent signal families, or a strong first-party signal such as entry scans or live occupancy.
3. Every score includes confidence (`low`, `medium`, `high`) and signal age.
4. Live signals decay quickly. Old activity must not keep a venue hot.
5. Missing evidence produces a forecast, not a claim that a place is busy.
6. Ratings, photos, distance, and user preference never change Buzz.
7. Venue partners and users cannot single-handedly force an extreme score.

## Signal families

### 1. First-party occupancy and transaction signals

Highest-trust sources:

- ticket scans / turnstile entries
- live occupancy counters
- POS order velocity compared with that venue's normal baseline
- reservation inventory, wait-list length, and quoted wait time
- parking entries or validated arrivals

### 2. Verified user presence

- unique opted-in devices within the venue geofence
- dwell time, GPS accuracy, and recency
- explicit `quiet / steady / busy / packed` reports
- photo/video proof only when privacy-safe and intentionally submitted
- reporter reputation and agreement between independent users

Fraud controls should limit duplicate devices, impossible travel, repeated self-promotion, GPS spoofing, and coordinated manipulation.

### 3. Event demand

- event currently in progress
- tickets sold / remaining inventory / sell-through velocity
- predicted attendance and venue capacity
- entry scans and no-show rates when available
- event start/end timing

### 4. Venue partner pulse

Opt-in partners can report:

- occupancy band
- walk-in wait
- tables or seats remaining
- parking availability
- whether reservations or tickets are sold out

Partner input is useful but should be cross-checked against user, transaction, or arrival signals.

### 5. Arrival and movement signals

- parking utilization
- transit arrivals
- traffic approaching the venue
- anonymized aggregate foot-traffic providers

### 6. In-app momentum

Weak supporting evidence only:

- searches, saves, directions requests, detail views, and alert subscriptions
- velocity compared with the venue's own baseline

These indicate intent, not confirmed attendance, so they must not create a high Buzz Score by themselves.

## Venue-type models

Weights must change by venue type.

- **Restaurants:** wait time, reservations remaining, walk-ins, POS velocity, verified presence.
- **Ticketed events:** scans, sold/remaining inventory, predicted attendance, parking/transit, verified presence.
- **Parks, beaches, museums, attractions:** foot traffic, parking, weather/open status, verified presence.
- **Shopping and markets:** foot traffic, parking, dwell time, merchant transaction aggregates.
- **Nightlife:** verified presence, entry counts, table availability, POS velocity, rideshare/parking arrivals.

## Current v0.2 implementation

The nearby API now separates live evidence from a forecast baseline:

- expected activity prior from existing venue history
- unique verified nearby devices in the last 45 minutes
- event timing / whether the event is in progress
- ticket scarcity status when available

Distance and Google rating no longer affect Buzz. Without live evidence or strong active-event evidence, the score is capped below the `Heating Up` threshold.

This is an interim guardrail, not the final model. It prevents false high-confidence claims while integrations are added.

## Target public display

Examples:

- `Buzz 86 · High confidence · updated 4 min ago`
- `Buzz 68 · Medium confidence · 12 verified nearby`
- `Forecast 61 · Low confidence · event starts in 90 min`

The interface should expose a short “Why this score?” breakdown so users can distinguish verified current activity from forecast evidence.

## Calibration

Before broad launch, collect ground-truth observations for each venue category and measure:

- precision of `Heating Up` and `On Fire` labels
- false-positive rate
- calibration by score band
- latency between real crowd change and score change
- performance by venue type, city, and time of day

The product should optimize for trust: it is better to miss some busy places than repeatedly tell users a quiet venue is buzzing.
