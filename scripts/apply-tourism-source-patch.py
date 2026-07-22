from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"{label} anchor not found")
    return text.replace(old, new, 1)


path = Path("src/lib/events/institution-calendars.ts")
text = path.read_text()

text = replace_once(
    text,
    'import { parseVenueListingEvents } from "./venue-listing";',
    'import { parseVenueListingEvents } from "./venue-listing";\nimport { parseVisitNorfolkEvents } from "./tourism-events";',
    "tourism parser import",
)
text = replace_once(
    text,
    'export type InstitutionKind = "university" | "arena" | "arts" | "museum" | "festival" | "attraction";',
    'export type InstitutionKind = "university" | "arena" | "arts" | "museum" | "festival" | "attraction" | "tourism";',
    "tourism kind",
)
text = replace_once(
    text,
    'export type InstitutionFormat = "localist-api" | "tribe-api" | "venue-html" | "jsonld-html";',
    'export type InstitutionFormat = "localist-api" | "tribe-api" | "venue-html" | "jsonld-html" | "embedded-json";',
    "tourism format",
)

registry_anchor = '''  {
    id: "portsmouth_museums_official",
    name: "Portsmouth Museums Events",
    kind: "museum",
    city: "Portsmouth",
    url: "https://www.portsmouthmuseums.com/events",
    format: "jsonld-html",
    enabled: true,
    venueName: "Portsmouth Museums",
  },
];'''
registry_replacement = '''  {
    id: "portsmouth_museums_official",
    name: "Portsmouth Museums Events",
    kind: "museum",
    city: "Portsmouth",
    url: "https://www.portsmouthmuseums.com/events",
    format: "jsonld-html",
    enabled: true,
    venueName: "Portsmouth Museums",
  },
  {
    id: "visit_norfolk_official",
    name: "VisitNorfolk Events",
    kind: "tourism",
    city: "Norfolk",
    url: "https://www.visitnorfolk.com/events/",
    format: "embedded-json",
    enabled: true,
    coverageNote: "Official destination calendar with local nightlife, food, arts, festivals, sports, classes, and community events.",
  },
];'''
text = replace_once(text, registry_anchor, registry_replacement, "tourism source registry")

fetch_anchor = '''async function fetchJsonLdHtml(source: InstitutionCalendarSource) {
  const html = await fetchHtml(source.url);
  const events = parseCityCalendarJsonLd(html, sourceAdapter(source));
  if (!events.length) throw new Error("Official institution page contained no Event structured data");
  return events;
}

export function institutionEventSignature'''
fetch_replacement = '''async function fetchJsonLdHtml(source: InstitutionCalendarSource) {
  const html = await fetchHtml(source.url);
  const events = parseCityCalendarJsonLd(html, sourceAdapter(source));
  if (!events.length) throw new Error("Official institution page contained no Event structured data");
  return events;
}

async function fetchEmbeddedTourism(source: InstitutionCalendarSource) {
  const html = await fetchHtml(source.url);
  const events = parseVisitNorfolkEvents(html, source);
  if (!events.length) throw new Error("Official tourism page contained no parseable embedded events");
  return events;
}

export function institutionEventSignature'''
text = replace_once(text, fetch_anchor, fetch_replacement, "embedded tourism fetcher")

branch_anchor = '''        : source.format === "venue-html"
          ? await fetchVenueHtml(source)
          : await fetchJsonLdHtml(source);'''
branch_replacement = '''        : source.format === "venue-html"
          ? await fetchVenueHtml(source)
          : source.format === "embedded-json"
            ? await fetchEmbeddedTourism(source)
            : await fetchJsonLdHtml(source);'''
text = replace_once(text, branch_anchor, branch_replacement, "tourism fetch branch")
path.write_text(text)
