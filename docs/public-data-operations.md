# Buzz public-data operations

## Production endpoints

- `/api/data/weather?city=Virginia%20Beach` — National Weather Service forecast, hourly forecast, alerts, and conservative activity impact.
- `/api/data/transit/static` — Hampton Roads Transit static GTFS routes and stops.
- `/api/data/transit/realtime` — HRT trip updates, predicted stop times, delays, service alerts, and optional vehicle positions.
- `/api/data/city-calendars` — source health for Norfolk, Chesapeake, Portsmouth, Hampton, Newport News, and Suffolk official calendars.
- `/api/data-health` — combined application data health.

## Scheduled ingestion and monitoring

- Official city calendars sync every four hours through `.github/workflows/city-calendar-sync.yml`.
- Public weather, transit, and calendar feeds are smoke-tested every two hours through `.github/workflows/public-data-smoke.yml`.
- Same-repository pull requests also run the production public-data smoke suite.
- Full smoke payloads are retained as short-lived workflow artifacts for troubleshooting.

## Truth rules

- Weather may adjust or cap forecast confidence, but weather cannot make a venue Live.
- Transit arrivals provide low-weight district movement context, but transit cannot prove venue occupancy.
- Calendar events provide scheduled activity context, not evidence that people are physically present.
- Live status still requires timely first-party occupancy, verified nearby users, entry scans, or another supported direct signal.

## HRT archive compatibility

HRT's static GTFS ZIP uses data descriptors. Buzz reads authoritative entry sizes and offsets from the ZIP central directory, supporting stored and deflated entries without assuming sizes are present in local file headers.
