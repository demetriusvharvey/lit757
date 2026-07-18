type TaggableVenue = {
  name?: string | null;
  type?: string | null;
  category?: string | null;
  music_genre?: string | null;
  age_limit?: string | null;
  cover?: string | null;
  ai_summary?: string | null;
};

function normalize(value?: string | null) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
const TAG_RULES: Array<{ tag: string; match: RegExp }> = [
  { tag: "arts-culture", match: /\bart\b|gallery|museum|opera|cultural|theat(?:er|re)/ },
  { tag: "active", match: /arcade|bowling|fitness|golf|recreation|sport|surf|waterpark/ },
  { tag: "beach-water", match: /beach|boardwalk|boat|kayak|marina|ocean|surf|waterfront/ },
  { tag: "coffee-dessert", match: /bakery|cafe|coffee|creamery|dessert|doughnut/ },
  { tag: "comedy", match: /comed(?:y|ian)|improv/ },
  { tag: "dancing", match: /dance|dj|nightclub/ },
  { tag: "date-night", match: /cocktail|dining|restaurant|rooftop|tapas|wine/ },
  { tag: "family", match: /all ages|aquarium|children|family|museum|park|waterpark|zoo/ },
  { tag: "food", match: /breakfast|brunch|dining|food|kitchen|restaurant/ },
  { tag: "free-budget", match: /\bfree\b|no cover|park|public beach/ },
  { tag: "games", match: /arcade|bowling|escape room|game|trivia/ },
  { tag: "history", match: /historic|history|heritage|museum/ },
  { tag: "indoors", match: /aquarium|arcade|cinema|indoor|mall|museum|theat(?:er|re)/ },
  { tag: "live-music", match: /amphitheater|band|concert|live music|music|pavilion/ },
  { tag: "nightlife", match: /bar|club|hookah|lounge|nightlife/ },
  { tag: "outdoors", match: /beach|boardwalk|farm|garden|nature|outdoor|park|trail|wildlife/ },
  { tag: "shopping", match: /district|mall|market|shopping/ },
  { tag: "wellness", match: /massage|meditation|spa|wellness|yoga/ },
];

export function inferInterestTags(venue: TaggableVenue) {
  const text = normalize([
    venue.name,
    venue.type,
    venue.category,
    venue.music_genre,
    venue.age_limit,
    venue.cover,
    venue.ai_summary,
  ].filter(Boolean).join(" "));

  return TAG_RULES.filter(({ match }) => match.test(text)).map(({ tag }) => tag);
}
