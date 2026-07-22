export type DiscoveryDaypart = "day" | "night";

export const DISCOVERY_CATEGORIES = ["All", "Food", "Drinks", "Nightlife", "Events", "Outdoors", "Shopping"] as const;

export type VibeVenue = {
  category?: string | null;
  type?: string | null;
  score?: number | null;
  hasEvent?: boolean;
  trend?: string | null;
  scoreMode?: string | null;
};

export function discoveryDaypart(date = new Date()): DiscoveryDaypart {
  const hour = date.getHours();
  return hour >= 6 && hour < 16 ? "day" : "night";
}

export function orderedDiscoveryCategories(daypart: DiscoveryDaypart) {
  return daypart === "day"
    ? ["All", "Food", "Shopping", "Outdoors", "Events", "Drinks", "Nightlife"]
    : ["All", "Nightlife", "Drinks", "Events", "Food", "Shopping", "Outdoors"];
}

function normalized(value: unknown) {
  return String(value || "").toLowerCase();
}

export function contextualVibe(venue: VibeVenue, daypart: DiscoveryDaypart) {
  const category = normalized(venue.category);
  const type = normalized(venue.type);
  const score = Number(venue.score) || 0;
  const trend = normalized(venue.trend);
  const truth = normalized(venue.scoreMode) === "live" ? "live" : "forecast";

  if (daypart === "day") {
    if (category.includes("outdoor") || type.includes("park") || type.includes("beach")) {
      return { label: "🌳 Good outdoor window", truth };
    }
    if (category.includes("shopping") || type.includes("mall")) {
      return { label: score >= 68 ? "🛍️ Shopping crowd building" : "🛍️ Easy shopping window", truth };
    }
    if (type.includes("museum") || category.includes("arts") || category.includes("culture")) {
      return { label: "🎨 Museum activity", truth };
    }
    if (category.includes("food") || type.includes("cafe") || type.includes("restaurant")) {
      if (score >= 72 || trend.includes("rising")) return { label: "🥞 Brunch crowd", truth };
      return { label: "☕ Easy daytime vibe", truth };
    }
    if (score >= 78) return { label: "☀️ High energy", truth };
    if (score <= 45) return { label: "☕ Quiet daytime vibe", truth };
    return { label: "☀️ Daytime activity", truth };
  }

  if (venue.hasEvent && (type.includes("music") || category.includes("nightlife") || category.includes("event"))) {
    return { label: "🎵 Live event energy", truth };
  }
  if (category.includes("nightlife") || type.includes("nightclub") || type.includes("bar")) {
    if (score >= 82) return { label: "🌙 Peak crowd", truth };
    if (trend.includes("rising") || score >= 68) return { label: "🔥 Nightlife rising", truth };
    return { label: "🍸 Drinks starting", truth };
  }
  if (category.includes("drinks")) return { label: score >= 68 ? "🍸 Drinks picking up" : "🍹 Easy drinks vibe", truth };
  if (venue.hasEvent) return { label: "🎟️ Event activity", truth };
  if (score >= 82) return { label: "🌙 Peak crowd", truth };
  if (trend.includes("rising")) return { label: "🔥 Rising fast", truth };
  return { label: "🌙 Evening activity", truth };
}
