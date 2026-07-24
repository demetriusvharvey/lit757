"use client";

import {
  MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Session } from "@supabase/supabase-js";
import "mapbox-gl/dist/mapbox-gl.css";
import "./buzz-map-app.css";
import "./buzz-map-notifications.css";
import {
  Bell,
  CalendarDays,
  Compass,
  Heart,
  LocateFixed,
  MapPin,
  Music2,
  Navigation,
  Phone,
  Search,
  Share2,
  Copy,
  MessageCircle,
  Download,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  TreePine,
  UserRound,
  Utensils,
  Wine,
  X,
} from "lucide-react";
import { getVenueLogo } from "../src/lib/venue-logo";
import {
  buildInviteCrewText,
  buildInviteCrewUrl,
  buildStoryCardUrl,
} from "../src/lib/invite-the-crew";
import {
  createReferralId,
  referralContext,
  trackConversion,
} from "../src/lib/conversion-analytics";
import {
  contextualVibe,
  discoveryDaypart,
  orderedDiscoveryCategories,
  type DiscoveryDaypart,
} from "../src/lib/adaptive-discovery";
import {
  DEFAULT_BUZZ_CENTER as DEFAULT_CENTER,
  formatEventTime,
  getBrowserPosition as getPosition,
  hasValidVenueCoordinates as validVenue,
  milesLabel,
  todayHours,
  venueCategory as categoryFor,
  venueCoordinates as coordinates,
  venueScore as score,
  venueStatus as statusFor,
  type BuzzCategory as Category,
  type BuzzVenue as Venue,
  type CrowdLevel,
  type LoadRequest,
  type NearbyPayload,
  type VenueDetail,
  type VotePayload,
} from "./buzz-map-model";
import {
  ALL_LOGO_MIN_ZOOM,
  FEATURED_LOGO_MIN_ZOOM,
} from "./buzz-map-presentation";
import { useBuzzMapbox } from "./hooks/use-buzz-mapbox";
import { RemoteVenueImage } from "./components/remote-venue-image";
import { BuzzVenueList } from "./components/buzz-venue-list";

const categories = [
  ["All", Compass],
  ["Food", Utensils],
  ["Drinks", Wine],
  ["Nightlife", Music2],
  ["Events", CalendarDays],
  ["Outdoors", TreePine],
  ["Shopping", ShoppingBag],
] as const;

const crowdOptions: Array<{ level: CrowdLevel; label: string; emoji: string }> = [
  { level: "quiet", label: "Quiet", emoji: "😌" },
  { level: "steady", label: "Steady", emoji: "🙂" },
  { level: "busy", label: "Busy", emoji: "🔥" },
  { level: "packed", label: "Packed", emoji: "🚨" },
];

const FAVORITES_KEY = "lit757-mobile-favorites";
const ALERTS_KEY = "lit757-mobile-alerts";
const VENUE_ALERTS_KEY = "lit757-venue-alerts";
const logoKeyFor = (venue: Venue) => `venue-logo-${String(venue.id).replace(/[^a-zA-Z0-9_-]/g, "")}`;
const logoUrlFor = (venue: Pick<Venue, "name" | "website">) => getVenueLogo({ name: venue.name, website: venue.website });

