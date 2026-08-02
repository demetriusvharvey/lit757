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

export type ContextualVibe = {
  label: string;
  truth: "live" | "forecast";
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

export function contextualVibe(
  venue: VibeVenue,
  daypart: DiscoveryDaypart,
): ContextualVibe {
  const category = normalized(venue.category);
  const type = normalized(venue.type);
  const score = Number(venue.score) || 0;
  const trend = normalized(venue.trend);
  const truth: ContextualVibe["truth"] =
    normalized(venue.scoreMode) === "live" ? "live" : "forecast";
  const truthful = (liveLabel: string, forecastLabel: string) =>
    truth === "live" ? liveLabel : forecastLabel;

  if (daypart === "day") {
    if (category.includes("outdoor") || type.includes("park") || type.includes("beach")) {
      return { label: "🌳 Good outdoor window", truth };
    }
    if (category.includes("shopping") || type.includes("mall")) {
      return { label: score >= 68 ? truthful("🛍️ Shopping crowd building", "🛍️ Shopping activity forecast") : "🛍️ Easy shopping window", truth };
    }
    if (type.includes("museum") || category.includes("arts") || category.includes("culture")) {
      return { label: truthful("🎨 Museum activity", "🎨 Museum activity forecast"), truth };
    }
    if (category.includes("food") || type.includes("cafe") || type.includes("restaurant")) {
      if (score >= 72 || trend.includes("rising")) return { label: truthful("🥞 Brunch crowd", "🥞 Brunch demand forecast"), truth };
      return { label: "☕ Easy daytime vibe", truth };
    }
    if (score >= 78) return { label: truthful("☀️ High live activity", "☀️ High activity forecast"), truth };
    if (score <= 45) return { label: truthful("☕ Quiet daytime vibe", "☕ Low daytime forecast"), truth };
    return { label: truthful("☀️ Daytime activity", "☀️ Daytime forecast"), truth };
  }

  if (venue.hasEvent && (type.includes("music") || category.includes("nightlife") || category.includes("event"))) {
    return { label: truthful("🎵 Live event energy", "🎵 Music event forecast"), truth };
  }
  if (category.includes("nightlife") || type.includes("nightclub") || type.includes("bar")) {
    if (score >= 82) return { label: truthful("🌙 Peak crowd", "🌙 Peak-time forecast"), truth };
    if (trend.includes("rising") || score >= 68) return { label: truthful("🔥 Nightlife rising", "🔥 Strong nightlife forecast"), truth };
    return { label: "🍸 Drinks starting", truth };
  }
  if (category.includes("drinks")) return { label: score >= 68 ? truthful("🍸 Drinks picking up", "🍸 Drinks activity forecast") : "🍹 Easy drinks vibe", truth };
  if (venue.hasEvent) return { label: truthful("🎟️ Event activity", "🎟️ Event activity forecast"), truth };
  if (score >= 82) return { label: truthful("🌙 Peak crowd", "🌙 Peak-time forecast"), truth };
  if (trend.includes("rising")) return { label: truthful("🔥 Rising fast", "🔥 Forecast rising"), truth };
  return { label: truthful("🌙 Evening activity", "🌙 Evening forecast"), truth };
}
