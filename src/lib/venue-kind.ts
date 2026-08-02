export type VenueKind = "food" | "nightlife" | "activity" | "events" | "other";

export type VenueKindInput = {
  name?: unknown;
  type?: unknown;
  category?: unknown;
  musicGenre?: unknown;
  summary?: unknown;
  hasEvent?: boolean;
};

const KIND_PRIORITY: VenueKind[] = ["nightlife", "activity", "events", "food"];

// These ambiguous names were cross-checked against both an active Virginia ABC
// on-premise record and a current OpenStreetMap nightlife listing on 2026-08-01.
// Explicit venue metadata still takes precedence over this narrow fallback.
const VERIFIED_NIGHTLIFE_NAMES = new Set([
  "a j gators",
  "aj gators",
  "bad habits",
  "barrel 17",
  "baxters",
  "baxters sports lounge",
  "beach pub",
  "brickhouse tavern",
  "37th and zen",
  "froggies",
  "gershwins",
  "mels place",
  "neo kitchen and bar",
  "nuvibez restaurant bar and lounge",
  "pour girls",
  "repeal bourbon and burgers",
  "scotty quixx",
  "sharks sports bar",
  "sharks sports bar and grill",
  "space gallery",
  "casual pint",
  "katt",
  "tailgate",
  "torch bistro",
]);

function normalize(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^the\s+/, "");
}

const NIGHTLIFE = /\b(?:bar|bars|biergarten|brew house|brewhouse|brewery|brewing|brewpub|cabaret|cocktail|dance club|gentlemens club|hookah|lounge|night club|nightclub|nightlife|pub|saloon|sports bar|tap house|taphouse|taproom|tavern|wine|wine bar|winery)\b/;
const NON_NIGHTLIFE_CLUB = /\b(?:comedy|country|golf|health|private|social|yacht) club\b/;
const FOOD = /\b(?:bakery|breakfast|brunch|burger|cafe|coffee|diner|dining|food|grill|kitchen|pizza|restaurant|seafood|taco)\b/;
const ACTIVITY = /\b(?:aquarium|arcade|arts|beach|boardwalk|bowling|casino|comedy|entertainment|farm|gallery|garden|golf|historic|museum|outdoor|paint|park|shopping|surf|theater|theatre|theme park|trail|waterpark|zoo)\b/;
const EVENTS = /\b(?:arena|concert|event|live music|music venue|pavilion|performing arts)\b/;

export function venueKinds(input: VenueKindInput): VenueKind[] {
  const explicit = normalize(`${String(input.type || "")} ${String(input.category || "")}`);
  const name = normalize(input.name);
  const fallback = normalize(`${name} ${String(input.musicGenre || "")} ${String(input.summary || "")}`);
  const matches = new Set<VenueKind>();

  // A venue explicitly recorded as a bar, pub, lounge, nightclub, or brewery
  // must remain discoverable as nightlife even when its name also says
  // restaurant, grill, or kitchen.
  if (NIGHTLIFE.test(explicit) || (/\bclub\b/.test(explicit) && !NON_NIGHTLIFE_CLUB.test(explicit))) matches.add("nightlife");
  if (VERIFIED_NIGHTLIFE_NAMES.has(name) || NIGHTLIFE.test(name)) matches.add("nightlife");
  if (ACTIVITY.test(explicit)) matches.add("activity");
  if (EVENTS.test(explicit)) matches.add("events");
  if (FOOD.test(explicit)) matches.add("food");
  if (ACTIVITY.test(name)) matches.add("activity");
  if (EVENTS.test(name)) matches.add("events");
  if (FOOD.test(name)) matches.add("food");

  if (!matches.size) {
    if (NIGHTLIFE.test(fallback) || (/\bclub\b/.test(fallback) && !NON_NIGHTLIFE_CLUB.test(fallback))) matches.add("nightlife");
    if (ACTIVITY.test(fallback)) matches.add("activity");
    if (EVENTS.test(fallback)) matches.add("events");
    if (FOOD.test(fallback)) matches.add("food");
  }

  const ordered = KIND_PRIORITY.filter(kind => matches.has(kind));
  if (!ordered.length) ordered.push("other");
  return input.hasEvent ? ["events", ...ordered.filter(kind => kind !== "events")] : ordered;
}

export function venueKind(input: VenueKindInput): VenueKind {
  return venueKinds(input)[0];
}
