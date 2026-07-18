"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import mapboxgl from "mapbox-gl";
import type { Provider, Session } from "@supabase/supabase-js";
import "mapbox-gl/dist/mapbox-gl.css";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  Clock3,
  Flame,
  Heart,
  LocateFixed,
  MapPin,
  Navigation,
  Search,
  Sparkles,
  Star,
  Ticket,
  UserRound,
  X,
} from "lucide-react";
import { supabase } from "../src/lib/supabase";
import AccountPanel, {
  type AuthProviders,
  type MemberPreferences,
  type SavedPlace,
} from "./account-panel";

type DiscoveryMode = "all" | "food" | "explore" | "events";

type DiscoveryEvent = {
  id: string;
  name: string;
  startTime: string | null;
  timeLabel: string;
  ticketStatus: string | null;
  sourceUrl: string | null;
};

type DiscoveryVenue = {
  id: string;
  name: string;
  city: string;
  address: string | null;
  lat: number;
  lng: number;
  type: string;
  category: string;
  kind: "food" | "nightlife" | "activity" | "events" | "other";
  rating: number | null;
  ageLimit: string | null;
  cover: string | null;
  parking: string | null;
  dressCode: string | null;
  phone: string | null;
  website: string | null;
  photoUrl: string | null;
  label: string;
  reason: string;
  timing: string;
  openNow: boolean | null;
  confidence: string;
  score: number;
  interestTags: string[];
  heat: {
    level: "active" | "hot";
    label: string;
    detail: string;
    source: "verified_nearby";
  } | null;
  whyNow: {
    headline: string;
    summary: string;
    freshness: string;
    reasons: Array<{
      kind: "crowd" | "event" | "tickets" | "open" | "rating" | "honest";
      title: string;
      detail: string;
    }>;
  };
  event: DiscoveryEvent | null;
};

type DiscoveryResponse = {
  success: boolean;
  generatedAt: string;
  context: {
    key: "morning" | "afternoon" | "evening" | "late";
    eyebrow: string;
    headline: string;
    timing: string;
    description: string;
    city: string;
    mode: DiscoveryMode;
    filter: string;
    resultCount: number;
  };
  filters: Array<{
    id: string;
    label: string;
    count: number;
  }>;
  freshness: {
    label: string;
    timestamp: string | null;
    automatic: boolean;
  };
  picks: DiscoveryVenue[];
  venues: DiscoveryVenue[];
};

const CITIES = [
  "All 757",
  "Norfolk",
  "Virginia Beach",
  "Chesapeake",
  "Portsmouth",
  "Suffolk",
  "Hampton",
  "Newport News",
];

const MODES: Array<{ id: DiscoveryMode; label: string }> = [
  { id: "all", label: "For now" },
  { id: "food", label: "Eat" },
  { id: "explore", label: "Explore" },
  { id: "events", label: "Events" },
];

const HAMPTON_ROADS_CENTER: [number, number] = [-76.2859, 36.9004];
const HAMPTON_ROADS_BOUNDS: [[number, number], [number, number]] = [
  [-76.9, 36.42],
  [-75.7, 37.38],
];

const MEMBER_PREFERENCES_KEY = "things-to-do-757:member-preferences";

type UserLocation = { latitude: number; longitude: number; accuracy: number };

function urlBase64ToUint8Array(value: string) {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) output[index] = raw.charCodeAt(index);
  return output;
}

