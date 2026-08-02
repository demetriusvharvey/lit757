export type NightPlanInterest =
  | "food"
  | "drinks"
  | "dancing"
  | "live_music"
  | "events"
  | "activities"
  | "outdoors"
  | "arts"
  | "sports"
  | "shopping"
  | "dessert"
  | "coffee";

export type NightPlanVenue = {
  id: string;
  name: string;
  city?: string | null;
  address?: string | null;
  lat: number | string;
  lng: number | string;
  kind?: string | null;
  kinds?: string[];
  type?: string | null;
  category?: string | null;
  reason?: string | null;
  openNow?: boolean | null;
  distanceMiles?: number | null;
  ageLimit?: string | null;
  cover?: string | null;
  parking?: string | null;
  dressCode?: string | null;
  musicGenre?: string | null;
  interestTags?: string[];
  event?: {
    name?: string | null;
    startTime?: string | null;
    sourceUrl?: string | null;
  } | null;
  activity?: {
    score?: number | null;
    label?: string | null;
    trendLabel?: string | null;
    confidence?: string | null;
    scoreMode?: "live" | "forecast" | null;
    updatedAt?: string | null;
  } | null;
};

export type NightPlanIntent = {
  prompt: string;
  city: string | null;
  area: string | null;
  group: "solo" | "date" | "friends" | "family";
  energy: "quiet" | "balanced" | "high";
  interests: NightPlanInterest[];
  keywords: string[];
  budget: {
    amount: number | null;
    perPerson: boolean;
    tier: "low" | "moderate" | "premium" | "any";
  };
  startMinutes: number;
  dayOffset: number;
  stopCount: number;
  constraints: {
    noAlcohol: boolean;
    noClubs: boolean;
    avoidCrowds: boolean;
    indoorOnly: boolean;
    outdoorOnly: boolean;
    accessibilityRequired: boolean;
    allAgesRequired: boolean;
    parkingImportant: boolean;
    walkable: boolean;
    maxDistanceMiles: number | null;
  };
  understood: string[];
};

export type NightPlanStop = {
  venue: NightPlanVenue;
  interest: NightPlanInterest;
  timeLabel: string;
  durationMinutes: number;
  travelMinutesFromPrevious: number | null;
  why: string[];
  truthLabel: "Live activity" | "Activity forecast";
};

export type NightPlan = {
  title: string;
  summary: string;
  intent: NightPlanIntent;
  stops: NightPlanStop[];
  backup: NightPlanVenue | null;
  backupWhy: string | null;
  caveats: string[];
  liveStops: number;
  forecastStops: number;
  generatedAt: string;
};

const CITY_AREAS = [
  { city: "Virginia Beach", aliases: ["virginia beach", "va beach", "vb"], areas: ["oceanfront", "town center", "shore drive", "vibe district"] },
  { city: "Norfolk", aliases: ["norfolk"], areas: ["ghent", "downtown norfolk", "waterside", "neon district", "granby"] },
  { city: "Chesapeake", aliases: ["chesapeake"], areas: ["greenbrier", "great bridge"] },
  { city: "Portsmouth", aliases: ["portsmouth"], areas: ["olde towne", "old town portsmouth"] },
  { city: "Suffolk", aliases: ["suffolk"], areas: ["downtown suffolk", "harbour view"] },
  { city: "Hampton", aliases: ["hampton"], areas: ["phoebus", "coliseum central"] },
  { city: "Newport News", aliases: ["newport news"], areas: ["oyster point", "city center", "hilton village"] },
] as const;

