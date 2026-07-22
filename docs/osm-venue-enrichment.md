# OpenStreetMap venue enrichment

Buzz queries a bounded Hampton Roads OpenStreetMap extract through Overpass, matches candidates to existing venues by name and distance, and fills only missing metadata. Existing first-party and Google values are preserved.

The integration identifies itself with a unique User-Agent, posts Overpass QL in the request body, caches source data for six hours, and can fail over between public Overpass instances. A protected production dry run must show useful matches and zero writes before scheduled enrichment is trusted.

OpenStreetMap data is attributed to OpenStreetMap contributors under ODbL 1.0. OSM metadata is not used as an activity or occupancy signal.
