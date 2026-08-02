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
  Flame,
  LocateFixed,
  MapPin,
  Music2,
  Search,
  ShoppingBag,
  Sparkles,
  TreePine,
  UserRound,
  Utensils,
  Wine,
} from "lucide-react";
import { getVenueLogo } from "../src/lib/venue-logo";
import { supabase } from "../src/lib/supabase";
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
import type { LocationSearchResult } from "../src/lib/location-search";
import { contributePassivePresence } from "../src/lib/buzz/passive-presence-client";
import {
  DEFAULT_BUZZ_CENTER as DEFAULT_CENTER,
  getBrowserPosition as getPosition,
  hasValidVenueCoordinates as validVenue,
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
  isBuzzingPinScore,
} from "./buzz-map-presentation";
import { useBuzzMapbox } from "./hooks/use-buzz-mapbox";
import { BuzzVenueDetail } from "./components/buzz-venue-detail";
import { BuzzVenueList } from "./components/buzz-venue-list";
import { BuzzMapSearch } from "./components/buzz-map-search";

const categories = [
  ["All", Compass],
  ["Food", Utensils],
  ["Drinks", Wine],
  ["Nightlife", Music2],
  ["Events", CalendarDays],
  ["Outdoors", TreePine],
  ["Shopping", ShoppingBag],
] as const;

const FAVORITES_KEY = "lit757-mobile-favorites";
const ALERTS_KEY = "lit757-mobile-alerts";
const VENUE_ALERTS_KEY = "lit757-venue-alerts";
const logoKeyFor = (venue: Venue) => `venue-logo-${String(venue.id).replace(/[^a-zA-Z0-9_-]/g, "")}`;
const logoUrlFor = (venue: Pick<Venue, "name" | "website">) => getVenueLogo({ name: venue.name, website: venue.website });