const INTEREST_PATTERNS: Array<{ interest: NightPlanInterest; patterns: RegExp[]; label: string }> = [
  { interest: "dessert", patterns: [/\bdessert\b/, /\bice cream\b/, /\bsweets?\b/], label: "dessert" },
  { interest: "coffee", patterns: [/\bcoffee\b/, /\bcafe\b/, /\bbakery\b/], label: "coffee" },
  { interest: "live_music", patterns: [/\blive music\b/, /\bconcert\b/, /\bband\b/, /\blive band\b/], label: "live music" },
  { interest: "dancing", patterns: [/\bdanc(?:e|ing)\b/, /\bdj\b/, /\bturnt\b/, /\bparty\b/], label: "dancing" },
  { interest: "food", patterns: [/\bdinner\b/, /\beat(?:ing)?\b/, /\bfood\b/, /\brestaurant\b/, /\bbrunch\b/, /\blunch\b/, /\bbreakfast\b/, /\btacos?\b/, /\bsushi\b/, /\bvegan\b/, /\bseafood\b/, /\bsteak\b/, /\bwings?\b/], label: "food" },
  { interest: "drinks", patterns: [/\bdrinks?\b/, /\bcocktails?\b/, /\bbar\b/, /\bbeer\b/, /\bwine\b/, /\bbrewery\b/, /\brooftop\b/], label: "drinks" },
  { interest: "events", patterns: [/\bevents?\b/, /\bshow\b/, /\bperformance\b/, /\bfestival\b/], label: "events" },
  { interest: "outdoors", patterns: [/\boutdoors?\b/, /\boutside\b/, /\bbeach\b/, /\bpark\b/, /\btrail\b/, /\bnature\b/], label: "outdoors" },
  { interest: "arts", patterns: [/\barts?\b/, /\bmuseum\b/, /\bgallery\b/, /\btheat(?:er|re)\b/, /\bcomedy\b/, /\bculture\b/], label: "arts and culture" },
  { interest: "sports", patterns: [/\bsports?\b/, /\bgame\b/, /\bbowling\b/, /\bgolf\b/, /\barcade\b/], label: "games and sports" },
  { interest: "shopping", patterns: [/\bshop(?:ping)?\b/, /\bmall\b/, /\bmarket\b/], label: "shopping" },
  { interest: "activities", patterns: [/\bactivities\b/, /\bsomething fun\b/, /\badventure\b/, /\bthings to do\b/, /\bfun\b/, /\bkaraoke\b/, /\btrivia\b/, /\bescape room\b/, /\blaser tag\b/], label: "an activity" },
];

const KEYWORD_STOP_WORDS = new Set([
  "about", "accessible", "accessibility", "ada", "after", "ages", "alcohol", "all", "also", "and", "anything", "around", "at", "avoid", "balanced", "bar", "before", "budget", "busy", "cheap", "chill", "club", "clubs", "cocktail", "cocktails", "crowd", "crowds", "dance", "dancing", "date", "dinner", "drink", "drinks", "each", "energy", "event", "events", "family", "food", "for", "friends", "from", "fun", "high", "indoor", "inside", "kids", "less", "line", "lines", "live", "long", "looking", "max", "me", "mobility", "music", "my", "near", "need", "night", "not", "outdoor", "outside", "parking", "per", "person", "place", "places", "plan", "quiet", "relaxed", "something", "sober", "spot", "spots", "stop", "stops", "than", "then", "things", "tonight", "total", "under", "underage", "walkable", "walking", "want", "wheelchair", "with", "without", "younger",
]);

