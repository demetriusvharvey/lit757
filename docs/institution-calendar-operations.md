# Institution calendar operations

Buzz ingests official event sources from universities, arenas, performing-arts centers, museums, attractions, and festivals every four hours.

## Provider formats

- **Localist API:** university calendar instances with official locations and dates.
- **The Events Calendar API:** official WordPress event calendars used by attractions and festivals.
- **Venue listing parser:** official arena and arts-center listings with detail links, event dates, start times, and ticket availability.
- **Event JSON-LD:** structured event metadata where institutions publish it.

## Deduplication

Institution events are deduplicated within the provider set using normalized title, start minute, and venue. Before persistence, incoming events are compared against upcoming municipal and ticket-provider events using the same signature so the official source does not create a second copy of the same event.

## Monitoring

`/api/data/institution-calendars` reports source-level status, event counts, provider format, city, and coverage notes. The production public-data smoke suite requires working university, arena/arts, and museum/festival/attraction coverage and stores the full response as an artifact.

## Truth rule

Scheduled institutional events can improve activity forecasting, but they cannot make a venue Live or prove current occupancy.