export default function BuzzMapApp() {
  const [venues, setVenues] = useState<Venue[]>([]);
  const [active, setActive] = useState<Category>("All");
  const [query, setQuery] = useState("");
  const [scopeLabel, setScopeLabel] = useState("Hampton Roads");
  const [selected, setSelected] = useState<Venue | null>(null);
  const [detail, setDetail] = useState<VenueDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [daypart, setDaypart] = useState<DiscoveryDaypart>(() => discoveryDaypart());
  const [listExpanded, setListExpanded] = useState(false);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(() => new Set());
  const [watchedIds, setWatchedIds] = useState<Set<string>>(() => new Set());
  const [session, setSession] = useState<Session | null>(null);
  const [voting, setVoting] = useState(false);
  const [voteMessage, setVoteMessage] = useState("");
  const [watchMessage, setWatchMessage] = useState("");
  const [shareMessage, setShareMessage] = useState("");
  const [sharing, setSharing] = useState(false);
  const [reward, setReward] = useState<{ points: number; total: number | null } | null>(null);

  const requestSequenceRef = useRef(0);
  const deepLinkHandledRef = useRef(false);

  const loadNearby = useCallback(async (request: LoadRequest = {}) => {
    const sequence = ++requestSequenceRef.current;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ limit: "400" });
      if (request.lat != null) params.set("lat", String(request.lat));
      if (request.lng != null) params.set("lng", String(request.lng));
      if (request.radius != null) params.set("radius", String(request.radius));
      if (request.bounds) params.set("bounds", request.bounds);
      const response = await fetch(`/api/nearby?${params.toString()}`, { cache: "no-store" });
      const payload = await response.json() as NearbyPayload;
      if (!response.ok || payload.success === false) throw new Error(payload.error || "Could not load places");
      if (sequence !== requestSequenceRef.current) return;
      setVenues(payload.venues || payload.picks || []);
      setScopeLabel(request.label || payload.scope?.label || "Hampton Roads");
      window.dispatchEvent(new CustomEvent("activity757:discovery", { detail: payload }));
    } catch (loadError) {
      if (sequence !== requestSequenceRef.current) return;
      setError(loadError instanceof Error ? loadError.message : "Could not load places");
    } finally {
      if (sequence === requestSequenceRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const syncDaypart = () => setDaypart(discoveryDaypart());
    syncDaypart();
    const timer = window.setInterval(syncDaypart, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const orderedCategories = useMemo(() => orderedDiscoveryCategories(daypart)
    .map(label => categories.find(([candidate]) => candidate === label))
    .filter((item): item is typeof categories[number] => Boolean(item)), [daypart]);

  const filtered = useMemo(() => {
    const clean = query.trim().toLowerCase();
    return [...venues]
      .filter(venue => active === "All" || categoryFor(venue) === active)
      .filter(venue => !clean || `${venue.name} ${venue.city || ""} ${venue.type || ""} ${venue.category || ""} ${venue.event?.name || ""}`.toLowerCase().includes(clean))
      .sort((left, right) => score(right) - score(left) || (left.distanceMiles ?? 999) - (right.distanceMiles ?? 999));
  }, [venues, active, query]);

  const vibeFor = useCallback((venue: Venue) => contextualVibe({
    category: categoryFor(venue),
    type: venue.type || venue.kind,
    score: score(venue),
    hasEvent: Boolean(venue.event?.name),
    trend: venue.activity?.trendLabel,
    scoreMode: venue.activity?.scoreMode,
  }, daypart), [daypart]);

  const selectVenue = useCallback((id: string) => {
    const venue = venues.find(item => String(item.id) === String(id));
    if (!venue) return;
    setSelected(venue);
    setVoteMessage("");
    setWatchMessage("");
    const context = referralContext(window.location.href);
    void trackConversion({
      eventName: "venue_view",
      venueId: venue.id,
      referralId: context.referralId,
      source: context.isInvite ? "invite-the-crew" : "buzz-map",
      truthMode: venue.activity?.scoreMode || "forecast",
      metadata: {
        entry: context.isInvite ? "shared-link" : "map",
        selectedFilter: active,
      },
    }, session?.access_token);
  }, [venues, active, session?.access_token]);

  const {
    mapElementRef: mapEl,
    mapRef,
    mapZoom,
  } = useBuzzMapbox({
    venues: filtered,
    selectedVenueId: selected?.id,
    onSelectVenue: selectVenue,
    logoKeyFor,
    logoUrlFor,
  });

  useEffect(() => {
    document.body.classList.add("buzz-map-active");
    try {
      // Browser storage is hydrated after SSR so the server and first client
      // render remain deterministic.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFavoriteIds(new Set(JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]") as string[]));
      const alerts = JSON.parse(localStorage.getItem(VENUE_ALERTS_KEY) || "[]") as Array<{ venueId: string }>;
      setWatchedIds(new Set(alerts.map(item => item.venueId)));
    } catch {
      // Safe defaults.
    }

    void loadNearby();
    void getPosition().then(position => {
      const latitude = position.coords.latitude;
      const longitude = position.coords.longitude;
      mapRef.current?.easeTo({ center: [longitude, latitude], zoom: 12.2, duration: 700 });
      void loadNearby({ lat: latitude, lng: longitude, radius: 10, label: "near you" });
    }).catch(() => undefined);

    let unsubscribe: (() => void) | null = null;
    const bootAuth = async () => {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!url || !key) return;
      const { createClient } = await import("@supabase/supabase-js");
      const client = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
      const { data } = await client.auth.getSession();
      setSession(data.session);
      const listener = client.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
      unsubscribe = () => listener.data.subscription.unsubscribe();
    };
    void bootAuth();

    return () => {
      document.body.classList.remove("buzz-map-active");
      unsubscribe?.();
    };
  }, [loadNearby, mapRef]);

  useEffect(() => {
    if (!selected || !validVenue(selected)) return;
    mapRef.current?.easeTo({
      center: coordinates(selected),
      zoom: Math.max(13.2, mapRef.current.getZoom()),
      duration: 500,
    });
  }, [mapRef, selected]);

  useEffect(() => {
    if (deepLinkHandledRef.current || !venues.length) return;
    const params = new URLSearchParams(window.location.search);
    const venueId = params.get("venue");
    if (!venueId || !venues.some(venue => String(venue.id) === venueId)) return;
    deepLinkHandledRef.current = true;
    const context = referralContext(window.location.href);
    if (context.isInvite) {
      void trackConversion({
        eventName: "shared_link_open",
        venueId,
        referralId: context.referralId,
        source: context.source,
        truthMode: context.truthMode,
        metadata: { entry: "shared-link" },
      }, session?.access_token);
    }
    // URL state intentionally initializes the selected venue after discovery
    // data arrives.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    selectVenue(venueId);
    if (params.get("invite") === "1") {
      setShareMessage("This place is ready to share. Tap Invite the Crew to open your phone’s share sheet.");
    }
  }, [venues, selectVenue, session?.access_token]);

  useEffect(() => {
    if (!selected) {
      // Details are scoped to the selected venue and must not leak to the
      // next panel while its request is in flight.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDetail(null);
      return;
    }
    let cancelled = false;
    void fetch(`/api/venue-detail?id=${encodeURIComponent(selected.id)}`, { cache: "no-store" })
      .then(response => response.ok ? response.json() : null)
      .then(payload => { if (!cancelled && payload?.venue) setDetail(payload.venue as VenueDetail); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [selected]);

  async function requestMyLocation() {
    try {
      const position = await getPosition();
      const latitude = position.coords.latitude;
      const longitude = position.coords.longitude;
      mapRef.current?.easeTo({ center: [longitude, latitude], zoom: 12.4, duration: 650 });
      await loadNearby({ lat: latitude, lng: longitude, radius: 10, label: "near you" });
    } catch {
      setError("Location access is required to find nearby activity");
    }
  }

  async function searchThisMap() {
    const bounds = mapRef.current?.getBounds();
    if (!bounds) return;
    await loadNearby({
      bounds: [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()].join(","),
      label: "in this map area",
    });
  }

  async function submitVote(level: CrowdLevel) {
    if (!selected) return;
    if (!session) {
      window.dispatchEvent(new Event("lit757:open-notification-auth"));
      setVoteMessage("Sign in first so votes stay trustworthy.");
      return;
    }
    setVoting(true);
    setVoteMessage("Verifying that you’re at the venue…");
    try {
      const position = await getPosition();
      const response = await fetch("/api/buzz/report", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          venueId: selected.id,
          crowdLevel: level,
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          gpsAccuracyMeters: position.coords.accuracy,
        }),
      });
      const payload = await response.json() as VotePayload;
      if (!response.ok) throw new Error(payload.error || "Could not submit your vote");
      if (!payload.verifiedNearby) {
        setVoteMessage(payload.message || "Vote saved, but you were not close enough for it to affect Buzz.");
        return;
      }

      const nextScore = Number(payload.buzz?.score ?? score(selected));
      const update = (venue: Venue): Venue => venue.id === selected.id ? {
        ...venue,
        reason: "A verified local vote just updated this place.",
        activity: {
          ...(venue.activity || { score: nextScore, label: payload.buzz?.label || statusFor(venue), trendLabel: "Verified vote" }),
          score: nextScore,
          label: payload.buzz?.label || venue.activity?.label || statusFor(venue),
          trendLabel: "Verified local vote",
          scoreMode: "live",
          confidence: payload.buzz?.confidence || venue.activity?.confidence,
        },
      } : venue;
      setVenues(current => current.map(update));
      setSelected(current => current ? update(current) : current);
      setVoteMessage(`Verified. ${payload.reportCount || 1} live report${payload.reportCount === 1 ? "" : "s"} now influence Buzz.`);
      if (payload.pointsAwarded) setReward({ points: payload.pointsAwarded, total: payload.totalPoints ?? null });
    } catch (voteError) {
      setVoteMessage(voteError instanceof Error ? voteError.message : "Could not submit your vote");
    } finally {
      setVoting(false);
    }
  }

  function toggleFavorite(event: ReactMouseEvent, venue: Venue) {
    event.stopPropagation();
    setFavoriteIds(current => {
      const next = new Set(current);
      if (next.has(venue.id)) next.delete(venue.id);
      else next.add(venue.id);
      localStorage.setItem(FAVORITES_KEY, JSON.stringify([...next]));
      return next;
    });
  }

  async function enableNotifications() {
    if (!("Notification" in window)) return;
    const permission = await Notification.requestPermission();
    if (permission === "granted") {
      localStorage.setItem(ALERTS_KEY, "enabled");
      new Notification("Buzz alerts enabled", { body: "We’ll tell you when saved places start heating up." });
    }
  }

  const selectedWebsite = detail?.website || selected?.website || null;
  const selectedAddress = detail?.address || selected?.address || null;
  const selectedHours = todayHours(detail?.hours);
  const selectedVibe = selected ? vibeFor(selected) : null;

  async function copyInviteLink(venue: Venue) {
    const referralId = createReferralId();
    const url = buildInviteCrewUrl(venue.id, referralId, venue.activity?.scoreMode || "forecast");
    try {
      await navigator.clipboard.writeText(url);
      setShareMessage("Invite link copied.");
      void trackConversion({ eventName: "share_copy", venueId: venue.id, referralId, source: "invite-the-crew", truthMode: venue.activity?.scoreMode || "forecast" }, session?.access_token);
    } catch {
      setShareMessage("Copy failed. Use your browser’s Share action.");
    }
  }

  function textCrew(venue: Venue) {
    const referralId = createReferralId();
    const url = buildInviteCrewUrl(venue.id, referralId, venue.activity?.scoreMode || "forecast");
    const message = buildInviteCrewText(venue.name, statusFor(venue), venue.event?.name, url);
    window.location.href = `sms:?&body=${encodeURIComponent(message)}`;
    void trackConversion({ eventName: "share_sms", venueId: venue.id, referralId, source: "invite-the-crew", truthMode: venue.activity?.scoreMode || "forecast" }, session?.access_token);
  }

  async function shareWithCrew(venue: Venue) {
    const referralId = createReferralId();
    const url = buildInviteCrewUrl(venue.id, referralId, venue.activity?.scoreMode || "forecast");
    const storyUrl = buildStoryCardUrl(venue.id, referralId);
    setSharing(true);
    setShareMessage("");
    try {
      const response = await fetch(storyUrl, { cache: "no-store" });
      if (!response.ok) throw new Error("Could not build the Story card");
      const blob = await response.blob();
      const file = new File([blob], `buzz-${venue.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`, { type: "image/png" });
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ title: `${venue.name} is ${statusFor(venue)}`, text: buildInviteCrewText(venue.name, statusFor(venue), venue.event?.name, url), url, files: [file] });
        setShareMessage("Shared with the crew.");
        void trackConversion({ eventName: "share_native", venueId: venue.id, referralId, source: "invite-the-crew", truthMode: venue.activity?.scoreMode || "forecast", metadata: { media: "story-card" } }, session?.access_token);
      } else if (navigator.share) {
        await navigator.share({ title: `${venue.name} is ${statusFor(venue)}`, text: buildInviteCrewText(venue.name, statusFor(venue), venue.event?.name, url), url });
        setShareMessage("Shared with the crew.");
        void trackConversion({ eventName: "share_native", venueId: venue.id, referralId, source: "invite-the-crew", truthMode: venue.activity?.scoreMode || "forecast", metadata: { media: "link" } }, session?.access_token);
      } else {
        await navigator.clipboard.writeText(url);
        setShareMessage("Link copied. Your browser does not support direct sharing.");
        void trackConversion({ eventName: "share_fallback", venueId: venue.id, referralId, source: "invite-the-crew", truthMode: venue.activity?.scoreMode || "forecast" }, session?.access_token);
      }
    } catch (shareError) {
      if ((shareError as Error)?.name !== "AbortError") setShareMessage(shareError instanceof Error ? shareError.message : "Could not share this venue");
    } finally {
      setSharing(false);
    }
  }

  async function downloadStoryCard(venue: Venue) {
    const referralId = createReferralId();
    const storyUrl = buildStoryCardUrl(venue.id, referralId);
    setSharing(true);
    try {
      const response = await fetch(storyUrl, { cache: "no-store" });
      if (!response.ok) throw new Error("Could not build the Story card");
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = `buzz-${venue.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`;
      anchor.click();
      URL.revokeObjectURL(objectUrl);
      setShareMessage("Story card saved.");
      void trackConversion({ eventName: "share_download", venueId: venue.id, referralId, source: "invite-the-crew", truthMode: venue.activity?.scoreMode || "forecast" }, session?.access_token);
    } catch (downloadError) {
      setShareMessage(downloadError instanceof Error ? downloadError.message : "Could not save the Story card");
    } finally {
      setSharing(false);
    }
  }

  const toggleVenueWatch = () => {
    if (!selected) return;
    const next = new Set(watchedIds);
    const wasWatched = next.has(selected.id);
    if (wasWatched) next.delete(selected.id);
    else next.add(selected.id);
    setWatchedIds(next);
    localStorage.setItem(VENUE_ALERTS_KEY, JSON.stringify([...next].map(venueId => ({ venueId }))));
    setWatchMessage(wasWatched ? "Buzz alerts turned off for this place." : "We’ll alert you when this place starts heating up.");
  };

  return (
    <div className={`buzz-map-app ${daypart === "day" ? "daytime" : "nighttime"}`}>
      <header className="buzz-map-header">
        <button type="button" className="buzz-map-brand" onClick={() => { mapRef.current?.easeTo({ center: DEFAULT_CENTER, zoom: 8.8, duration: 600 }); void loadNearby(); }}>
          <strong>BUZZ</strong><span>THINGS TO DO NOW</span>
        </button>
        <label className="buzz-map-search"><Search /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search places, events, or neighborhoods" />{query && <button type="button" onClick={() => setQuery("")} aria-label="Clear search"><X /></button>}</label>
        <div className="buzz-map-header-actions">
          <button type="button" onClick={() => void requestMyLocation()}><LocateFixed /><span>Near me</span></button>
          <button type="button" aria-label="Enable Buzz alerts" onClick={() => void enableNotifications()}><Bell /></button>
          <button type="button" aria-label="Profile"><UserRound /></button>
        </div>
      </header>

      <nav className="buzz-map-filters" aria-label="Filter places">
        {orderedCategories.map(([label, Icon]) => <button type="button" key={label} className={active === label ? "active" : ""} onClick={() => setActive(label)} aria-pressed={active === label}><Icon /><span>{label}</span></button>)}
      </nav>

      <main className="buzz-map-layout">
        <BuzzVenueList
          activeCategory={active}
          venues={filtered}
          selectedVenueId={selected?.id}
          favoriteIds={favoriteIds}
          expanded={listExpanded}
          loading={loading}
          scopeLabel={scopeLabel}
          logoUrlFor={logoUrlFor}
          vibeFor={vibeFor}
          onToggleExpanded={() => setListExpanded(current => !current)}
          onSelectVenue={selectVenue}
          onToggleFavorite={toggleFavorite}
        />

        <section className="buzz-map-stage" aria-label="Buzz activity map">
          <div ref={mapEl} className="buzz-map-canvas" />
          <div className="buzz-map-toolbar">
            <button type="button" onClick={() => void requestMyLocation()}><LocateFixed /> Near me</button>
            <button type="button" onClick={() => void searchThisMap()}><Search /> Search this map</button>
          </div>
          <div className="buzz-map-mode">
            {mapZoom < FEATURED_LOGO_MIN_ZOOM
              ? <><Sparkles /><span>City pulse</span><small>Tap a hot zone or zoom in for places</small></>
              : mapZoom < ALL_LOGO_MIN_ZOOM
                ? <><Sparkles /><span>Top places</span><small>Hottest venue logos first</small></>
                : <><MapPin /><span>Venue logos</span><small>Tap a logo to see what’s happening</small></>}
          </div>
          {loading && <div className="buzz-map-loading"><i /> Updating Buzz</div>}
          {error && <button type="button" className="buzz-map-error" onClick={() => void loadNearby()}>{error} · Retry</button>}
        </section>
      </main>

      {selected && (
        <aside className="buzz-venue-detail">
          <button type="button" className="buzz-detail-close" onClick={() => setSelected(null)} aria-label="Close venue"><X /></button>
          <div className="buzz-detail-photo"><RemoteVenueImage src={getVenueLogo({ name: selected.name, website: selectedWebsite })} alt={`${selected.name} logo`} fallback={selected.name.slice(0, 1)} width={640} height={360} sizes="(max-width: 1023px) 100vw, 420px" priority /><div><b>{score(selected)}</b><small>BUZZ</small></div></div>
          <div className="buzz-detail-body">
            <div className="buzz-detail-title"><div><small>{statusFor(selected).toUpperCase()} · {selected.activity?.scoreMode === "live" ? "LIVE" : "FORECAST"}</small><h2>{selected.name}</h2><p><MapPin /> {milesLabel(selected.distanceMiles) || selected.city || "Nearby"}{selected.area?.shortName ? ` · ${selected.area.shortName}` : ""}</p></div><button type="button" className={favoriteIds.has(selected.id) ? "saved" : ""} onClick={event => toggleFavorite(event, selected)}><Heart fill={favoriteIds.has(selected.id) ? "currentColor" : "none"} /></button></div>

            {selectedVibe && <div className={`buzz-detail-vibe ${selectedVibe.truth}`}><span>{selectedVibe.label}</span><b>{selectedVibe.truth === "live" ? "LIVE" : "FORECAST"}</b></div>}
            <div className="buzz-detail-reason"><Sparkles /><div><strong>Why Buzz thinks this</strong><p>{selected.reason || "Buzz is combining current activity signals for this place."}</p></div></div>
            <div className="buzz-truth-note"><ShieldCheck /><div><strong>What this score can prove</strong><p>Buzz creates a useful forecast from hours, events, ticket demand, traffic patterns, provider data, and nearby phones. Exact physical occupancy still requires ticket scans, POS activity, door counters, or another direct venue feed.</p></div></div>

            <div className="buzz-detail-facts">
              <div><small>HOURS</small><strong>{selectedHours}</strong></div>
              {selected.event?.name && <div><small>EVENT</small><strong>{selected.event.name}</strong><span>{formatEventTime(selected.event.startTime)}</span></div>}
              {selectedAddress && <div><small>ADDRESS</small><strong>{selectedAddress}</strong></div>}
            </div>

            <section className="buzz-vote-card">
              <header><div><small>OPTIONAL VERIFICATION</small><strong>How crowded is it?</strong><p>Buzz works without votes. Nearby votes verify and calibrate it faster.</p></div><em>+10 Buzz Points</em></header>
              <div>{crowdOptions.map(option => <button type="button" key={option.level} disabled={voting} onClick={() => void submitVote(option.level)}><span>{option.emoji}</span>{option.label}</button>)}</div>
              {voteMessage && <p>{voting && <i />}{voteMessage}</p>}
            </section>

            <section className="buzz-invite-card">
              <header><div><small>FOMO MODE</small><strong>Bring the crew</strong><p>Share this venue’s surge—not your location—with one tap.</p></div><Share2 /></header>
              <button type="button" className="buzz-invite-primary" disabled={sharing} onClick={() => void shareWithCrew(selected)}><Share2 />{sharing ? "Building the Story card…" : "Invite the Crew"}</button>
              <div>
                <button type="button" onClick={() => void copyInviteLink(selected)}><Copy />Copy link</button>
                <button type="button" onClick={() => textCrew(selected)}><MessageCircle />Text crew</button>
                <button type="button" disabled={sharing} onClick={() => void downloadStoryCard(selected)}><Download />Save Story</button>
              </div>
              {shareMessage && <p>{shareMessage}</p>}
            </section>

            <div className="buzz-detail-actions">
              <button type="button" className={watchedIds.has(selected.id) ? "watching" : ""} onClick={toggleVenueWatch}><Bell />{watchedIds.has(selected.id) ? "Watching" : "Watch this place"}</button>
              {selectedAddress && <a href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(selectedAddress)}`} target="_blank" rel="noreferrer"><Navigation />Directions</a>}
              {detail?.phone && <a href={`tel:${detail.phone}`}><Phone />Call</a>}
              {selectedWebsite && <a href={selectedWebsite} target="_blank" rel="noreferrer"><span>↗</span>Website</a>}
            </div>
            {watchMessage && <p className="buzz-watch-message">{watchMessage}</p>}
          </div>
        </aside>
      )}
      {reward && <button type="button" className="buzz-points-toast" onClick={() => setReward(null)}><strong>+{reward.points} Buzz Points</strong><span>{reward.total == null ? "Verified local contribution" : `${reward.total} total points`}</span></button>}
    </div>
  );
}
