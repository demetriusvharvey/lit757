export type IntegrationState =
  | "live"
  | "partial"
  | "ready"
  | "needs-key"
  | "conditional"
  | "native-only"
  | "planned";

export type IntegrationCategory =
  | "Maps & venue intelligence"
  | "Platform"
  | "Events & calendars"
  | "Environment & mobility"
  | "Community signals"
  | "Growth & sharing"
  | "AI & agents"
  | "Operations";

export type IntegrationRole =
  | "platform"
  | "discovery"
  | "forecast-context"
  | "direct-evidence"
  | "growth"
  | "operations";

export type IntegrationDefinition = {
  id: string;
  name: string;
  category: IntegrationCategory;
  state: IntegrationState;
  role: IntegrationRole;
  detail: string;
  env?: string[];
};

export const BUZZ_INTEGRATIONS: IntegrationDefinition[] = [
  { id: "mapbox", name: "Mapbox", category: "Maps & venue intelligence", state: "live", role: "platform", detail: "Primary map rendering, heat layers, venue pins, clustering, and navigation controls.", env: ["NEXT_PUBLIC_MAPBOX_TOKEN"] },
  { id: "google-places", name: "Google Places API", category: "Maps & venue intelligence", state: "live", role: "discovery", detail: "Venue identity, place metadata, photos, and enrichment.", env: ["GOOGLE_PLACES_API_KEY"] },
  { id: "google-street-view", name: "Google Street View API", category: "Maps & venue intelligence", state: "ready", role: "discovery", detail: "Configured interface for venue-area imagery; production usage should remain cost-controlled.", env: ["GOOGLE_STREET_VIEW_API_KEY"] },
  { id: "osm-overpass", name: "OpenStreetMap / Overpass", category: "Maps & venue intelligence", state: "live", role: "discovery", detail: "Open venue discovery and enrichment with protected dry-run monitoring.", env: ["OVERPASS_API_URL"] },
  { id: "tomtom", name: "TomTom", category: "Maps & venue intelligence", state: "partial", role: "forecast-context", detail: "Traffic and district movement support exists; coverage depends on production key and provider availability.", env: ["TOMTOM_API_KEY"] },
  { id: "brandfetch", name: "Brandfetch", category: "Maps & venue intelligence", state: "ready", role: "discovery", detail: "Logo enrichment with official-site icon fallback when Brandfetch is unavailable.", env: ["BRANDFETCH_CLIENT_ID"] },

  { id: "supabase", name: "Supabase", category: "Platform", state: "live", role: "platform", detail: "Primary database, authentication, persisted signals, scores, favorites, subscriptions, and event storage.", env: ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"] },
  { id: "vercel", name: "Vercel", category: "Platform", state: "live", role: "platform", detail: "Application hosting, server routes, previews, scheduled deployment validation, and production delivery." },

  { id: "ticketmaster", name: "Ticketmaster Discovery API", category: "Events & calendars", state: "live", role: "forecast-context", detail: "Ticketed event discovery and demand context; never direct occupancy.", env: ["TICKETMASTER_API_KEY"] },
  { id: "eventbrite", name: "Eventbrite", category: "Events & calendars", state: "needs-key", role: "forecast-context", detail: "Organization and venue event ingestion requires a private token and access validation.", env: ["EVENTBRITE_PRIVATE_TOKEN"] },
  { id: "seatgeek", name: "SeatGeek", category: "Events & calendars", state: "needs-key", role: "forecast-context", detail: "Planned event, venue, performer, listing-count, and price-range adapter.", env: ["SEATGEEK_CLIENT_ID", "SEATGEEK_CLIENT_SECRET"] },
  { id: "city-calendars", name: "Official city event calendars", category: "Events & calendars", state: "live", role: "discovery", detail: "First-party Hampton Roads municipal calendars with source-level degraded-state reporting." },
  { id: "university-calendars", name: "Official university calendars", category: "Events & calendars", state: "live", role: "discovery", detail: "First-party university programming normalized into the shared event model." },
  { id: "venue-calendars", name: "Official venue calendars", category: "Events & calendars", state: "partial", role: "discovery", detail: "Arena, arts, museum, attraction, and festival calendars; failed adapters remain visible." },
  { id: "tourism-calendars", name: "Tourism and destination calendars", category: "Events & calendars", state: "partial", role: "discovery", detail: "VisitNorfolk, Visit Hampton, and Visit Newport News are live and monitored; remaining regional tourism sources are pending accessible official feeds." },
  { id: "ics-feeds", name: "ICS calendar feeds", category: "Events & calendars", state: "ready", role: "discovery", detail: "Configurable first-party venue and local calendar feeds.", env: ["LOCAL_EVENT_FEEDS_JSON"] },

  { id: "nws", name: "National Weather Service", category: "Environment & mobility", state: "live", role: "forecast-context", detail: "Forecasts, hourly conditions, alerts, and outdoor-arrival qualification." },
  { id: "noaa", name: "NOAA CO-OPS", category: "Environment & mobility", state: "live", role: "forecast-context", detail: "Tides, coastal stations, and observations where supported; cannot make a venue Live." },
  { id: "airnow", name: "AirNow", category: "Environment & mobility", state: "needs-key", role: "forecast-context", detail: "Planned current AQI and forecast qualification for outdoor recommendations.", env: ["AIRNOW_API_KEY"] },
  { id: "nps", name: "National Park Service API", category: "Environment & mobility", state: "needs-key", role: "discovery", detail: "Planned regional park events, alerts, closures, visitor centers, and things to do.", env: ["NPS_API_KEY"] },
  { id: "hrt-gtfs", name: "Hampton Roads Transit GTFS", category: "Environment & mobility", state: "live", role: "forecast-context", detail: "Official route and stop network for transportation context." },
  { id: "hrt-realtime", name: "HRT GTFS-Realtime", category: "Environment & mobility", state: "live", role: "forecast-context", detail: "Official trip updates and service alerts." },
  { id: "hrt-vehicles", name: "HRT vehicle positions", category: "Environment & mobility", state: "conditional", role: "forecast-context", detail: "Parser is ready; activation waits for an official published or authorized feed." },
  { id: "gbfs", name: "GBFS bike and scooter feeds", category: "Environment & mobility", state: "conditional", role: "forecast-context", detail: "Enable only when a Hampton Roads operator publishes a public GBFS feed." },
  { id: "gdelt", name: "GDELT", category: "Environment & mobility", state: "planned", role: "discovery", detail: "Weak local news and announcement context with strict entity, location, and source-quality checks." },

  { id: "user-reports", name: "User live reports", category: "Community signals", state: "live", role: "direct-evidence", detail: "Nearby verified crowd votes calibrate and update current Buzz activity." },
  { id: "anonymous-nearby", name: "Anonymous nearby activity signals", category: "Community signals", state: "partial", role: "direct-evidence", detail: "Signal snapshot model exists; privacy-preserving production coverage is still expanding." },
  { id: "favorites", name: "Favorites and saved venues", category: "Community signals", state: "live", role: "growth", detail: "Local and account-connected venue saving for repeat discovery." },
  { id: "push", name: "Push notifications", category: "Community signals", state: "live", role: "growth", detail: "Heating-up alerts, watched venues, and Invite the Crew actions." },

  { id: "web-share", name: "Web Share API", category: "Growth & sharing", state: "live", role: "growth", detail: "Native device sharing with generated Story image support and browser fallbacks." },
  { id: "instagram-stories", name: "Instagram Sharing to Stories", category: "Growth & sharing", state: "native-only", role: "growth", detail: "Requires a native mobile shell; web currently uses the operating-system share sheet." },
  { id: "tiktok-share", name: "TikTok Share Kit", category: "Growth & sharing", state: "native-only", role: "growth", detail: "Requires a native mobile shell and TikTok integration approval." },
  { id: "sms-deep-links", name: "SMS and deep-link sharing", category: "Growth & sharing", state: "live", role: "growth", detail: "Exact venue links, SMS fallback, copy link, and downloadable Story cards." },
  { id: "referral-tracking", name: "Referral tracking", category: "Growth & sharing", state: "partial", role: "growth", detail: "Referral IDs and share-to-venue-view funnel tracking are implemented; durable persistence begins after the included Supabase migration is applied." },

  { id: "ai-recommendations", name: "AI recommendations", category: "AI & agents", state: "live", role: "discovery", detail: "Personalized and contextual venue recommendations using current Buzz inputs." },
  { id: "ai-city-summaries", name: "AI city summaries", category: "AI & agents", state: "live", role: "discovery", detail: "City-level activity summaries with provider-backed context." },
  { id: "vercel-ai-gateway", name: "Vercel AI Gateway", category: "AI & agents", state: "planned", role: "platform", detail: "Planned model routing, observability, and provider resilience layer.", env: ["AI_GATEWAY_API_KEY"] },
  { id: "event-agent", name: "Event Agent", category: "AI & agents", state: "planned", role: "discovery", detail: "Planned agent for event discovery, normalization, and source reconciliation." },
  { id: "ticket-agent", name: "Ticket Agent", category: "AI & agents", state: "planned", role: "forecast-context", detail: "Planned ticket-demand and availability reasoning across approved providers." },
  { id: "website-agent", name: "Website Agent", category: "AI & agents", state: "planned", role: "discovery", detail: "Planned first-party venue website extraction and source verification." },
  { id: "hours-agent", name: "Hours Agent", category: "AI & agents", state: "planned", role: "forecast-context", detail: "Planned hours reconciliation and confidence scoring." },
  { id: "reservation-agent", name: "Reservation Agent", category: "AI & agents", state: "planned", role: "forecast-context", detail: "Planned reservation-availability context through supported partners." },
  { id: "social-buzz-agent", name: "Social Buzz Agent", category: "AI & agents", state: "planned", role: "forecast-context", detail: "Planned weak social/context signal analysis with strict caps and no occupancy claims." },

  { id: "provider-health", name: "Provider health monitoring", category: "Operations", state: "live", role: "operations", detail: "Source-level health, degraded-state warnings, scheduled smoke tests, saved artifacts, and a live operations dashboard." },
  { id: "analytics", name: "Analytics and conversion tracking", category: "Operations", state: "partial", role: "operations", detail: "Share, fallback, referral-open, venue-view, favorite, and watch tracking is implemented; persistence is migration-gated and remains non-blocking until enabled." },
];

export function integrationConfigured(integration: IntegrationDefinition, env = process.env) {
  if (!integration.env?.length) return integration.state === "live";
  return integration.env.every(key => Boolean(env[key]));
}

export function integrationSnapshot(env = process.env) {
  return BUZZ_INTEGRATIONS.map(integration => ({
    ...integration,
    configured: integrationConfigured(integration, env),
  }));
}