function distanceMiles(
  location: Pick<UserLocation, "latitude" | "longitude">,
  venue: Pick<DiscoveryVenue, "lat" | "lng">
) {
  const radiusMiles = 3958.8;
  const radians = (value: number) => value * Math.PI / 180;
  const deltaLat = radians(venue.lat - location.latitude);
  const deltaLng = radians(venue.lng - location.longitude);
  const value =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(radians(location.latitude)) * Math.cos(radians(venue.lat)) * Math.sin(deltaLng / 2) ** 2;
  return radiusMiles * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function distanceLabel(miles: number) {
  if (miles < 0.1) return "Here";
  if (miles < 1) return `${miles.toFixed(1)} mi`;
  return `${Math.round(miles)} mi`;
}

function directionsUrl(venue: DiscoveryVenue) {
  const destination = venue.address || `${venue.lat},${venue.lng}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
}

function detailEyebrow(venue: DiscoveryVenue) {
  if (venue.event) return `${venue.event.timeLabel} · ${venue.city}`;
  if (venue.openNow === true) return `Open now · ${venue.city}`;
  return `${venue.timing} · ${venue.city}`;
}

function readableVenueType(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function VenueImage({
  venue,
  className = "",
  priority = false,
}: {
  venue: DiscoveryVenue;
  className?: string;
  priority?: boolean;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const initial = venue.name.trim().slice(0, 1).toUpperCase() || "7";

  return (
    <div
      className={`relative overflow-hidden bg-[radial-gradient(circle_at_25%_18%,#43413d_0%,#242321_42%,#111110_100%)] ${className}`}
    >
      <div className="absolute inset-0 flex items-center justify-center text-[64px] font-semibold tracking-[-0.08em] text-white/[0.09]">
        {initial}
      </div>
      {venue.photoUrl && failedUrl !== venue.photoUrl && (
        <Image
          src={venue.photoUrl}
          alt={`${venue.name} storefront exterior`}
          fill
          unoptimized
          priority={priority}
          sizes="(min-width: 1024px) 460px, 100vw"
          className="object-cover"
          onError={() => setFailedUrl(venue.photoUrl)}
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/25 via-transparent to-black/5" />
    </div>
  );
}

function PickCard({
  venue,
  rank,
  onSelect,
  distance,
}: {
  venue: DiscoveryVenue;
  rank: number;
  onSelect: (venue: DiscoveryVenue) => void;
  distance: string | null;
}) {
  const primary = rank === 0;

  return (
    <button
      type="button"
      onClick={() => onSelect(venue)}
      className={`group grid w-full grid-cols-[1fr_80px] gap-3 rounded-[1.45rem] border p-2.5 text-left transition duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ff5c35] sm:grid-cols-[1fr_88px] ${
        primary
          ? "border-[#ffb49f] bg-[#fff0e8] text-[#171716] shadow-[0_22px_60px_rgba(255,92,53,0.13)] hover:-translate-y-0.5 hover:border-[#ff9b82]"
          : "border-black/[0.08] bg-white/78 text-[#171716] hover:border-black/20 hover:bg-white"
      }`}
      aria-label={`Open ${venue.name}, pick ${rank + 1}`}
    >
      <span className="flex min-w-0 flex-col justify-between px-1 py-0.5">
        <span>
          <span className="flex items-center gap-2">
            <span
              className={`text-[10px] font-bold uppercase tracking-[0.16em] ${
                primary ? "text-[#c84427]" : "text-[#ca482b]"
              }`}
            >
              {String(rank + 1).padStart(2, "0")} · {venue.heat?.label || venue.label}
            </span>
            {venue.heat && (
              <span className="inline-flex items-center gap-1 rounded-full bg-[#ff5c35] px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.12em] text-white">
                <Flame size={8} fill="currentColor" /> Live
              </span>
            )}
          </span>
          <span className="mt-1.5 block truncate text-[18px] font-semibold leading-none tracking-[-0.04em] sm:text-[19px]">
            {venue.name}
          </span>
          <span
            className={`mt-1.5 line-clamp-1 text-[11px] leading-[1.4] ${
              primary ? "text-black/58" : "text-black/54"
            }`}
          >
            {venue.reason}
          </span>
        </span>

        <span className="mt-2 flex items-center gap-2 text-[10px] font-medium">
          <span className={primary ? "text-black/72" : "text-black/68"}>{venue.timing}</span>
          <span className={primary ? "text-black/18" : "text-black/18"}>·</span>
          <span className={primary ? "text-black/42" : "text-black/42"}>{venue.city}</span>
          {distance && (
            <>
              <span className="text-black/18">·</span>
              <span className="text-black/42">{distance}</span>
            </>
          )}
          <ArrowRight
            size={13}
            className={`ml-auto transition-transform group-hover:translate-x-0.5 ${
              primary ? "text-black/42" : "text-black/38"
            }`}
          />
        </span>
      </span>

      <VenueImage venue={venue} priority={primary} className="h-[92px] rounded-[1.05rem] sm:h-[96px]" />
    </button>
  );
}

function BrowseCard({
  venue,
  position,
  onSelect,
  distance,
}: {
  venue: DiscoveryVenue;
  position: number;
  onSelect: (venue: DiscoveryVenue) => void;
  distance: string | null;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(venue)}
      className="group grid w-full grid-cols-[1fr_66px] gap-3 rounded-[1.25rem] border border-black/[0.07] bg-white/68 p-2.5 text-left transition hover:border-black/17 hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ff5c35]"
      aria-label={`Open ${venue.name}, result ${position}`}
    >
      <span className="flex min-w-0 flex-col justify-center px-1">
        <span className="flex min-w-0 items-center gap-2 text-[9px] font-bold uppercase tracking-[0.14em] text-[#c94b2e]">
          <span>{String(position).padStart(2, "0")}</span>
          <span className="h-1 w-1 shrink-0 rounded-full bg-black/16" />
          <span className="truncate">{venue.heat?.label || venue.label}</span>
          {venue.heat && <Flame size={9} fill="currentColor" className="shrink-0 text-[#ff5c35]" />}
        </span>
        <span className="mt-1 block truncate text-[15px] font-semibold leading-none tracking-[-0.035em] text-black/82">
          {venue.name}
        </span>
        <span className="mt-1.5 flex min-w-0 items-center gap-1.5 text-[9px] font-medium text-black/40">
          <span className="truncate">{readableVenueType(venue.type)}</span>
          <span className="text-black/16">·</span>
          <span className="shrink-0">{venue.city}</span>
          {distance && (
            <>
              <span className="text-black/16">·</span>
              <span className="shrink-0">{distance}</span>
            </>
          )}
          <ArrowRight size={12} className="ml-auto shrink-0 text-black/30 transition-transform group-hover:translate-x-0.5" />
        </span>
      </span>
      <VenueImage venue={venue} className="h-[66px] rounded-[0.95rem]" />
    </button>
  );
}

function VenueDetail({
  venue,
  onClose,
  liked,
  distance,
  onToggleLike,
}: {
  venue: DiscoveryVenue;
  onClose: () => void;
  liked: boolean;
  distance: string | null;
  onToggleLike: (venue: DiscoveryVenue) => void;
}) {
  const reasonIcon = (kind: DiscoveryVenue["whyNow"]["reasons"][number]["kind"]) => {
    if (kind === "crowd") return <Flame size={15} fill="currentColor" />;
    if (kind === "event") return <Clock3 size={15} />;
    if (kind === "tickets") return <Ticket size={15} />;
    if (kind === "rating") return <Star size={15} fill="currentColor" />;
    return <Check size={15} />;
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#f7f5ef]">
      <div className="flex h-[72px] shrink-0 items-center justify-between border-b border-black/[0.07] px-5 sm:px-6">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-10 items-center gap-2 rounded-full px-2.5 text-[13px] font-semibold text-black/62 transition hover:bg-black/[0.05] hover:text-black focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ff5c35]"
        >
          <ArrowLeft size={17} />
          Back to picks
        </button>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-[#ece9e1] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-black/52">
            {venue.heat?.label || venue.label}
          </span>
          <button
            type="button"
            onClick={() => onToggleLike(venue)}
            aria-label={liked ? `Remove ${venue.name} from saved places` : `Save ${venue.name}`}
            aria-pressed={liked}
            className={`flex h-10 w-10 items-center justify-center rounded-full border transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ff5c35] ${
              liked
                ? "border-[#ffad98] bg-[#fff0e9] text-[#dc4c2b]"
                : "border-black/[0.09] bg-white/72 text-black/42 hover:border-black/20 hover:text-black/70"
            }`}
          >
            <Heart size={16} fill={liked ? "currentColor" : "none"} />
          </button>
        </div>
      </div>

      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        <VenueImage venue={venue} priority className="aspect-[16/10] rounded-[1.8rem]" />

        <div className="px-1 pb-5 pt-6">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#d44b2b]">
            {detailEyebrow(venue)}
          </p>
          <h2 className="mt-3 text-[36px] font-semibold leading-[0.98] tracking-[-0.055em] text-[#171716]">
            {venue.name}
          </h2>

          <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px] font-medium text-black/54">
            <span className="rounded-full bg-black/[0.055] px-3 py-1.5">{venue.type}</span>
            {venue.rating && (
              <span className="inline-flex items-center gap-1 rounded-full bg-black/[0.055] px-3 py-1.5">
                <Star size={11} fill="currentColor" /> {venue.rating.toFixed(1)}
              </span>
            )}
            {venue.ageLimit && venue.ageLimit !== "Unknown" && (
              <span className="rounded-full bg-black/[0.055] px-3 py-1.5">{venue.ageLimit}</span>
            )}
            {venue.cover && venue.cover !== "Unknown" && (
              <span className="rounded-full bg-black/[0.055] px-3 py-1.5">{venue.cover}</span>
            )}
            {distance && (
              <span className="rounded-full bg-black/[0.055] px-3 py-1.5">{distance} away</span>
            )}
          </div>

          <section className="mt-6 overflow-hidden rounded-[1.55rem] border border-black/[0.08] bg-white/74 shadow-[0_16px_42px_rgba(31,25,18,0.045)]">
            <div className="px-4 pb-4 pt-4 sm:px-5 sm:pt-5">
              <div className="flex items-center gap-2">
                <span
                  className={`h-2 w-2 rounded-full ${venue.heat ? "bg-[#ff5c35]" : "bg-[#1bad73]"}`}
                />
                <h3 className="text-[10px] font-bold uppercase tracking-[0.17em] text-black/44">
                  {venue.whyNow.headline}
                </h3>
              </div>
              <p className="mt-3 text-[16px] font-medium leading-[1.45] tracking-[-0.02em] text-black/76">
                {venue.whyNow.summary}
              </p>
            </div>

            <div className="divide-y divide-black/[0.065] border-t border-black/[0.065]">
              {venue.whyNow.reasons.map((reason) => (
                <div key={`${reason.kind}:${reason.title}`} className="flex items-start gap-3 px-4 py-3.5 sm:px-5">
                  <span
                    className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                      reason.kind === "crowd"
                        ? "bg-[#fff0e9] text-[#db4e2c]"
                        : "bg-black/[0.05] text-black/52"
                    }`}
                  >
                    {reasonIcon(reason.kind)}
                  </span>
                  <div className="min-w-0">
                    <p className="text-[12px] font-semibold leading-4 text-black/76">{reason.title}</p>
                    <p className="mt-0.5 text-[11px] leading-[1.45] text-black/44">{reason.detail}</p>
                  </div>
                </div>
              ))}
            </div>

            <p className="border-t border-black/[0.065] px-4 py-3 text-[9px] font-semibold uppercase tracking-[0.14em] text-black/30 sm:px-5">
              {venue.whyNow.freshness}
            </p>
          </section>

          <div className="mt-6 space-y-3 border-t border-black/[0.08] pt-5 text-[13px] text-black/58">
            {venue.address && (
              <div className="flex gap-3">
                <MapPin size={16} className="mt-0.5 shrink-0 text-black/36" />
                <span>{venue.address}</span>
              </div>
            )}
            {venue.parking && venue.parking !== "Unknown" && (
              <div className="flex gap-3">
                <Check size={16} className="mt-0.5 shrink-0 text-black/36" />
                <span>Parking: {venue.parking}</span>
              </div>
            )}
            {venue.dressCode && venue.dressCode !== "Unknown" && (
              <div className="flex gap-3">
                <Check size={16} className="mt-0.5 shrink-0 text-black/36" />
                <span>{venue.dressCode}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="shrink-0 border-t border-black/[0.08] bg-[#f7f5ef]/96 p-4 backdrop-blur-xl sm:p-5">
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <a
            href={directionsUrl(venue)}
            target="_blank"
            rel="noreferrer"
            className="flex h-13 items-center justify-center gap-2 rounded-full bg-[#171716] px-5 text-[13px] font-semibold text-white transition hover:bg-black focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ff5c35]"
          >
            <Navigation size={17} />
            Get directions
          </a>
          {venue.event?.sourceUrl ? (
            <a
              href={venue.event.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="flex h-13 items-center justify-center gap-2 rounded-full border border-black/[0.1] bg-white px-4 text-[13px] font-semibold text-black transition hover:border-black/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ff5c35]"
              aria-label="Open tickets"
            >
              Tickets <ArrowUpRight size={15} />
            </a>
          ) : venue.website ? (
            <a
              href={venue.website}
              target="_blank"
              rel="noreferrer"
              className="flex h-13 items-center justify-center rounded-full border border-black/[0.1] bg-white px-4 text-[13px] font-semibold text-black transition hover:border-black/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ff5c35]"
            >
              Website
            </a>
          ) : (
            <span className="hidden" />
          )}
        </div>
      </div>
    </div>
  );
}

function LoadingPicks() {
  return (
    <div className="space-y-3" aria-label="Finding the best things to do">
      {[0, 1, 2].map((item) => (
        <div
          key={item}
          className="grid animate-pulse grid-cols-[1fr_92px] gap-4 rounded-[1.6rem] border border-black/[0.05] bg-white/55 p-3"
        >
          <div className="space-y-3 px-1 py-1">
            <div className="h-2.5 w-24 rounded-full bg-black/[0.08]" />
            <div className="h-5 w-3/4 rounded-full bg-black/[0.1]" />
            <div className="h-3 w-full rounded-full bg-black/[0.07]" />
            <div className="h-3 w-1/2 rounded-full bg-black/[0.06]" />
          </div>
          <div className="h-[112px] rounded-[1.2rem] bg-black/[0.08]" />
        </div>
      ))}
    </div>
  );
}

export default function Home() {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const userMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const venuesRef = useRef<DiscoveryVenue[]>([]);
  const lastPresenceReportRef = useRef<{ key: string; at: number } | null>(null);
  const [data, setData] = useState<DiscoveryResponse | null>(null);
  const [mode, setMode] = useState<DiscoveryMode>("all");
  const [filter, setFilter] = useState("all");
  const [city, setCity] = useState("All 757");
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [selected, setSelected] = useState<DiscoveryVenue | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [providers, setProviders] = useState<AuthProviders>({
    google: false,
    facebook: false,
    apple: false,
    phone: false,
    email: true,
  });
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>([]);
  const [preferences, setPreferences] = useState<MemberPreferences>(() => {
    if (typeof window === "undefined") return { alerts: false, presence: false };
    try {
      const stored = window.localStorage.getItem(MEMBER_PREFERENCES_KEY);
      return stored
        ? { alerts: false, presence: false, ...JSON.parse(stored) }
        : { alerts: false, presence: false };
    } catch {
      return { alerts: false, presence: false };
    }
  });
  const [memberMessage, setMemberMessage] = useState("");
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [visibleResultCount, setVisibleResultCount] = useState(9);
  const [error, setError] = useState("");
  const [mapReady, setMapReady] = useState(false);
  const [mapUnavailable] = useState(() => !process.env.NEXT_PUBLIC_MAPBOX_TOKEN);

  useEffect(() => {
    void fetch("/api/auth/providers", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload) => setProviders(payload as AuthProviders))
      .catch(() => undefined);

    void supabase.auth.getSession().then(({ data: authData }) => setSession(authData.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setMemberMessage("");
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  const loadLikes = useCallback(async (activeSession: Session | null) => {
    if (!activeSession) {
      setLikedIds(new Set());
      setSavedPlaces([]);
      return;
    }

    const response = await fetch("/api/me/likes", {
      cache: "no-store",
      headers: { Authorization: `Bearer ${activeSession.access_token}` },
    });
    if (!response.ok) return;
    const payload = await response.json() as { venueIds: string[]; venues: SavedPlace[] };
    setLikedIds(new Set(payload.venueIds || []));
    setSavedPlaces(payload.venues || []);
  }, []);

  useEffect(() => {
    const task = window.setTimeout(() => void loadLikes(session), 0);
    return () => window.clearTimeout(task);
  }, [session, loadLikes]);

  useEffect(() => {
    const timer = window.setTimeout(() => setAppliedQuery(query.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [query]);

  const loadDiscovery = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);

    try {
      const params = new URLSearchParams({ mode, city });
      if (appliedQuery) params.set("q", appliedQuery);
      if (filter !== "all") params.set("filter", filter);
      const response = await fetch(`/api/discover?${params.toString()}`, {
        cache: "no-store",
        headers: session?.access_token
          ? { Authorization: `Bearer ${session.access_token}` }
          : undefined,
      });
      const payload = (await response.json()) as DiscoveryResponse & { error?: string };
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Could not refresh the 757 right now.");
      }

      setData(payload);
      setError("");
      setSelected((current) => {
        if (current) return payload.venues.find((venue) => venue.id === current.id) || current;
        const sharedId = new URLSearchParams(window.location.search).get("venue");
        return sharedId ? payload.venues.find((venue) => venue.id === sharedId) || null : null;
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not refresh the 757 right now.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [mode, city, appliedQuery, filter, session]);

  useEffect(() => {
    const task = window.setTimeout(() => void loadDiscovery(), 0);
    return () => window.clearTimeout(task);
  }, [loadDiscovery]);

  useEffect(() => {
    const interval = window.setInterval(() => loadDiscovery(true), 5 * 60 * 1000);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") loadDiscovery(true);
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [loadDiscovery]);

  const persistPreferences = useCallback((next: MemberPreferences) => {
    setPreferences(next);
    try {
      window.localStorage.setItem(MEMBER_PREFERENCES_KEY, JSON.stringify(next));
    } catch {
      // Keep the in-memory preference when storage is unavailable.
    }
  }, []);

  const subscribeToBackgroundAlerts = useCallback(async (activeSession: Session) => {
    if (
      typeof Notification === "undefined" ||
      !("serviceWorker" in navigator) ||
      !("PushManager" in window)
    ) {
      throw new Error("Background alerts are not available here. On iPhone, add the app to your Home Screen first.");
    }

    const configurationResponse = await fetch("/api/push/config", { cache: "no-store" });
    const configuration = await configurationResponse.json() as {
      configured?: boolean;
      publicKey?: string | null;
    };
    if (!configurationResponse.ok || !configuration.configured || !configuration.publicKey) {
      throw new Error("Background alerts are still being connected. Try again shortly.");
    }

    const registration = await navigator.serviceWorker.register("/sw.js");
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(configuration.publicKey),
      });
    }

    const response = await fetch("/api/push/subscription", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${activeSession.access_token}`,
      },
      body: JSON.stringify(subscription.toJSON()),
    });
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    if (!response.ok) throw new Error(payload?.error || "Could not connect background alerts.");
  }, []);

  const unsubscribeFromBackgroundAlerts = useCallback(async (activeSession: Session | null) => {
    if (!("serviceWorker" in navigator)) return;
    const registration = await navigator.serviceWorker.getRegistration("/");
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription) return;

    if (activeSession?.access_token) {
      await fetch("/api/push/subscription", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${activeSession.access_token}`,
        },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      }).catch(() => undefined);
    }
    await subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (
      !preferences.alerts ||
      !session ||
      typeof Notification === "undefined" ||
      Notification.permission !== "granted"
    ) return;

    void subscribeToBackgroundAlerts(session).catch((syncError) => {
      console.error("Could not refresh background alert subscription", syncError);
    });
  }, [preferences.alerts, session, subscribeToBackgroundAlerts]);

  const reportNearbyPresence = useCallback(async (location: UserLocation) => {
    setUserLocation(location);
    if (!preferences.presence || !session?.access_token) return;
    if (
      location.longitude < HAMPTON_ROADS_BOUNDS[0][0] ||
      location.longitude > HAMPTON_ROADS_BOUNDS[1][0] ||
      location.latitude < HAMPTON_ROADS_BOUNDS[0][1] ||
      location.latitude > HAMPTON_ROADS_BOUNDS[1][1]
    ) return;

    const reportKey = `${location.latitude.toFixed(3)}:${location.longitude.toFixed(3)}`;
    const previous = lastPresenceReportRef.current;
    if (previous?.key === reportKey && Date.now() - previous.at < 5 * 60 * 1000) return;
    lastPresenceReportRef.current = { key: reportKey, at: Date.now() };

    const response = await fetch("/api/presence", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        latitude: location.latitude,
        longitude: location.longitude,
        accuracy: location.accuracy,
      }),
    });

    if (response.ok) {
      const payload = await response.json() as { venueName?: string };
      setMemberMessage(`Nearby activity verified for ${payload.venueName || "this place"}.`);
      void loadDiscovery(true);
    }
  }, [loadDiscovery, preferences.presence, session]);

  useEffect(() => {
    if (!preferences.presence || !session || !navigator.geolocation) return;

    const watchId = navigator.geolocation.watchPosition(
      ({ coords }) => {
        void reportNearbyPresence({
          latitude: coords.latitude,
          longitude: coords.longitude,
          accuracy: coords.accuracy,
        });
      },
      (locationError) => {
        if (locationError.code === locationError.PERMISSION_DENIED) {
          persistPreferences({ ...preferences, presence: false });
          setMemberMessage("Location permission is off. Nearby verification was disabled.");
        }
      },
      { enableHighAccuracy: false, maximumAge: 120_000, timeout: 15_000 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [preferences, persistPreferences, reportNearbyPresence, session]);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;
    const mapContainer = mapContainerRef.current;
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

    if (!token) {
      return;
    }

    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({
      container: mapContainer,
      style: "mapbox://styles/mapbox/dark-v11",
      center: HAMPTON_ROADS_CENTER,
      zoom: 9.75,
      minZoom: 9.5,
      maxZoom: 17,
      maxBounds: HAMPTON_ROADS_BOUNDS,
      renderWorldCopies: false,
      attributionControl: true,
    });
    mapRef.current = map;
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(mapContainer);

    map.on("load", () => {
      map.resize();
      map.addSource("discovery-venues", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "venue-dots",
        type: "circle",
        source: "discovery-venues",
        filter: ["==", ["get", "isPick"], false],
        paint: {
          "circle-radius": [
            "interpolate", ["linear"], ["zoom"],
            9.5, ["match", ["get", "heatLevel"], "hot", 7, "active", 5.5, 2.6],
            13, ["match", ["get", "heatLevel"], "hot", 11, "active", 8.5, 5.2],
          ],
          "circle-color": [
            "match", ["get", "heatLevel"],
            "hot", "#ff5c35",
            "active", "#ff9a58",
            "#d7d4cc",
          ],
          "circle-opacity": [
            "match", ["get", "heatLevel"],
            "hot", 0.94,
            "active", 0.76,
            0.34,
          ],
          "circle-stroke-width": 1,
          "circle-stroke-color": "rgba(255,255,255,0.26)",
        },
      });
      map.addLayer({
        id: "pick-halo",
        type: "circle",
        source: "discovery-venues",
        filter: ["==", ["get", "isPick"], true],
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 9.5, 16, 13, 21],
          "circle-color": [
            "match", ["get", "heatLevel"],
            "hot", "rgba(255,92,53,0.58)",
            "active", "rgba(255,122,80,0.44)",
            "rgba(255,92,53,0.34)",
          ],
          "circle-blur": 0.35,
        },
      });
      map.addLayer({
        id: "pick-points",
        type: "circle",
        source: "discovery-venues",
        filter: ["==", ["get", "isPick"], true],
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 9.5, 10, 13, 14],
          "circle-color": "#ff5c35",
          "circle-stroke-width": 2,
          "circle-stroke-color": "#fffaf4",
        },
      });
      map.addLayer({
        id: "pick-labels",
        type: "symbol",
        source: "discovery-venues",
        filter: ["==", ["get", "isPick"], true],
        layout: {
          "text-field": ["get", "pickLabel"],
          "text-size": 11,
          "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
          "text-allow-overlap": true,
        },
        paint: { "text-color": "#ffffff" },
      });
      map.addLayer({
        id: "selected-ring",
        type: "circle",
        source: "discovery-venues",
        filter: ["==", ["get", "selected"], true],
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 9.5, 16, 13, 23],
          "circle-color": "rgba(0,0,0,0)",
          "circle-stroke-width": 3,
          "circle-stroke-color": "#ffffff",
          "circle-opacity": 0.92,
        },
      });

      const handleVenueClick = (event: mapboxgl.MapLayerMouseEvent) => {
        const id = String(event.features?.[0]?.properties?.id || "");
        const venue = venuesRef.current.find((item) => item.id === id);
        if (venue) setSelected(venue);
      };
      map.on("click", "venue-dots", handleVenueClick);
      map.on("click", "pick-points", handleVenueClick);
      for (const layer of ["venue-dots", "pick-points"]) {
        map.on("mouseenter", layer, () => { map.getCanvas().style.cursor = "pointer"; });
        map.on("mouseleave", layer, () => { map.getCanvas().style.cursor = ""; });
      }

      setMapReady(true);
    });

    return () => {
      resizeObserver.disconnect();
      userMarkerRef.current?.remove();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  const orderedResults = useMemo(() => {
    if (!data) return [];
    const pickIds = new Set(data.picks.map((venue) => venue.id));
    return [...data.picks, ...data.venues.filter((venue) => !pickIds.has(venue.id))];
  }, [data]);
  const featuredVenue = orderedResults[0] || null;
  const browseVenues = orderedResults.slice(1);
  const visibleBrowseVenues = browseVenues.slice(0, visibleResultCount);
  const visibleVenues = useMemo(() => data?.venues || [], [data?.venues]);
  const pickIds = useMemo(() => new Map((data?.picks || []).map((venue, index) => [venue.id, index])), [data?.picks]);

  useEffect(() => {
    venuesRef.current = visibleVenues;
    const map = mapRef.current;
    if (!mapReady || !map) return;
    const source = map.getSource("discovery-venues") as mapboxgl.GeoJSONSource | undefined;
    source?.setData({
      type: "FeatureCollection",
      features: visibleVenues.map((venue) => {
        const pickIndex = pickIds.get(venue.id);
        return {
          type: "Feature" as const,
          geometry: { type: "Point" as const, coordinates: [venue.lng, venue.lat] },
          properties: {
            id: venue.id,
            isPick: pickIndex !== undefined,
            pickLabel: pickIndex !== undefined ? String(pickIndex + 1) : "",
            selected: selected?.id === venue.id,
            heatLevel: venue.heat?.level || "none",
          },
        };
      }),
    });
  }, [visibleVenues, pickIds, selected?.id, mapReady]);

  useEffect(() => {
    if (!selected || !mapRef.current) return;
    mapRef.current.flyTo({
      center: [selected.lng, selected.lat],
      zoom: Math.max(12.8, mapRef.current.getZoom()),
      duration: 750,
      essential: true,
    });
    const url = new URL(window.location.href);
    url.searchParams.set("venue", selected.id);
    window.history.replaceState({}, "", `${url.pathname}${url.search}`);
  }, [selected]);

  function closeDetail() {
    setSelected(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("venue");
    window.history.replaceState({}, "", `${url.pathname}${url.search}`);
  }

  function openAccount() {
    setSelected(null);
    setAccountOpen(true);
    const url = new URL(window.location.href);
    url.searchParams.delete("venue");
    window.history.replaceState({}, "", `${url.pathname}${url.search}`);
  }

  async function signInWithProvider(provider: "google" | "facebook" | "apple") {
    setMemberMessage("");
    const { error: authError } = await supabase.auth.signInWithOAuth({
      provider: provider as Provider,
      options: { redirectTo: window.location.origin },
    });
    if (authError) setMemberMessage(authError.message);
  }

  async function signInWithEmail(email: string) {
    setMemberMessage("");
    const { error: authError } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    setMemberMessage(
      authError ? authError.message : "Check your email. Your private sign-in link is on the way."
    );
  }

  function normalizePhoneNumber(value: string) {
    const trimmed = value.trim();
    const digits = trimmed.replace(/\D/g, "");
    if (trimmed.startsWith("+") && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
    return null;
  }

  async function signInWithPhone(phone: string) {
    setMemberMessage("");
    const normalizedPhone = normalizePhoneNumber(phone);
    if (!normalizedPhone) {
      setMemberMessage("Enter a full mobile number, including the area code.");
      return false;
    }

    const { error: authError } = await supabase.auth.signInWithOtp({ phone: normalizedPhone });
    setMemberMessage(
      authError ? authError.message : `We texted a six-digit code to ${normalizedPhone}.`
    );
    return !authError;
  }

  async function verifyPhoneCode(phone: string, code: string) {
    setMemberMessage("");
    const normalizedPhone = normalizePhoneNumber(phone);
    const normalizedCode = code.replace(/\D/g, "");
    if (!normalizedPhone || normalizedCode.length !== 6) {
      setMemberMessage("Enter the six-digit code from the text message.");
      return false;
    }

    const { error: authError } = await supabase.auth.verifyOtp({
      phone: normalizedPhone,
      token: normalizedCode,
      type: "sms",
    });
    setMemberMessage(authError ? authError.message : "");
    return !authError;
  }

  async function signOut() {
    await unsubscribeFromBackgroundAlerts(session);
    persistPreferences({ ...preferences, alerts: false });
    await supabase.auth.signOut();
    setMemberMessage("");
    setAccountOpen(false);
  }

  async function changeAlerts(enabled: boolean) {
    if (!enabled) {
      await unsubscribeFromBackgroundAlerts(session);
      persistPreferences({ ...preferences, alerts: false });
      setMemberMessage("Saved-place alerts are off.");
      return;
    }

    if (!session) {
      setMemberMessage("Sign in before turning on saved-place alerts.");
      return;
    }

    if (
      typeof Notification === "undefined" ||
      !("serviceWorker" in navigator) ||
      !("PushManager" in window)
    ) {
      setMemberMessage("Background alerts are not available here. On iPhone, add the app to your Home Screen first.");
      return;
    }

    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setMemberMessage("Notifications were not allowed, so alerts remain off.");
      return;
    }

    try {
      await subscribeToBackgroundAlerts(session);
      persistPreferences({ ...preferences, alerts: true });
      setMemberMessage("Background alerts are on—even when the app is closed.");
    } catch (pushError) {
      persistPreferences({ ...preferences, alerts: false });
      setMemberMessage(
        pushError instanceof Error ? pushError.message : "Could not connect background alerts."
      );
    }
  }

  async function changePresence(enabled: boolean) {
    if (!enabled) {
      persistPreferences({ ...preferences, presence: false });
      setMemberMessage("Nearby verification is off.");
      return;
    }
    if (!navigator.geolocation) {
      setMemberMessage("This browser cannot verify nearby activity.");
      return;
    }

    persistPreferences({ ...preferences, presence: true });
    setMemberMessage("Nearby verification is on while the app is open.");
  }

  async function toggleLike(venue: DiscoveryVenue) {
    if (!session) {
      setMemberMessage("Sign in to save this place and shape your recommendations.");
      openAccount();
      return;
    }

    const wasLiked = likedIds.has(venue.id);
    setLikedIds((current) => {
      const next = new Set(current);
      if (wasLiked) next.delete(venue.id);
      else next.add(venue.id);
      return next;
    });

    const response = await fetch("/api/me/likes", {
      method: wasLiked ? "DELETE" : "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ venueId: venue.id }),
    });

    if (!response.ok) {
      setLikedIds((current) => {
        const next = new Set(current);
        if (wasLiked) next.add(venue.id);
        else next.delete(venue.id);
        return next;
      });
      const payload = await response.json().catch(() => null);
      setMemberMessage(payload?.error || "That place could not be saved yet.");
      return;
    }

    await loadLikes(session);
    void loadDiscovery(true);
  }

  function selectSavedPlace(place: SavedPlace) {
    const visible = data?.venues.find((venue) => venue.id === place.id);
    setAccountOpen(false);
    if (visible) {
      setSelected(visible);
      return;
    }
    setMode("all");
    setFilter("all");
    setVisibleResultCount(9);
    setQuery(place.name);
    setAppliedQuery(place.name);
  }

  function chooseForMe() {
    const pick = featuredVenue;
    if (pick) setSelected(pick);
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    setFilter("all");
    setVisibleResultCount(9);
    setAppliedQuery(query.trim());
  }

  function useMyLocation() {
    if (!navigator.geolocation || !mapRef.current) return;
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      if (
        coords.longitude < HAMPTON_ROADS_BOUNDS[0][0] ||
        coords.longitude > HAMPTON_ROADS_BOUNDS[1][0] ||
        coords.latitude < HAMPTON_ROADS_BOUNDS[0][1] ||
        coords.latitude > HAMPTON_ROADS_BOUNDS[1][1]
      ) return;

      const point: [number, number] = [coords.longitude, coords.latitude];
      const location = {
        latitude: coords.latitude,
        longitude: coords.longitude,
        accuracy: coords.accuracy,
      };
      setUserLocation(location);
      void reportNearbyPresence(location);
      userMarkerRef.current?.remove();
      const marker = document.createElement("div");
      marker.className = "discovery-user-marker";
      userMarkerRef.current = new mapboxgl.Marker({ element: marker }).setLngLat(point).addTo(mapRef.current!);
      mapRef.current!.flyTo({ center: point, zoom: 13.2, duration: 750 });
    });
  }

  const venueDistance = (venue: DiscoveryVenue) =>
    userLocation ? distanceLabel(distanceMiles(userLocation, venue)) : null;

  const eyebrow = appliedQuery
    ? `Ideas for “${appliedQuery}”`
    : data?.context.eyebrow.replace(
        "the 757",
        city === "All 757" ? "the 757" : city
      );

  return (
    <main className="min-h-dvh bg-[#f7f5ef] text-[#171716] lg:h-dvh lg:overflow-hidden">
      <div className="grid min-h-dvh lg:h-dvh lg:grid-cols-[minmax(390px,460px)_1fr]">
        <section className="relative z-10 flex min-h-dvh min-w-0 flex-col border-black/[0.08] bg-[#f7f5ef] lg:h-dvh lg:min-h-0 lg:border-r">
          {accountOpen ? (
            <AccountPanel
              session={session}
              providers={providers}
              savedPlaces={savedPlaces}
              preferences={preferences}
              message={memberMessage}
              onClose={() => setAccountOpen(false)}
              onOAuth={signInWithProvider}
              onEmailSignIn={signInWithEmail}
              onPhoneSignIn={signInWithPhone}
              onPhoneVerify={verifyPhoneCode}
              onSignOut={signOut}
              onSelectSaved={selectSavedPlace}
              onAlertsChange={changeAlerts}
              onPresenceChange={changePresence}
            />
          ) : selected ? (
            <VenueDetail
              venue={selected}
              onClose={closeDetail}
              liked={likedIds.has(selected.id)}
              distance={venueDistance(selected)}
              onToggleLike={(venue) => void toggleLike(venue)}
            />
          ) : (
            <>
              <header className="flex h-[72px] shrink-0 items-center justify-between border-b border-black/[0.07] px-4 sm:px-6">
                <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[11px] bg-[#171716] shadow-sm sm:h-9 sm:w-9 sm:rounded-[12px]">
                    <span className="h-2.5 w-2.5 rounded-full bg-[#ff5c35]" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-semibold leading-none tracking-[-0.035em] sm:text-[15px]">Things To Do 757</p>
                    <p className="mt-1 text-[9px] font-bold uppercase tracking-[0.17em] text-black/35">Any time · All 757</p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <label className="relative">
                    <span className="sr-only">Choose city</span>
                    <select
                      value={city}
                      onChange={(event) => {
                        setCity(event.target.value);
                        setFilter("all");
                        setVisibleResultCount(9);
                      }}
                      className="h-10 max-w-[92px] appearance-none rounded-full border border-black/[0.09] bg-white/66 pl-3 pr-7 text-[11px] font-semibold text-black/68 outline-none transition hover:border-black/20 focus:ring-2 focus:ring-[#ff5c35] sm:max-w-[112px] sm:pl-4 sm:pr-8 sm:text-[12px]"
                    >
                      {CITIES.map((item) => <option key={item}>{item}</option>)}
                    </select>
                    <MapPin size={13} className="pointer-events-none absolute right-3 top-3.5 text-black/34" />
                  </label>
                  <button
                    type="button"
                    onClick={openAccount}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-black/[0.09] bg-white/66 text-black/54 transition hover:border-black/20 hover:text-black/74 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ff5c35]"
                    aria-label={session ? "Open my saved places and alerts" : "Sign in"}
                  >
                    {session ? (
                      <span className="text-[12px] font-bold uppercase">
                        {(session.user.user_metadata?.full_name || session.user.email || "Y").slice(0, 1)}
                      </span>
                    ) : (
                      <UserRound size={16} />
                    )}
                  </button>
                </div>
              </header>

              <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-5 pb-8 pt-4 sm:px-6 lg:pb-5">
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.17em] text-black/42">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-30" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                  </span>
                  <span>{eyebrow || "Your time in the 757"}</span>
                  {refreshing && <span className="text-black/24">· Refreshing</span>}
                </div>

                <h1 className="mt-2 max-w-[390px] text-[32px] font-semibold leading-none tracking-[-0.052em] sm:text-[34px]">
                  {data?.context.headline || "Find your thing."}
                </h1>
                <p className="mt-1.5 max-w-[390px] text-[12px] leading-5 text-black/48">
                  {data?.context.description || "Type any interest, hobby, or mood. We’ll make the decision."}
                </p>

                <form onSubmit={submitSearch} className="mt-3 grid grid-cols-[1fr_auto] gap-2">
                  <label className="relative block min-w-0">
                    <span className="sr-only">Search any interest, hobby, place, or plan</span>
                    <Search size={15} className="pointer-events-none absolute left-4 top-[15px] text-black/34" />
                    <input
                      value={query}
                      onChange={(event) => {
                        setQuery(event.target.value);
                        setFilter("all");
                        setVisibleResultCount(9);
                        if (event.target.value.trim()) setMode("all");
                      }}
                      placeholder="Try “date night,” hiking, art…"
                      maxLength={120}
                      className="h-12 w-full rounded-full border border-black/[0.09] bg-white/72 pl-10 pr-10 text-[13px] text-black outline-none placeholder:text-black/32 transition focus:border-black/20 focus:ring-2 focus:ring-[#ff5c35]"
                    />
                    {query && (
                      <button
                        type="button"
                        onClick={() => {
                          setQuery("");
                          setFilter("all");
                          setVisibleResultCount(9);
                        }}
                        className="absolute right-2.5 top-2.5 flex h-7 w-7 items-center justify-center rounded-full text-black/34 hover:bg-black/[0.05] hover:text-black"
                        aria-label="Clear search"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </label>
                  <button
                    type="button"
                    onClick={chooseForMe}
                    disabled={!data?.picks.length}
                    className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-[#ff5c35] px-4 text-[12px] font-semibold text-white shadow-[0_12px_30px_rgba(255,92,53,0.22)] transition hover:bg-[#eb4f2b] disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-black"
                  >
                    <Sparkles size={15} />
                    Pick for me
                  </button>
                </form>

                <div className="mt-2 grid grid-cols-4 gap-1" role="tablist" aria-label="Discovery categories">
                  {MODES.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      role="tab"
                      aria-selected={mode === item.id}
                      onClick={() => {
                        setMode(item.id);
                        setFilter("all");
                        setVisibleResultCount(9);
                      }}
                      className={`h-9 min-w-0 whitespace-nowrap rounded-full px-1 text-[10px] font-semibold leading-none transition sm:px-3 sm:text-[11px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ff5c35] ${
                        mode === item.id
                          ? "bg-[#171716] text-white"
                          : "bg-black/[0.05] text-black/52 hover:bg-black/[0.08] hover:text-black/72"
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>

                <div className="mt-3">
                  <div className="flex items-center justify-between gap-3 px-0.5">
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-black/40">
                      {data ? `Browse ${data.context.resultCount} places` : "Finding places"}
                    </p>
                    {filter !== "all" && (
                      <button
                        type="button"
                        onClick={() => {
                          setFilter("all");
                          setVisibleResultCount(9);
                        }}
                        className="text-[10px] font-semibold text-[#c94b2e] transition hover:text-[#a83c24] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ff5c35]"
                      >
                        Clear filter
                      </button>
                    )}
                  </div>
                  <div className="no-scrollbar -mx-5 mt-2 flex gap-1.5 overflow-x-auto px-5 pb-1 sm:-mx-6 sm:px-6" aria-label="Filter places">
                    {data ? data.filters.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          aria-pressed={filter === item.id}
                          onClick={() => {
                            setFilter(item.id);
                            setVisibleResultCount(9);
                          }}
                          className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[10px] font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ff5c35] ${
                            filter === item.id
                              ? "border-[#171716] bg-[#171716] text-white"
                              : "border-black/[0.07] bg-white/66 text-black/52 hover:border-black/16 hover:text-black/72"
                          }`}
                        >
                          {item.label}
                          <span className={filter === item.id ? "text-white/48" : "text-black/28"}>{item.count}</span>
                        </button>
                      )) : [62, 86, 74].map((width) => (
                        <span
                          key={width}
                          className="h-8 shrink-0 animate-pulse rounded-full bg-black/[0.055]"
                          style={{ width }}
                        />
                      ))}
                  </div>
                </div>

                <div className="mt-3">
                  {loading && !data ? (
                    <LoadingPicks />
                  ) : error && !data ? (
                    <div className="rounded-[1.6rem] border border-black/[0.08] bg-white/72 p-6 text-center">
                      <p className="text-[15px] font-semibold">The 757 update is taking a minute.</p>
                      <p className="mt-2 text-[12px] text-black/46">{error}</p>
                      <button
                        type="button"
                        onClick={() => loadDiscovery()}
                        className="mt-4 rounded-full bg-[#171716] px-5 py-2.5 text-[12px] font-semibold text-white"
                      >
                        Try again
                      </button>
                    </div>
                  ) : featuredVenue ? (
                    <div>
                      <PickCard
                        venue={featuredVenue}
                        rank={0}
                        onSelect={setSelected}
                        distance={venueDistance(featuredVenue)}
                      />

                      {visibleBrowseVenues.length > 0 && (
                        <div className="mt-4">
                          <div className="mb-2 flex items-center justify-between px-0.5">
                            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-black/40">
                              More places
                            </p>
                            <span className="text-[10px] font-medium text-black/30">
                              {Math.min(visibleBrowseVenues.length + 1, orderedResults.length)} of {data?.context.resultCount || orderedResults.length}
                            </span>
                          </div>
                          <div className="space-y-1.5">
                            {visibleBrowseVenues.map((venue, index) => (
                              <BrowseCard
                                key={venue.id}
                                venue={venue}
                                position={index + 2}
                                onSelect={setSelected}
                                distance={venueDistance(venue)}
                              />
                            ))}
                          </div>
                          {visibleBrowseVenues.length < browseVenues.length && (
                            <button
                              type="button"
                              onClick={() => setVisibleResultCount((current) => current + 12)}
                              className="mt-2 flex h-11 w-full items-center justify-center rounded-full border border-black/[0.08] bg-white/56 text-[11px] font-semibold text-black/56 transition hover:border-black/18 hover:bg-white hover:text-black/74 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ff5c35]"
                            >
                              Show {Math.min(12, browseVenues.length - visibleBrowseVenues.length)} more
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="rounded-[1.6rem] border border-black/[0.08] bg-white/72 p-6 text-center">
                      <p className="text-[15px] font-semibold">No clean matches yet.</p>
                      <p className="mt-2 text-[12px] leading-5 text-black/46">
                        Try a broader interest or a different word. We will not invent a weak recommendation.
                      </p>
                    </div>
                  )}
                </div>

                <div className="mt-4 flex items-center justify-between border-t border-black/[0.07] pt-3 text-[10px] font-medium text-black/34">
                  <span className="inline-flex items-center gap-1.5">
                    <Clock3 size={12} />
                    {data?.freshness.label || "Updating now"}
                  </span>
                  <span>{data ? `${data.context.resultCount} matches` : "Across the 757"}</span>
                </div>
              </div>
            </>
          )}
        </section>

        <section className="relative min-h-[410px] overflow-hidden bg-[#111110] lg:min-h-0" aria-label="757 venue map">
          <div className="absolute inset-0">
            <div ref={mapContainerRef} className="h-full w-full" />
          </div>

          {mapUnavailable && (
            <div className="absolute inset-0 flex items-center justify-center bg-[radial-gradient(circle_at_center,#282725_0%,#111110_72%)] px-6 text-center text-white">
              <div>
                <MapPin size={26} className="mx-auto text-[#ff7a59]" />
                <p className="mt-3 text-[15px] font-semibold">The 757 map is unavailable.</p>
                <p className="mt-1 text-[12px] text-white/45">Your recommendations still work.</p>
              </div>
            </div>
          )}

          <div className="pointer-events-none absolute left-4 top-4 z-10 flex items-center gap-2 rounded-full border border-white/10 bg-black/72 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-white/62 shadow-sm backdrop-blur-xl sm:left-5 sm:top-5">
            <span className="h-1.5 w-1.5 rounded-full bg-[#ff5c35]" />
            {filter === "all"
              ? "757 map · Right now"
              : `${data?.filters.find((item) => item.id === filter)?.label || "Filtered"} · ${data?.context.resultCount || 0}`}
          </div>

          <button
            type="button"
            onClick={useMyLocation}
            className="absolute bottom-8 right-4 z-10 flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-black/72 text-white shadow-[0_12px_40px_rgba(0,0,0,0.3)] backdrop-blur-xl transition hover:bg-black/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ff5c35] sm:right-5"
            aria-label="Center map on my location"
          >
            <LocateFixed size={17} />
          </button>

          <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/30 to-transparent lg:hidden" />
        </section>
      </div>
    </main>
  );
}