export default function BuzzMapApp() {
  const [venues, setVenues] = useState<Venue[]>([]);
  const [active, setActive] = useState<Category>("All");
  const [query, setQuery] = useState("");
  const [buzzingOnly, setBuzzingOnly] = useState(false);
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
      .filter(venue => !buzzingOnly || isBuzzingPinScore(score(venue)))
      .filter(venue => !clean || `${venue.name} ${venue.city || ""} ${venue.type || ""} ${venue.category || ""} ${venue.event?.name || ""}`.toLowerCase().includes(clean))
      .sort((left, right) => score(right) - score(left) || (left.distanceMiles ?? 999) - (right.distanceMiles ?? 999));
  }, [venues, active, buzzingOnly, query]);

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

  const closeVenue = useCallback(() => setSelected(null), []);

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
      const { data } = await supabase.auth.getSession();
      setSession(data.session);
      const listener = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
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
      await contributePassivePresence({
        latitude,
        longitude,
        accuracy: position.coords.accuracy,
      }, { explicit: true });
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

  function chooseSearchedVenue(venueId: string) {
    setActive("All");
    setBuzzingOnly(false);
    setQuery("");
    selectVenue(venueId);
  }

  async function chooseLocation(result: LocationSearchResult) {
    setQuery("");
    setSelected(null);
    setListExpanded(false);

    const map = mapRef.current;
    if (result.bbox?.length === 4) {
      map?.fitBounds(
        [[result.bbox[0], result.bbox[1]], [result.bbox[2], result.bbox[3]]],
        { padding: 64, maxZoom: 13, duration: 650 },
      );
      await loadNearby({ bounds: result.bbox.join(","), label: `in ${result.name}` });
      return;
    }

    const radius = result.featureType === "neighborhood" ? 3 : 10;
    map?.easeTo({ center: [result.longitude, result.latitude], zoom: result.featureType === "neighborhood" ? 12.5 : 10.5, duration: 650 });
    await loadNearby({ lat: result.latitude, lng: result.longitude, radius, label: `in ${result.name}` });
  }

  function toggleBuzzingFilter() {
    const next = !buzzingOnly;
    if (next && selected && !isBuzzingPinScore(score(selected))) {
      setSelected(null);
    }
    setBuzzingOnly(next);
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
          scoreMode: payload.buzz?.mode === "live" ? "live" : "forecast",
          confidence: payload.buzz?.confidence || venue.activity?.confidence,
        },
      } : venue;
      setVenues(current => current.map(update));
      setSelected(current => current ? update(current) : current);
      setVoteMessage(payload.buzz?.mode === "live"
        ? `Verified. ${payload.reportCount || 1} unique nearby report${payload.reportCount === 1 ? "" : "s"} now establish live activity.`
        : "Verified. Your report improves the forecast; Buzz waits for another nearby person before calling it Live.");
      if (payload.pointsAwarded) setReward({ points: payload.pointsAwarded, total: payload.totalPoints ?? null });
    } catch (voteError) {
      setVoteMessage(voteError instanceof Error ? voteError.message : "Could not submit your vote");
    } finally {
      setVoting(false);
    }
  }

  function toggleFavorite(event: ReactMouseEvent<HTMLButtonElement>, venue: Venue) {
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

  const [allCategory, ...otherCategories] = orderedCategories;
  const [allLabel, AllIcon] = allCategory || categories[0];

  return (
    <div className={`buzz-map-app ${daypart === "day" ? "daytime" : "nighttime"}`}>
      <header className="buzz-map-header">
        <button type="button" className="buzz-map-brand" onClick={() => { mapRef.current?.easeTo({ center: DEFAULT_CENTER, zoom: 8.8, duration: 600 }); void loadNearby(); }}>
          <strong>BUZZ</strong><span>THINGS TO DO NOW</span>
        </button>
        <BuzzMapSearch
          query={query}
          venues={venues}
          onQueryChange={setQuery}
          onSelectVenue={chooseSearchedVenue}
          onSelectLocation={chooseLocation}
        />
        <div className="buzz-map-header-actions">
          <button type="button" onClick={() => void requestMyLocation()}><LocateFixed /><span>Near me</span></button>
          <button type="button" aria-label="Enable Buzz alerts" onClick={() => void enableNotifications()}><Bell /></button>
          <button type="button" aria-label="Profile"><UserRound /></button>
        </div>
      </header>

      <nav className="buzz-map-filters" aria-label="Filter places">
        <button type="button" className={active === allLabel ? "active" : ""} onClick={() => setActive(allLabel)} aria-pressed={active === allLabel}><AllIcon /><span>{allLabel}</span></button>
        <button
          type="button"
          className={`buzzing${buzzingOnly ? " active" : ""}`}
          onClick={toggleBuzzingFilter}
          aria-pressed={buzzingOnly}
        >
          <Flame /><span>Buzzing</span>
        </button>
        <span className="buzz-filter-divider" aria-hidden="true" />
        {otherCategories.map(([label, Icon]) => <button type="button" key={label} className={active === label ? "active" : ""} onClick={() => setActive(label)} aria-pressed={active === label}><Icon /><span>{label}</span></button>)}
      </nav>

      <main className="buzz-map-layout">
        <BuzzVenueList
          activeCategory={active}
          buzzingOnly={buzzingOnly}
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
                ? <><Sparkles /><span>Buzzing pins</span><small>Orange/red pulse = heating up</small></>
                : <><MapPin /><span>Buzzing pins</span><small>Tap a pulsing logo for details</small></>}
          </div>
          {loading && <div className="buzz-map-loading"><i /> Updating Buzz</div>}
          {error && <button type="button" className="buzz-map-error" onClick={() => void loadNearby()}>{error} · Retry</button>}
        </section>
      </main>

      {selected && (
        <BuzzVenueDetail
          venue={selected}
          detail={detail}
          vibe={vibeFor(selected)}
          favorite={favoriteIds.has(selected.id)}
          watching={watchedIds.has(selected.id)}
          voting={voting}
          sharing={sharing}
          voteMessage={voteMessage}
          shareMessage={shareMessage}
          watchMessage={watchMessage}
          onClose={closeVenue}
          onToggleFavorite={toggleFavorite}
          onSubmitVote={submitVote}
          onShareWithCrew={shareWithCrew}
          onCopyInviteLink={copyInviteLink}
          onTextCrew={textCrew}
          onDownloadStoryCard={downloadStoryCard}
          onToggleWatch={toggleVenueWatch}
        />
      )}
      {reward && <button type="button" className="buzz-points-toast" onClick={() => setReward(null)}><strong>+{reward.points} Buzz Points</strong><span>{reward.total == null ? "Verified local contribution" : `${reward.total} total points`}</span></button>}
    </div>
  );
}
