# OpenStreetMap venue enrichment

Buzz queries a bounded Hampton Roads OpenStreetMap extract through Overpass, matches candidates to existing venues by name and distance, and fills only missing metadata. Existing first-party and Google values are preserved.

The integration identifies itself with a unique User-Agent, posts Overpass QL in the request body, caches source data for six hours, and can fail over between public Overpass instances. It prefers the Virginia-specific MapRVA instance before global public mirrors.

## Production validation

- `/api/data/osm-venues` reports candidate coverage and attribution.
- `/api/venues/osm-enrich?dryRun=1` compares live Buzz venues without writing changes.
- `.github/workflows/osm-production-smoke.yml` requires nonempty OSM coverage, useful proposed matches, and zero dry-run writes.
- The first audited dry run found 4,254 relevant OSM candidates and 29 useful venue matches, limited to 15 missing phone numbers and 29 missing websites.
- `.github/workflows/osm-venue-enrichment.yml` performs the write-enabled enrichment weekly after the dry-run gate has proven match quality.

OpenStreetMap data is attributed to OpenStreetMap contributors under ODbL 1.0. OSM metadata is not used as an activity or occupancy signal.