function cleanPrompt(value: unknown) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function normalize(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9$:\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function phraseIndex(value: string, pattern: RegExp) {
  const match = pattern.exec(value);
  return match?.index ?? Number.POSITIVE_INFINITY;
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function keywordIntent(prompt: string) {
  const locationTokens = new Set(CITY_AREAS.flatMap(entry => [
    entry.city,
    ...entry.aliases,
    ...entry.areas,
  ]).flatMap(value => normalize(value).split(" ")));
  return unique(prompt.split(" ").filter(token => (
    token.length >= 3
    && !/^\d+$/.test(token)
    && !KEYWORD_STOP_WORDS.has(token)
    && !locationTokens.has(token)
  ))).slice(0, 6);
}

function locationIntent(prompt: string) {
  for (const entry of CITY_AREAS) {
    const area = entry.areas.find(candidate => prompt.includes(candidate));
    if (area) return { city: entry.city, area };
    if (entry.aliases.some(alias => new RegExp(`\\b${alias.replace(/\s+/g, "\\s+")}\\b`).test(prompt))) {
      return { city: entry.city, area: null };
    }
  }
  return { city: null, area: null };
}

function groupIntent(prompt: string): NightPlanIntent["group"] {
  if (/\b(?:family|families|kids?|children|child|teenagers?)\b/.test(prompt)) return "family";
  if (/\b(?:date|romantic|romance|couple|wife|husband|girlfriend|boyfriend|partner)\b/.test(prompt)) return "date";
  if (/\b(?:friends?|crew|group|girls night|guys night|birthday|bachelorette|bachelor)\b/.test(prompt)) return "friends";
  return "solo";
}

function energyIntent(prompt: string): NightPlanIntent["energy"] {
  if (/\b(?:quiet|chill|relaxed|laid back|low key|lowkey|intimate|calm|not loud|not too loud)\b/.test(prompt)) return "quiet";
  if (/\b(?:high energy|hype|turnt|party|wild|loud|dancing|dance club|nightclub)\b/.test(prompt)) return "high";
  return "balanced";
}

function budgetIntent(prompt: string): NightPlanIntent["budget"] {
  const amountMatch = prompt.match(/(?:under|less than|max(?:imum)?|up to)\s*\$\s*(\d{1,4})|\$(\d{1,4})|\bbudget(?: of| under| up to)?\s*\$?\s*(\d{1,4})/);
  const amount = Math.min(5_000, Number(amountMatch?.[1] || amountMatch?.[2] || amountMatch?.[3] || 0)) || null;
  const perPerson = /\b(?:per person|each|a person|pp)\b/.test(prompt);
  let tier: NightPlanIntent["budget"]["tier"] = "any";
  if (/\b(?:cheap|budget|affordable|inexpensive|free|low cost)\b/.test(prompt)) tier = "low";
  if (/\b(?:fancy|upscale|splurge|luxury|premium)\b/.test(prompt)) tier = "premium";
  if (amount !== null) {
    const comparable = perPerson ? amount : amount / 2;
    tier = comparable <= 45 ? "low" : comparable <= 110 ? "moderate" : "premium";
  }
  return { amount, perPerson, tier };
}

function startTimeIntent(rawPrompt: string, prompt: string, now: Date) {
  const match = rawPrompt.toLowerCase().match(/\b(?:at|around|after|starting(?: at)?)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
  let hour = match ? Number(match[1]) % 24 : now.getHours();
  const minute = match ? Math.min(59, Number(match[2] || 0)) : now.getMinutes() < 30 ? 30 : 0;
  if (!match) hour = now.getMinutes() < 30 ? hour : (hour + 1) % 24;
  else if (match[3] === "pm" && hour < 12) hour += 12;
  else if (match[3] === "am" && hour === 12) hour = 0;
  else if (!match[3] && hour >= 1 && hour <= 11) hour += 12;
  if (!match && /\bearly\b/.test(prompt)) { hour = 17; return { startMinutes: hour * 60 + 30, dayOffset: /\btomorrow\b/.test(prompt) ? 1 : 0 }; }
  if (!match && /\blate\b/.test(prompt)) hour = 21;
  return { startMinutes: hour * 60 + minute, dayOffset: /\btomorrow\b|\bnext (?:friday|saturday|sunday|weekend)\b/.test(prompt) ? 1 : 0 };
}

function stopCountIntent(prompt: string, interests: NightPlanInterest[]) {
  const explicit = prompt.match(/\b([1-4]|one|two|three|four)\s+(?:stops?|places?|spots?)\b/);
  const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4 };
  if (explicit) return Math.max(1, Math.min(4, Number(explicit[1]) || words[explicit[1]] || 3));
  if (/\b(?:just|only) (?:dinner|drinks|dessert|coffee|one place)\b/.test(prompt)) return 1;
  if (/\b(?:bar hop|bar hopping|crawl)\b/.test(prompt)) return 3;
  return Math.max(2, Math.min(3, interests.length || 3));
}

function interestIntent(prompt: string, group: NightPlanIntent["group"], noAlcohol: boolean, noClubs: boolean) {
  const found = INTEREST_PATTERNS.flatMap(definition => {
    if (noAlcohol && definition.interest === "drinks") return [];
    if (noClubs && definition.interest === "dancing" && /\bclub\b/.test(prompt) && !/\bdanc/.test(prompt)) return [];
    const index = Math.min(...definition.patterns.map(pattern => phraseIndex(prompt, pattern)));
    return Number.isFinite(index) ? [{ interest: definition.interest, index }] : [];
  }).sort((left, right) => left.index - right.index).map(item => item.interest);

  if (found.length) return unique(found);
  if (group === "family") return ["activities", "food"] as NightPlanInterest[];
  if (group === "date") return ["food", noAlcohol ? "arts" : "drinks", "activities"] as NightPlanInterest[];
  if (group === "friends") return noAlcohol
    ? ["activities", "food", "live_music"] as NightPlanInterest[]
    : ["food", "drinks", "dancing"] as NightPlanInterest[];
  return ["activities", "food", noAlcohol ? "arts" : "drinks"] as NightPlanInterest[];
}

export function parseNightPlanPrompt(value: unknown, now = new Date()): NightPlanIntent {
  const rawPrompt = cleanPrompt(value) || "surprise me tonight";
  const prompt = normalize(rawPrompt);
  const location = locationIntent(prompt);
  const group = groupIntent(prompt);
  const energy = energyIntent(prompt);
  const noAlcohol = /\b(?:sober|no alcohol|without alcohol|alcohol free|dry night|dont drink|do not drink|not drinking)\b/.test(prompt);
  const noClubs = /\b(?:no clubs?|not a club|avoid clubs?|without clubs?)\b/.test(prompt);
  const interests = interestIntent(prompt, group, noAlcohol, noClubs);
  const keywords = keywordIntent(prompt);
  const budget = budgetIntent(prompt);
  const timing = startTimeIntent(rawPrompt, prompt, now);
  const maxDistanceMatch = prompt.match(/\bwithin\s+(\d{1,2}(?:\.\d)?)\s*(?:mi|mile|miles)\b/);
  const constraints = {
    noAlcohol,
    noClubs,
    avoidCrowds: /\b(?:avoid crowds?|not crowded|no crowds?|not busy|not packed|without crowds?|short lines?|no long lines?|avoid lines?)\b/.test(prompt),
    indoorOnly: /\b(?:indoors?|inside)\b/.test(prompt) && !/\b(?:outdoors?|outside)\b/.test(prompt),
    outdoorOnly: /\b(?:outdoors?|outside)\b/.test(prompt) && !/\b(?:indoors?|inside)\b/.test(prompt),
    accessibilityRequired: /\b(?:wheelchair|accessible|accessibility|ada|mobility)\b/.test(prompt),
    allAgesRequired: /\b(?:under 21|underage|all ages|not 21|younger than 21)\b/.test(prompt),
    parkingImportant: /\b(?:parking|easy to park|parking lot|parking garage)\b/.test(prompt),
    walkable: /\b(?:walkable|walking distance|walking|walk only|no driving|dont drive|do not drive|dont want to park|do not want to park)\b/.test(prompt),
    maxDistanceMiles: maxDistanceMatch ? Math.max(0.5, Math.min(50, Number(maxDistanceMatch[1]))) : null,
  };
  const understood = unique([
    location.area || location.city,
    group === "date" ? "date night" : group === "friends" ? "with friends" : group === "family" ? "family-friendly" : "solo-friendly",
    energy === "quiet" ? "quiet energy" : energy === "high" ? "high energy" : "balanced energy",
    ...interests.map(interest => INTEREST_PATTERNS.find(item => item.interest === interest)?.label || interest),
    keywords.length ? keywords.join(" + ") : null,
    budget.amount ? `${budget.perPerson ? "$" + budget.amount + " each" : "$" + budget.amount + " total"}` : budget.tier !== "any" ? `${budget.tier} budget` : null,
    noAlcohol ? "no alcohol" : null,
    noClubs ? "no clubs" : null,
    constraints.avoidCrowds ? "avoid crowds" : null,
    constraints.accessibilityRequired ? "accessibility needed" : null,
    constraints.allAgesRequired ? "all ages" : null,
    constraints.walkable ? "walkable stops" : null,
  ].filter((item): item is string => Boolean(item)));

  return {
    prompt: rawPrompt,
    city: location.city,
    area: location.area,
    group,
    energy,
    interests,
    keywords,
    budget,
    startMinutes: timing.startMinutes,
    dayOffset: timing.dayOffset,
    stopCount: stopCountIntent(prompt, interests),
    constraints,
    understood,
  };
}

function venueText(venue: NightPlanVenue) {
  return normalize([
    venue.name,
    venue.city,
    venue.kind,
    ...(venue.kinds || []),
    venue.type,
    venue.category,
    venue.musicGenre,
    venue.reason,
    venue.event?.name,
    ...(venue.interestTags || []),
  ].filter(Boolean).join(" "));
}

function keywordForms(keyword: string) {
  return unique([
    keyword,
    keyword.endsWith("ies") && keyword.length > 4 ? `${keyword.slice(0, -3)}y` : null,
    keyword.endsWith("s") && keyword.length > 4 ? keyword.slice(0, -1) : null,
  ].filter((value): value is string => Boolean(value)));
}

function matchingKeywords(venue: NightPlanVenue, keywords: string[]) {
  const tokens = new Set(venueText(venue).split(" "));
  return keywords.filter(keyword => keywordForms(keyword).some(form => tokens.has(form)));
}

function venueKinds(venue: NightPlanVenue) {
  return new Set([venue.kind, ...(venue.kinds || [])].filter(Boolean).map(value => normalize(value)));
}

export function venueMatchesNightPlanInterest(venue: NightPlanVenue, interest: NightPlanInterest) {
  const text = venueText(venue);
  const kinds = venueKinds(venue);
  if (interest === "food") return kinds.has("food") || /\b(?:restaurant|food|diner|kitchen|grill|pizza|taco|seafood|brunch)\b/.test(text);
  if (interest === "drinks") return /\b(?:bar|brewery|brewing|cocktail|wine|winery|pub|taproom|tavern|biergarten)\b/.test(text);
  if (interest === "dancing") return /\b(?:dance|dancing|nightclub|dance club|dj|cabaret)\b/.test(text);
  if (interest === "live_music") {
    const livePerformance = /\blive\s+(?:jazz|rock|country|hip hop|r and b|blues|reggae|acoustic|singer|music|band)\b/.test(text);
    return Boolean(venue.event && (/\b(?:music|concert|band|dj)\b/.test(text) || livePerformance))
      || /\b(?:live music|music venue|concert|band)\b/.test(text)
      || livePerformance;
  }
  if (interest === "events") return Boolean(venue.event) || kinds.has("events");
  if (interest === "outdoors") return /\b(?:park|trail|beach|garden|outdoor|outside|boardwalk|zoo|golf)\b/.test(text);
  if (interest === "arts") return /\b(?:art|arts|museum|gallery|theater|theatre|comedy|culture|historic)\b/.test(text);
  if (interest === "sports") return /\b(?:sport|game|bowling|golf|arcade|stadium|arena)\b/.test(text);
  if (interest === "shopping") return /\b(?:shopping|mall|market|shop|store)\b/.test(text);
  if (interest === "dessert") return /\b(?:dessert|ice cream|creamery|bakery|sweets|chocolate)\b/.test(text);
  if (interest === "coffee") return /\b(?:coffee|cafe|bakery)\b/.test(text);
  return kinds.has("activity") || /\b(?:activity|entertainment|museum|park|arcade|bowling|aquarium|zoo|comedy|karaoke|trivia|escape room|laser tag)\b/.test(text);
}

function numericCoordinate(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed !== 0 ? parsed : null;
}

function distanceMiles(left: NightPlanVenue, right: NightPlanVenue) {
  const lat1 = numericCoordinate(left.lat);
  const lng1 = numericCoordinate(left.lng);
  const lat2 = numericCoordinate(right.lat);
  const lng2 = numericCoordinate(right.lng);
  if (lat1 === null || lng1 === null || lat2 === null || lng2 === null) return null;
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const dLat = radians(lat2 - lat1);
  const dLng = radians(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLng / 2) ** 2;
  return 3_958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function hasExplicitAgeRestriction(venue: NightPlanVenue) {
  const ageLimit = normalize(venue.ageLimit);
  return Boolean(ageLimit)
    && /(?:^|\b)(?:18|21)(?:\b|$)/.test(ageLimit)
    && !/\b(?:under|and under|or younger)\b/.test(ageLimit);
}

function obviousClub(venue: NightPlanVenue) {
  return /\b(?:nightclub|dance club|gentlemens club|cabaret)\b/.test(venueText(venue));
}

function obviousOutdoor(venue: NightPlanVenue) {
  return venueMatchesNightPlanInterest(venue, "outdoors");
}

function nightlifeOnly(venue: NightPlanVenue) {
  const kinds = venueKinds(venue);
  return kinds.has("nightlife") && !kinds.has("food") && !kinds.has("activity") && !venue.event;
}

function viableVenues(venues: readonly NightPlanVenue[], intent: NightPlanIntent) {
  const valid = venues.filter(venue => numericCoordinate(venue.lat) !== null && numericCoordinate(venue.lng) !== null && venue.openNow !== false);
  const inCity = intent.city ? valid.filter(venue => normalize(venue.city) === normalize(intent.city)) : valid;
  const scoped = intent.city && inCity.length ? inCity : valid;
  return scoped.filter(venue => {
    if (intent.group === "family" && (hasExplicitAgeRestriction(venue) || nightlifeOnly(venue))) return false;
    if (intent.constraints.allAgesRequired && hasExplicitAgeRestriction(venue)) return false;
    if (intent.constraints.noAlcohol && nightlifeOnly(venue)) return false;
    if (intent.constraints.noClubs && obviousClub(venue)) return false;
    if (intent.constraints.indoorOnly && obviousOutdoor(venue)) return false;
    if (intent.constraints.outdoorOnly && !obviousOutdoor(venue)) return false;
    if (intent.constraints.maxDistanceMiles !== null && venue.distanceMiles != null && venue.distanceMiles > intent.constraints.maxDistanceMiles) return false;
    return true;
  });
}

function knownFree(venue: NightPlanVenue) {
  return /\b(?:free|none|no cover|\$0)\b/.test(normalize(venue.cover));
}

function rankForIntent(venue: NightPlanVenue, interest: NightPlanInterest, intent: NightPlanIntent, previous: NightPlanVenue | null) {
  const activity = Math.max(0, Math.min(100, Number(venue.activity?.score ?? 35)));
  const text = venueText(venue);
  let rank = activity * 0.28;
  if (venueMatchesNightPlanInterest(venue, interest)) rank += 58;
  if (venue.openNow === true) rank += 8;
  if (intent.city && normalize(venue.city) === normalize(intent.city)) rank += 28;
  if (intent.area && text.includes(normalize(intent.area))) rank += 24;
  if (intent.energy === "high") rank += activity * 0.32;
  if (intent.energy === "quiet") rank += activity >= 38 && activity <= 68 ? 26 : activity >= 78 ? -34 : 8;
  if (intent.constraints.avoidCrowds) rank += activity <= 64 ? 28 : activity >= 78 ? -42 : 4;
  if (intent.group === "date" && ["food", "drinks", "arts", "dessert"].includes(interest)) rank += 12;
  if (intent.group === "friends" && ["drinks", "dancing", "live_music", "activities"].includes(interest)) rank += 12;
  if (intent.group === "family" && ["activities", "outdoors", "arts", "food"].includes(interest)) rank += 18;
  rank += Math.min(60, matchingKeywords(venue, intent.keywords).length * 24);
  if (intent.budget.tier === "low") rank += knownFree(venue) ? 16 : /\b(?:fine dining|steakhouse|upscale|luxury)\b/.test(text) ? -12 : 0;
  if (intent.constraints.parkingImportant) rank += /\b(?:easy|garage|lot|free parking)\b/.test(normalize(venue.parking)) ? 15 : 0;
  if (venue.activity?.confidence === "high") rank += 4;
  if (previous) {
    const distance = distanceMiles(previous, venue);
    if (distance !== null) {
      const maximum = intent.constraints.walkable ? 1.25 : 8;
      rank -= distance * (intent.constraints.walkable ? 28 : 3.5);
      if (distance <= maximum) rank += 12;
    }
  }
  return rank;
}

function durationFor(interest: NightPlanInterest) {
  if (interest === "food") return 75;
  if (interest === "events" || interest === "live_music") return 105;
  if (["activities", "outdoors", "arts", "sports", "shopping"].includes(interest)) return 80;
  if (interest === "dessert" || interest === "coffee") return 40;
  return 60;
}

function travelMinutes(left: NightPlanVenue, right: NightPlanVenue, walkable: boolean) {
  const distance = distanceMiles(left, right);
  if (distance === null) return null;
  return Math.max(4, Math.round(distance * (walkable ? 20 : 2.7) + (walkable ? 1 : 5)));
}

function timeLabel(minutes: number) {
  const normalizedMinutes = ((Math.round(minutes / 5) * 5) % 1_440 + 1_440) % 1_440;
  const hour24 = Math.floor(normalizedMinutes / 60);
  const minute = normalizedMinutes % 60;
  const hour = hour24 % 12 || 12;
  return `${hour}:${String(minute).padStart(2, "0")} ${hour24 >= 12 ? "PM" : "AM"}`;
}

function interestLabel(interest: NightPlanInterest) {
  return INTEREST_PATTERNS.find(item => item.interest === interest)?.label || interest.replaceAll("_", " ");
}

function stopWhy(venue: NightPlanVenue, interest: NightPlanInterest, intent: NightPlanIntent) {
  const reasons = [`Matches your ${interestLabel(interest)} request`];
  const keywords = matchingKeywords(venue, intent.keywords);
  if (keywords.length) reasons.push(`Matches ${keywords.slice(0, 3).join(", ")}`);
  if (intent.city && normalize(venue.city) === normalize(intent.city)) reasons.push(`Keeps the night in ${intent.city}`);
  if (venue.event?.name) reasons.push(venue.event.name);
  else if (venue.activity?.scoreMode === "live") reasons.push("Supported by fresh direct activity evidence");
  else reasons.push("Ranked from Buzz's current activity forecast");
  if (venue.openNow === true) reasons.push("Reported open now");
  return reasons.slice(0, 3);
}

function titleFor(intent: NightPlanIntent) {
  const energy = intent.energy === "quiet" ? "chill" : intent.energy === "high" ? "high-energy" : "balanced";
  const group = intent.group === "date" ? "date night" : intent.group === "family" ? "family night" : intent.group === "friends" ? "crew night" : "night out";
  return `${energy[0].toUpperCase()}${energy.slice(1)} ${intent.city ? `${intent.city} ` : "757 "}${group}`;
}

export function buildNightPlan(
  venues: readonly NightPlanVenue[],
  prompt: unknown,
  options: { now?: Date } = {},
): NightPlan {
  const now = options.now || new Date();
  const intent = parseNightPlanPrompt(prompt, now);
  const candidates = viableVenues(venues, intent);
  const selected: Array<{ venue: NightPlanVenue; interest: NightPlanInterest }> = [];
  const requestedSlots = Array.from({ length: intent.stopCount }, (_, index) => intent.interests[index % intent.interests.length]);

  for (const interest of requestedSlots) {
    const previous = selected.at(-1)?.venue || null;
    const available = candidates
      .filter(venue => !selected.some(item => item.venue.id === venue.id))
      .filter(venue => venueMatchesNightPlanInterest(venue, interest));
    const pool = available.length ? available : candidates.filter(venue => !selected.some(item => item.venue.id === venue.id));
    const best = pool
      .map(venue => ({ venue, rank: rankForIntent(venue, interest, intent, previous) }))
      .sort((left, right) => right.rank - left.rank || left.venue.name.localeCompare(right.venue.name))[0]?.venue;
    if (best) selected.push({ venue: best, interest });
  }

  let cursor = intent.startMinutes;
  const stops = selected.map((item, index) => {
    const previous = selected[index - 1]?.venue || null;
    const travel = previous ? travelMinutes(previous, item.venue, intent.constraints.walkable) : null;
    if (travel !== null) cursor += travel;
    const stop: NightPlanStop = {
      venue: item.venue,
      interest: item.interest,
      timeLabel: timeLabel(cursor),
      durationMinutes: durationFor(item.interest),
      travelMinutesFromPrevious: travel,
      why: stopWhy(item.venue, item.interest, intent),
      truthLabel: item.venue.activity?.scoreMode === "live" ? "Live activity" : "Activity forecast",
    };
    cursor += stop.durationMinutes;
    return stop;
  });
  const selectedIds = new Set(stops.map(stop => stop.venue.id));
  const backupInterest = intent.interests[0];
  const backup = candidates
    .filter(venue => !selectedIds.has(venue.id))
    .map(venue => ({ venue, rank: rankForIntent(venue, backupInterest, intent, stops.at(-1)?.venue || null) }))
    .sort((left, right) => right.rank - left.rank)[0]?.venue || null;
  const caveats: string[] = [];

  if (intent.city && !venues.some(venue => normalize(venue.city) === normalize(intent.city))) {
    caveats.push(`Buzz did not have a usable ${intent.city} option in this refresh, so the plan may use the wider 757.`);
  }
  if (intent.budget.amount !== null) {
    caveats.push(`Prices are not verified well enough to promise the full plan stays under $${intent.budget.amount}${intent.budget.perPerson ? " per person" : " total"}; check menus and ticket pages.`);
  } else if (intent.budget.tier === "low") {
    caveats.push("Price coverage is incomplete; Buzz favored known free or lower-friction options but cannot guarantee final cost.");
  }
  if (intent.constraints.accessibilityRequired) caveats.push("Accessibility details are not verified consistently yet. Call each stop before leaving to confirm the exact accommodation you need.");
  if (intent.constraints.allAgesRequired) caveats.push("Age-policy coverage is incomplete. Confirm that each stop is all-ages before leaving.");
  if (intent.constraints.walkable) caveats.push("Travel estimates use straight-line distance, not a verified walking route. Check crossings and sidewalks in Maps.");
  if (intent.dayOffset > 0) caveats.push("Buzz activity scores describe now, not tomorrow. Reopen the plan before leaving for refreshed hours and activity.");
  if (stops.some(stop => stop.venue.openNow !== true)) caveats.push("At least one stop has unconfirmed current hours. Verify hours before leaving.");
  if (!stops.length) caveats.push("No open, trustworthy match met enough of this request. Broaden the area or remove one constraint.");
  const liveStops = stops.filter(stop => stop.truthLabel === "Live activity").length;
  const forecastStops = stops.length - liveStops;
  const unmatchedKeywords = intent.keywords.filter(keyword => !stops.some(stop => matchingKeywords(stop.venue, [keyword]).length));
  if (unmatchedKeywords.length) caveats.push(`Buzz could not verify a direct match for ${unmatchedKeywords.join(", ")}; those stops are the closest available fits.`);
  if (forecastStops) caveats.push(`${forecastStops} stop${forecastStops === 1 ? " uses" : "s use"} a current activity forecast, not observed crowd size.`);

  return {
    title: titleFor(intent),
    summary: stops.length
      ? `${stops.map(stop => interestLabel(stop.interest)).join(" → ")}${intent.city ? ` in ${intent.city}` : " across the 757"}.`
      : "Buzz needs a broader request before it can make a trustworthy plan.",
    intent,
    stops,
    backup,
    backupWhy: backup ? `Backup ${interestLabel(backupInterest)} option if a stop changes.` : null,
    caveats: unique(caveats),
    liveStops,
    forecastStops,
    generatedAt: now.toISOString(),
  };
}
