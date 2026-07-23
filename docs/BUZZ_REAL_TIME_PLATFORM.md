# Buzz Real-Time Activity Platform

## Product mission

Buzz answers one question better than any other local discovery product:

> Where should I go right now, and what will it be like when I arrive?

This document is the implementation contract for the real-time activity platform. It turns the product roadmap into measurable system behavior and keeps UI, data, notifications, privacy, business tooling, and growth work aligned around truth.

## Non-negotiable principles

1. Never present weak inference as live truth.
2. Every signal has provenance, confidence, observed time, and expiration.
3. Unknown is a valid and preferable state.
4. Arrival-time usefulness matters more than current-state novelty.
5. Paid placement never changes activity truth.
6. Community rewards are based on corroborated accuracy, not volume.
7. Location is aggregated and privacy-preserving by default.
8. The map must remain useful when providers partially fail.

## Unified activity contract

Every venue and activity area should resolve to the following public model:

- `state`: unknown, quiet, active, hot
- `trend`: falling, stable, rising, surging
- `truthMode`: live, recently_confirmed, predicted, insufficient
- `score`: internal 0-100 normalized activity estimate
- `confidence`: low, medium, high
- `observedAt`: freshest meaningful evidence
- `expiresAt`: point after which the evidence must be discounted or removed
- `reason`: concise user-facing explanation
- `sources`: privacy-safe source summary
- `arrival`: travel-minutes-aware forecast
- `conditions`: line, parking, cover, age, weather exposure, accessibility, open status

## Source hierarchy

Highest to lowest default trust:

1. Multiple location-verified people currently present
2. Trusted field observer
3. Privacy-safe anonymous presence aggregate
4. Venue occupancy or wait integration
5. Real-time traffic, parking, transit, and event evidence
6. Ticket demand and official event schedules
7. Venue/day/hour historical calibration
8. Unconfirmed model prediction
9. Venue-owned promotional statement

Venue-owner content may be authoritative for hours, policies, events, and cover, but it cannot directly set independent activity truth.

## Signal lifecycle

Every stored activity signal must include:

- source and source family
- observed time
- expiration time
- live versus inferred
- confidence
- location accuracy where applicable
- reporter trust weight where applicable
- metadata needed to audit calculation

Recommended default TTLs:

- verified crowd report: 30 minutes
- line or parking report: 20 minutes
- trusted field observation: 45 minutes
- traffic evidence: 15 minutes
- event schedule: event-specific
- historical prediction: recompute at least every 15 minutes
- arrival forecast: recompute when origin, route time, or activity changes

## Arrival intelligence

Arrival intelligence estimates what the user will encounter, not merely what exists at query time.

Inputs:

- current score and trend
- route duration
- time-to-open or time-to-close
- event start and end
- historical change rate for venue/day/hour
- nearby event release or influx
- line and parking delay
- provider freshness and confidence

User-facing examples:

- Hot now and likely Hot when you arrive
- Rising now; expected to be Active in 18 minutes
- Event ending soon; activity may cool before arrival
- Strong choice now, but parking is worsening

## Map behavior

### City zoom

Show privacy-safe area heat and movement. Do not imply exact people or exact counts.

### Neighborhood zoom

Show corridors, clusters, rising areas, cooling areas, event-release effects, and parking/traffic pressure.

### Venue zoom

Show accessible pins with text or shape support, not color alone. Pin treatment distinguishes live, recently confirmed, predicted, and insufficient data.

### Time controls

Support Now, +30m, +60m, Later tonight, and Typical. Time controls must alter state presentation and ranking, not merely labels.

## Venue decision card

The first viewport must answer:

- What is the activity state?
- Is it rising or cooling?
- How recently was it confirmed?
- How confident is Buzz?
- What will it likely be when I arrive?
- How far away is it?
- Is it open?
- Why is Buzz recommending it?

Primary actions:

- Directions
- Watch
- Invite the Crew

Secondary details:

- line
- parking
- cover
- age limit
- dress code
- event or music
- indoor/outdoor
- accessibility
- food availability
- last confirmation
- source explanation

## Intent discovery

Primary intents:

- Best right now
- High energy
- Chill
- No long line
- Easy parking
- Food now
- Date night
- Group activity
- Family
- Free
- Open late
- Events ending soon
- Something different

Natural-language discovery may translate requests into structured constraints, but it must never invent activity evidence.

## Community truth loop

Location-qualified users can report:

- quiet
- active
- packed
- short line
- long line
- easy parking
- difficult parking

Follow-up confirmation actions:

- still accurate
- busier now
- quieter now
- no longer accurate

Reports earn provisional points. Final rewards depend on corroboration, later verification, location trust, and reporter history.

Abuse defenses:

- rate limits
- device and account reputation
- impossible movement checks
- duplicate report suppression
- report agreement modeling
- reduced weight for repetitive extreme reporters
- venue employee disclosure
- silent trust reduction for suspicious activity

## Watches and notifications

Users can watch:

- venue
- neighborhood
- category
- event
- time window
- planned night

Meaningful transitions:

- quiet to active
- active to hot
- rapidly rising
- event activity beginning
- line becoming manageable
- parking improving
- watched area becoming the strongest nearby option
- activity likely to remain strong through arrival

Suppression:

- repeated unchanged alerts
- low-confidence transitions
- closing-soon venues
- user too far away
- user already visited
- quiet hours
- recent dismissal

Alert modes:

- Essential
- Balanced
- Live
- Scheduled
- Digest

## Group planning

Shared rooms should work without app installation and include:

- venue and backup options
- activity truth and arrival forecast
- meeting time
- vote
- group size
- starting area constraints
- directions and share links

## Privacy

- no individual dots on the map
- no exact public crowd counts
- no residential heat
- minimum aggregation thresholds
- no public location history
- no public profile by default
- contextual permission requests
- transparent retention and deletion controls
- background location only when tied to a clear user-started feature

## Business integrity

Businesses may manage official facts and events. They cannot directly set Buzz activity truth.

Sponsored placement must be labeled and must not change state, trend, confidence, freshness, or ranking fields presented as independent truth.

## Quality metrics

Truth:

- mean absolute score error
- false-Hot rate
- false-Quiet rate
- confidence calibration
- median signal age
- percentage live / recently confirmed / predicted / insufficient
- contradictory report rate
- arrival forecast error

Decision value:

- directions started
- watch created
- venue shared
- group vote completed
- ticket or reservation opened
- confirmed arrival

Retention:

- weekly active users
- Friday/Saturday return rate
- alert-to-direction conversion
- confirmed reports per trusted contributor
- saved venues per user

## Delivery phases

### Phase 0 — Truth foundation

Unified activity model, source provenance, TTL enforcement, anti-abuse, ground-truth operations, provider health, unknown state, truth analytics.

### Phase 1 — Decision experience

Arrival prediction, upgraded cards, intents, timeline, what changed, inline reporting, watches, intelligent notifications, corridor activity, group rooms.

### Phase 2 — Network effects

Trusted observer program, accuracy rewards, temporary Scene media, crowd movement, deeper personalization, business verification, ticket and reservation conversion.

### Phase 3 — Platform moat

Native Live Activities, business analytics, tourism and campus products, multi-city calibration, privacy-safe real-time activity API.

## Definition of done

A feature is not complete because UI exists. It is complete only when:

- data contract is explicit
- degraded and unknown states work
- analytics exist
- permissions and privacy behavior are documented
- abuse cases are handled
- mobile accessibility is verified
- tests cover score and transition behavior
- provider failure does not break core discovery
