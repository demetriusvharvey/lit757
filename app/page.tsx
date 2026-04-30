"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { supabase } from "../src/lib/supabase";
import { Event, Venue, Vibe } from "../src/types";
import {
  MapPin,
  Navigation,
  Share2,
  X,
  ChevronUp,
  Search,
  Music,
  BadgeDollarSign,
  UserRoundCheck,
  CalendarDays,
} from "lucide-react";

type VenueWithEvent = Venue & {
  tonightEvent?: Event | null;
  voteCount?: number;
  updateCount?: number;
  trendingScore?: number;
  momentumLabel?: string;
  confidence?: "high" | "medium" | "low";
};

const VIBE_SCORE: Record<Vibe, number> = {
  lit: 4,
  decent: 2,
  dead: -3,
  line_crazy: 2,
};

function voteWeight(createdAt?: string | null) {
  if (!createdAt) return 0;

  const minutes = (Date.now() - new Date(createdAt).getTime()) / 60000;

  if (minutes <= 30) return 1;
  if (minutes <= 60) return 0.7;
  if (minutes <= 90) return 0.5;
  return 0;
}

function getStatus(score: number, signalCount: number) {
  if (score >= 6) return "lit";
  if (score >= 2) return "decent";
  if (signalCount >= 1 && score >= 0) return "decent";
  return "dead";
}

function confidenceLabel(confidence?: "high" | "medium" | "low") {
  if (confidence === "high") return "High confidence";
  if (confidence === "medium") return "Medium confidence";
  return "Low confidence";
}

function pinColor(status?: string) {
  if (status === "lit") return "#ef4444";
  if (status === "decent") return "#f5b301";
  return "#9ca3af";
}

function statusLabel(status?: string) {
  if (status === "lit") return "🔥 Lit";
  if (status === "decent") return "👍 Decent";
  return "💤 Dead";
}

function trendingLabel(score?: number) {
  if (score === undefined || score === null) return "🔥 active";
  if (score >= 8) return "🔥 exploding";
  if (score >= 4) return "🔥 active";
  return "😴 slow";
}

function updateTypeIcon(type?: string) {
  switch (type) {
    case "Crowd/vibe":
      return "🔥";
    case "Line update":
      return "🚶";
    case "Music/DJ":
      return "🎧";
    case "Event info":
      return "🎉";
    case "Cover charge":
      return "💵";
    default:
      return "📝";
  }
}

function getUpdateScore(update: { update_type?: string | null; message?: string | null }) {
  const type = update.update_type || "";
  const message = (update.message || "").toLowerCase();

  if (type === "Crowd/vibe") {
    const positive = ["packed", "lit", "crowded", "busy", "good", "jumping"];
    const negative = ["dead", "empty", "slow", "quiet"];

    if (positive.some((word) => message.includes(word))) return 2;
    if (negative.some((word) => message.includes(word))) return -2;
    return 0;
  }

  if (type === "Line update") return 1;
  if (type === "Music/DJ" || type === "Event info") return 1;
  return 0;
}

function venueType(venue: VenueWithEvent) {
  return venue.type || "Nightlife Spot";
}

function minutesAgo(date?: string | null) {
  if (!date) return "No recent votes";
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Updated just now";
  return `Updated ${mins} min ago`;
}

function getDeviceId() {
  if (typeof window === "undefined") return null;

  let deviceId = localStorage.getItem("lit757_device_id");

  if (!deviceId) {
    deviceId = crypto.randomUUID();
    localStorage.setItem("lit757_device_id", deviceId);
  }

  return deviceId;
}

export default function Home() {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const touchStartY = useRef<number | null>(null);

  const [venues, setVenues] = useState<VenueWithEvent[]>([]);
  const [selected, setSelected] = useState<VenueWithEvent | null>(null);
  const [city, setCity] = useState("All 757");
  const [query, setQuery] = useState("");
  const [activeChip, setActiveChip] = useState("All");
  const [viewMode, setViewMode] = useState<"map" | "events">("map");
  const [map, setMap] = useState<mapboxgl.Map | null>(null);
  const [sheetExpanded, setSheetExpanded] = useState(false);
  const [summary, setSummary] = useState("");
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [recommendation, setRecommendation] = useState("");
  const [recommendationVenue, setRecommendationVenue] = useState("");
  const [recommendationLoading, setRecommendationLoading] = useState(false);
  const [suggestionOpen, setSuggestionOpen] = useState(false);
  const [suggestionType, setSuggestionType] = useState("Event info");
  const [suggestionMessage, setSuggestionMessage] = useState("");
  const [suggestionLoading, setSuggestionLoading] = useState(false);
  const [suggestionFeedback, setSuggestionFeedback] = useState("");
  const [suggestionStatus, setSuggestionStatus] = useState<"success" | "error" | null>(null);
  const [eventOpen, setEventOpen] = useState(false);
  const [eventTitle, setEventTitle] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [eventTime, setEventTime] = useState("");
  const [eventGenre, setEventGenre] = useState("");
  const [eventDj, setEventDj] = useState("");
  const [eventCoverPrice, setEventCoverPrice] = useState("");
  const [eventAgeLimit, setEventAgeLimit] = useState("");
  const [eventDescription, setEventDescription] = useState("");
  const [eventLoading, setEventLoading] = useState(false);
  const [eventFeedback, setEventFeedback] = useState("");
  const [eventStatus, setEventStatus] = useState<"success" | "error" | null>(null);
  const [recentUpdates, setRecentUpdates] = useState<Array<{
    id: string;
    update_type: string | null;
    message: string | null;
    created_at: string | null;
  }>>([]);

  useEffect(() => {
    async function fetchSummary() {
      try {
        setSummaryLoading(true);
        const response = await fetch("/api/summary");
        if (!response.ok) {
          throw new Error("Summary fetch failed");
        }
        const data = await response.json();
        setSummary(data.summary || "");
      } catch (error) {
        console.error("Summary error:", error);
      } finally {
        setSummaryLoading(false);
      }
    }

    fetchSummary();
  }, []);

  async function fetchRecommendation() {
    try {
      setRecommendationLoading(true);
      setRecommendation("");
      setRecommendationVenue("");

      const response = await fetch("/api/recommendation");
      if (!response.ok) {
        throw new Error("Recommendation fetch failed");
      }

      const data = await response.json();
      setRecommendation(data.recommendation || "");
      setRecommendationVenue(data.venueName || "");
    } catch (error) {
      console.error("Recommendation error:", error);
      setRecommendation("Unable to find a recommendation right now.");
    } finally {
      setRecommendationLoading(false);
    }
  }

  async function loadVenues() {
    const { data: venuesData, error: venuesError } = await supabase
      .from("venues")
      .select("*");

    if (venuesError) {
      console.error("Venues error:", venuesError);
      return;
    }

    const today = new Date().toISOString().split("T")[0];

    const { data: eventsData, error: eventsError } = await supabase
      .from("events")
      .select("*")
      .eq("event_date", today);

    if (eventsError) console.error("Events error:", eventsError);

    const since = new Date(Date.now() - 90 * 60 * 1000).toISOString();

    const { data: votesData, error: votesError } = await supabase
      .from("votes")
      .select("*")
      .gte("created_at", since);

    if (votesError) console.error("Votes error:", votesError);

    const { data: updatesData, error: updatesError } = await supabase
      .from("suggested_updates")
      .select("*")
      .gte("created_at", since);

    if (updatesError) console.error("Suggested updates error:", updatesError);

    const enriched =
      venuesData?.map((venue) => {
        const venueVotes =
          votesData?.filter((vote) => vote.venue_id === venue.id) || [];

        const updateMatches =
          updatesData?.filter(
            (update) =>
              update.venue_id === venue.id ||
              (!update.venue_id && update.venue_name === venue.name)
          ) || [];

        const updateCount = updateMatches.length;

        const updateScore = updateMatches.reduce(
          (sum, update) => sum + getUpdateScore(update),
          0
        );

        const voteCount = venueVotes.length;

        const positiveWords = ["packed", "lit", "busy", "good", "jumping"];
        const recentPositiveVote = venueVotes.some(
          (vote) =>
            ["lit", "decent"].includes(vote.vibe) &&
            Date.now() - new Date(vote.created_at).getTime() <= 30 * 60 * 1000
        );

        const recentPositiveUpdate = updateMatches.some((update) => {
          const message = (update.message || "").toLowerCase();
          return (
            update.update_type === "Crowd/vibe" &&
            positiveWords.some((word) => message.includes(word)) &&
            Date.now() - new Date(update.created_at).getTime() <= 30 * 60 * 1000
          );
        });

        const hasLineUpdate = updateMatches.some(
          (update) => update.update_type === "Line update"
        );

        const hasSignals = voteCount > 0 || updateCount > 0;

        const sortedVotes = [...venueVotes].sort(
          (a, b) =>
            new Date(b.created_at).getTime() -
            new Date(a.created_at).getTime()
        );

        const sortedUpdates = [...updateMatches].sort(
          (a, b) =>
            new Date(b.created_at).getTime() -
            new Date(a.created_at).getTime()
        );

        const lastActivity =
          sortedVotes[0]?.created_at || sortedUpdates[0]?.created_at || null;
        const recentBonus =
          lastActivity && Date.now() - new Date(lastActivity).getTime() <= 30 * 60 * 1000
            ? 2
            : 0;

        const score = venueVotes.reduce(
          (sum, vote) =>
            sum + VIBE_SCORE[vote.vibe as Vibe] * voteWeight(vote.created_at),
          0
        );

        const finalScore = score + updateScore;

        const voteScore = voteCount * 2;
        const eventBonus = eventsData?.some((event) => event.venue_id === venue.id)
          ? 2
          : 0;

        const trendingScore = voteScore + updateScore + eventBonus + recentBonus;

        const momentumLabel = recentPositiveVote || recentPositiveUpdate
          ? "📈 gaining fast"
          : score >= 6
          ? "🔥 heating up"
          : hasLineUpdate
          ? "🚶 line building"
          : !hasSignals
          ? "😴 quiet"
          : "🔥 heating up";

        const tonightEvent =
          eventsData?.find((event) => event.venue_id === venue.id) || null;

        return {
          ...venue,
          score: finalScore,
          voteCount,
          updateCount,
          trendingScore,
          momentumLabel,
          confidence:
            voteCount + updateCount >= 5
              ? "high"
              : voteCount + updateCount >= 2
              ? "medium"
              : "low",
          status: getStatus(finalScore, voteCount + updateCount),
          lastUpdated:
            sortedVotes[0]?.created_at || sortedUpdates[0]?.created_at || null,
          tonightEvent,
        };
      }) || [];

    setVenues(enriched);
  }

  useEffect(() => {
    loadVenues();
  }, []);

  useEffect(() => {
    if (!mapContainerRef.current) return;

    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

    if (!token) {
      console.error("Missing Mapbox token");
      return;
    }

    mapboxgl.accessToken = token;

    const newMap = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: "mapbox://styles/mapbox/dark-v11",
      center: [-76.2859, 36.8508],
      zoom: 10,
    });

    newMap.on("load", () => newMap.resize());

    setMap(newMap);

    return () => newMap.remove();
  }, []);

  async function loadRecentUpdates() {
    if (!selected) {
      console.log("Recent updates: no selected venue");
      setRecentUpdates([]);
      return;
    }

    console.log("Recent updates: fetching for selected.id", selected.id, "selected.name", selected.name);

    let { data, error } = await supabase
      .from("suggested_updates")
      .select("*")
      .eq("venue_id", selected.id)
      .order("created_at", { ascending: false })
      .limit(5);

    if (error) {
      console.error("Recent updates error (venue_id):", error);
      setRecentUpdates([]);
      return;
    }

    if ((!data || data.length === 0) && selected.name) {
      console.log("Recent updates: venue_id returned no rows, falling back to venue_name", selected.name);
      const fallback = await supabase
        .from("suggested_updates")
        .select("*")
        .eq("venue_name", selected.name)
        .order("created_at", { ascending: false })
        .limit(5);

      if (fallback.error) {
        console.error("Recent updates error (venue_name fallback):", fallback.error);
        setRecentUpdates([]);
        return;
      }

      data = fallback.data;
    }

    console.log("Recent updates fetched:", data);
    setRecentUpdates(data || []);
  }

  useEffect(() => {
    let ignore = false;

    async function loadUpdates() {
      if (ignore) return;
      await loadRecentUpdates();
    }

    loadUpdates();

    return () => {
      ignore = true;
    };
  }, [selected]);

  const filteredVenues = useMemo(() => {
    let results = venues;

    if (city !== "All 757") {
      results = results.filter((venue) => venue.city === city);
    }

    if (activeChip !== "All") {
      const chip = activeChip.toLowerCase();

      results = results.filter((venue) => {
        const searchable = [
          venue.name,
          venue.city,
          venue.type,
          venue.music_genre,
          venue.age_limit,
          venue.cover,
          venue.parking,
          venue.dress_code,
          venue.status,
          venue.tonightEvent?.title,
          venue.tonightEvent?.genre,
          venue.tonightEvent?.dj,
          venue.tonightEvent?.cover_price,
          venue.tonightEvent?.dress_code,
          venue.tonightEvent?.description,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        return searchable.includes(chip);
      });
    }

    if (query.trim()) {
      const q = query.toLowerCase();

      results = results.filter((venue) => {
        const searchable = [
          venue.name,
          venue.city,
          venue.address,
          venue.type,
          venue.music_genre,
          venue.age_limit,
          venue.cover,
          venue.parking,
          venue.dress_code,
          venue.status,
          venue.tonightEvent?.title,
          venue.tonightEvent?.genre,
          venue.tonightEvent?.dj,
          venue.tonightEvent?.cover_price,
          venue.tonightEvent?.dress_code,
          venue.tonightEvent?.description,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        return searchable.includes(q);
      });
    }

    return results;
  }, [venues, city, activeChip, query]);

  useEffect(() => {
    if (!map) return;

    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    filteredVenues.forEach((venue) => {
      const el = document.createElement("button");

      const activity = venue.voteCount || 0;

      const size =
        activity >= 10 ? 46 : activity >= 5 ? 40 : activity >= 1 ? 34 : 28;

      el.type = "button";
      el.setAttribute("aria-label", venue.name);
      el.className = "lit-marker";
      el.style.width = `${size}px`;
      el.style.height = `${size}px`;
      el.style.border = "0";
      el.style.padding = "0";
      el.style.background = "transparent";
      el.style.cursor = "pointer";

      const core = document.createElement("div");
      core.className = "lit-marker-core";
      core.style.width = "100%";
      core.style.height = "100%";
      core.style.borderRadius = "9999px";
      core.style.background = pinColor(venue.status);
      core.style.border = "3px solid white";
      core.style.boxShadow =
        venue.status === "lit"
          ? "0 0 18px rgba(239,68,68,.95), 0 0 42px rgba(239,68,68,.55)"
          : venue.status === "decent"
          ? "0 0 16px rgba(245,179,1,.85), 0 0 34px rgba(245,179,1,.4)"
          : "0 0 10px rgba(156,163,175,.5)";
      core.style.animation =
        activity > 0 ? "litPulse 1.6s ease-in-out infinite" : "none";

      const shine = document.createElement("div");
      shine.style.width = "100%";
      shine.style.height = "100%";
      shine.style.borderRadius = "9999px";
      shine.style.background =
        "radial-gradient(circle at 35% 30%, rgba(255,255,255,.95), transparent 28%)";

      core.appendChild(shine);
      el.appendChild(core);

      el.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();

        setSelected(venue);
        setSheetExpanded(true);
        setViewMode("map");

        map.flyTo({
          center: [venue.lng, venue.lat],
          zoom: 14,
        });
      });

      const marker = new mapboxgl.Marker({ element: el, anchor: "center" })
        .setLngLat([venue.lng, venue.lat])
        .addTo(map);

      markersRef.current.push(marker);
    });
  }, [map, filteredVenues]);

  async function vote(vibe: Vibe) {
    if (!selected) return;

    const deviceId = getDeviceId();

    if (!deviceId) {
      console.error("No device ID found");
      return;
    }

    const since = new Date(Date.now() - 90 * 60 * 1000).toISOString();

    const { data: existingVote, error: findError } = await supabase
      .from("votes")
      .select("*")
      .eq("venue_id", selected.id)
      .eq("device_id", deviceId)
      .gte("created_at", since)
      .maybeSingle();

    if (findError) {
      console.error("Find vote error:", findError);
      return;
    }

    if (existingVote) {
      const { error: updateError } = await supabase
        .from("votes")
        .update({
          vibe,
          created_at: new Date().toISOString(),
        })
        .eq("id", existingVote.id);

      if (updateError) {
        console.error("Update vote error:", updateError);
        return;
      }
    } else {
      const { error: insertError } = await supabase.from("votes").insert({
        venue_id: selected.id,
        vibe,
        device_id: deviceId,
      });

      if (insertError) {
        console.error("Vote error:", insertError);
        return;
      }
    }

    await loadVenues();

    setSelected((prev) =>
      prev
        ? {
            ...prev,
            lastUpdated: new Date().toISOString(),
            voteCount: (prev.voteCount || 0) + 1,
          }
        : prev
    );

    if ("vibrate" in navigator) navigator.vibrate(40);
  }

  async function submitSuggestion() {
    if (!selected) return;

    setSuggestionLoading(true);
    setSuggestionStatus(null);
    setSuggestionFeedback("");

    try {
      const { error } = await supabase.from("suggested_updates").insert({
        venue_id: selected.id || null,
        venue_name: selected.name,
        update_type: suggestionType,
        message: suggestionMessage.trim(),
      });

      if (error) throw error;

      await loadRecentUpdates();
      await loadVenues();
      setSelected((prev) =>
        prev
          ? {
              ...prev,
              updateCount: (prev.updateCount || 0) + 1,
            }
          : prev
      );

      setSuggestionStatus("success");
      setSuggestionFeedback("Update sent — thanks for helping the city.");
      setSuggestionMessage("");
      setSuggestionType("Event info");
      setSuggestionOpen(false);
    } catch (error) {
      console.error("Suggestion error:", error);
      setSuggestionStatus("error");
      setSuggestionFeedback("Could not send update. Please try again.");
    } finally {
      setSuggestionLoading(false);
    }
  }

  async function submitEvent() {
    if (!selected) return;

    setEventLoading(true);
    setEventStatus(null);
    setEventFeedback("");

    try {
      const { error } = await supabase.from("suggested_events").insert({
        venue_id: selected.id || null,
        venue_name: selected.name,
        event_title: eventTitle.trim(),
        event_date: eventDate || null,
        start_time: eventTime.trim() || null,
        genre: eventGenre.trim() || null,
        dj: eventDj.trim() || null,
        cover_price: eventCoverPrice.trim() || null,
        age_limit: eventAgeLimit.trim() || null,
        description: eventDescription.trim() || null,
      });

      if (error) throw error;

      setEventStatus("success");
      setEventFeedback("Event submitted — we’ll review it.");
      setEventTitle("");
      setEventDate("");
      setEventTime("");
      setEventGenre("");
      setEventDj("");
      setEventCoverPrice("");
      setEventAgeLimit("");
      setEventDescription("");
      setEventOpen(false);
    } catch (error) {
      console.error("Event submit error:", error);
      setEventStatus("error");
      setEventFeedback("Could not submit event. Please try again.");
    } finally {
      setEventLoading(false);
    }
  }

  function handleTouchEnd(e: React.TouchEvent<HTMLDivElement>) {
    if (touchStartY.current === null) return;

    const endY = e.changedTouches[0].clientY;
    const diff = touchStartY.current - endY;

    if (diff > 40) setSheetExpanded(true);
    if (diff < -40) setSheetExpanded(false);

    touchStartY.current = null;
  }

  const topSpots = [...filteredVenues].sort(
    (a, b) => (b.score || 0) - (a.score || 0)
  );

  const eventSpots = filteredVenues.filter((venue) => venue.tonightEvent);
  const visibleTopSpots = sheetExpanded ? topSpots : topSpots.slice(0, 3);

  const trending = [...filteredVenues]
    .sort((a, b) => (b.trendingScore || 0) - (a.trendingScore || 0))
    .slice(0, 5);

  const trendingLabelText = trendingLabel(trending[0]?.trendingScore);
  const heroSpot = trending[0] || topSpots[0];

  const activeCount = filteredVenues.reduce(
    (sum, venue) => sum + (venue.voteCount || 0),
    0
  );

  const chips = [
    "All",
    "Hip-Hop",
    "R&B",
    "Country",
    "Latin",
    "21+",
    "Lit",
    "Events",
  ];

  const vibeGlowClass = selected?.status === "lit"
    ? "border-red-400/20 bg-red-500/10 shadow-[0_0_30px_rgba(239,68,68,0.22)]"
    : selected?.status === "decent"
    ? "border-yellow-300/20 bg-yellow-400/10 shadow-[0_0_30px_rgba(245,179,1,0.22)]"
    : "border-slate-400/20 bg-slate-500/10 shadow-[0_0_30px_rgba(148,163,184,0.22)]";

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-black text-white">
      <style jsx global>{`
        @keyframes litPulse {
          0% {
            transform: scale(1);
            filter: brightness(1);
          }
          50% {
            transform: scale(1.16);
            filter: brightness(1.25);
          }
          100% {
            transform: scale(1);
            filter: brightness(1);
          }
        }

        .lit-marker-core {
          transition: box-shadow 0.25s ease, filter 0.25s ease;
        }

        .lit-marker:hover .lit-marker-core {
          filter: brightness(1.25);
        }

        select option {
          background: #111827;
          color: white;
        }
      `}</style>

      <div ref={mapContainerRef} className="absolute inset-0 h-full w-full" />

      <div className="absolute inset-x-0 top-3 z-20 px-3 sm:left-3 sm:right-3 sm:px-0">
        <div className="rounded-[2rem] border border-white/10 bg-black/75 p-3 sm:p-4 shadow-2xl backdrop-blur-2xl">
          <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide text-red-400">
                Live in the 757
              </p>

              <h1 className="mt-1 text-xl font-black leading-tight tracking-tight sm:text-2xl">
                {activeCount > 0
                  ? `🔥 ${activeCount} active right now`
                  : "What’s lit tonight? 🔥"}
              </h1>

              <p className="mt-1 text-xs text-white/50">
                {heroSpot
                  ? `Best move: ${heroSpot.name}`
                  : "Real-time nightlife map for Hampton Roads"}
              </p>
              <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-white/55">
                  {summaryLoading
                    ? "Scanning the city..."
                    : summary || "Scanning the city..."}
                </p>
                <button
                  onClick={fetchRecommendation}
                  disabled={recommendationLoading}
                  className="inline-flex items-center justify-center gap-2 rounded-full border border-white/10 bg-gradient-to-r from-white/10 to-white/5 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-black/20 transition hover:from-white/20 hover:to-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {recommendationLoading ? (
                    <>
                      <span className="inline-flex h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-400" />
                      Finding your best move...
                    </>
                  ) : (
                    "Ask AI where to go"
                  )}
                </button>
              </div>

              {(recommendationLoading || recommendation) && (
                <div className="mt-3 rounded-3xl border border-white/10 bg-white/10 px-4 py-3 text-sm shadow-xl shadow-black/20 backdrop-blur-xl sm:max-w-2xl">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.22em] text-white/75">
                      AI Pick
                    </span>
                    <p className="text-[10px] uppercase tracking-[0.25em] text-white/45">
                      {recommendationLoading ? "Analyzing tonight’s best move" : "Premium insight"}
                    </p>
                  </div>
                  <p className="mt-2 text-sm leading-5 text-white/90">
                    {recommendationLoading
                      ? "Crunching the latest signals for your best spot."
                      : recommendationVenue ? (
                          <>
                            <span className="font-semibold text-white">
                              {recommendationVenue}
                            </span>
                            {" — "}
                            {recommendation}
                          </>
                        ) : (
                          recommendation
                        )}
                  </p>
                </div>
              )}
            </div>

            <select
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="w-full max-w-[120px] rounded-full bg-zinc-900 px-3 py-2 text-xs font-semibold text-white outline-none sm:w-auto sm:max-w-[115px]"
            >
              <option>All 757</option>
              <option>Norfolk</option>
              <option>Virginia Beach</option>
              <option>Chesapeake</option>
              <option>Portsmouth</option>
              <option>Suffolk</option>
              <option>Hampton</option>
              <option>Newport News</option>
            </select>
          </div>

          <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.08] px-3 py-2">
            <Search size={16} className="text-white/50" />
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSelected(null);
                setSheetExpanded(true);
              }}
              placeholder="Search DJ, genre, event, age..."
              className="w-full bg-transparent text-sm outline-none placeholder:text-white/35"
            />
          </div>

          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {chips.map((chip) => (
              <button
                key={chip}
                onClick={() => {
                  setActiveChip(chip);
                  setSelected(null);
                  setSheetExpanded(true);
                  if (chip === "Events") setViewMode("events");
                }}
                className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-bold transition ${
                  activeChip === chip
                    ? "bg-white text-black"
                    : "bg-white/10 text-white/75"
                }`}
              >
                {chip}
              </button>
            ))}
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 rounded-2xl bg-white/[0.08] p-1">
            <button
              onClick={() => {
                setViewMode("map");
                setSelected(null);
              }}
              className={`rounded-xl py-2 text-xs font-black ${
                viewMode === "map" ? "bg-white text-black" : "text-white/60"
              }`}
            >
              Map
            </button>

            <button
              onClick={() => {
                setViewMode("events");
                setSelected(null);
                setSheetExpanded(true);
              }}
              className={`rounded-xl py-2 text-xs font-black ${
                viewMode === "events" ? "bg-white text-black" : "text-white/60"
              }`}
            >
              Events
            </button>
          </div>
        </div>
      </div>

      <button
        onClick={() => map?.flyTo({ center: [-76.2859, 36.8508], zoom: 10 })}
        className="absolute right-4 top-56 z-20 flex h-11 w-11 items-center justify-center rounded-full bg-black/70 shadow-xl backdrop-blur-xl"
      >
        <Navigation size={18} />
      </button>

      {!selected && trending.length > 0 && viewMode === "map" && (
        <div className="absolute inset-x-3 bottom-[14vh] z-30 sm:left-3 sm:right-auto sm:bottom-[23vh]">
          <div className="flex w-full justify-start">
            <div className="w-full rounded-3xl border border-red-500/20 bg-black/80 p-3 shadow-xl shadow-red-500/15 backdrop-blur-2xl sm:w-fit sm:max-w-[min(620px,calc(100vw-2rem))]">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                <p className="text-[11px] font-black uppercase tracking-[0.28em] text-red-400">
                  {trendingLabelText}
                </p>
                <p className="text-[10px] text-white/45">Live signals</p>
              </div>

              <div className="flex gap-2 overflow-x-auto pb-1">
                {trending.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => {
                      setSelected(v);
                      setSheetExpanded(true);
                      map?.flyTo({
                        center: [v.lng, v.lat],
                        zoom: 14,
                      });
                    }}
                    className="min-w-[150px] rounded-3xl border border-white/10 bg-white/5 px-3 py-3 text-left shadow-[0_8px_30px_rgba(255,255,255,0.04)] transition hover:-translate-y-0.5 active:scale-[0.98] sm:min-w-[160px]"
                  >
                    <p className="text-sm font-bold text-white">{v.name}</p>
                    <p className="mt-1 text-[11px] text-white/45">
                      {v.music_genre || "Mixed"}
                    </p>
                    <p className="mt-1 text-[11px] text-white/50">{v.momentumLabel}</p>
                    <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/75">
                      {statusLabel(v.status)}
                    </p>
                    <p className="mt-1 text-[11px] font-bold text-red-400">
                      🔥 {v.voteCount || 0} active now
                    </p>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      <div
        className="absolute inset-x-0 bottom-0 z-30 px-3 sm:left-3 sm:right-3 sm:px-0"
        onTouchStart={(e) => {
          touchStartY.current = e.touches[0].clientY;
        }}
        onTouchEnd={handleTouchEnd}
      >
        <div
          className={`overflow-y-auto rounded-t-[2.5rem] border border-white/10 bg-zinc-950/95 p-4 shadow-[0_-18px_80px_rgba(0,0,0,0.55)] backdrop-blur-3xl transition-all duration-300 select-none ${
            selected
              ? "max-h-[70vh] sm:max-h-[64vh]"
              : sheetExpanded
              ? "max-h-[50vh] sm:max-h-[52vh]"
              : "max-h-[16vh] sm:max-h-[18vh]"
          }`}
        >
          <button
            onClick={() => setSheetExpanded((prev) => !prev)}
            className="mx-auto mb-3 flex h-6 w-20 items-center justify-center rounded-full text-white/50"
          >
            <div className="h-1 w-12 rounded-full bg-white/20" />
          </button>

          {!selected ? (
            <>
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-black">
                    {viewMode === "events"
                      ? "Events Tonight"
                      : query || activeChip !== "All"
                      ? "Matching Spots"
                      : "Top Spots Tonight"}
                  </h2>
                  <p className="text-xs text-white/45">
                    {viewMode === "events"
                      ? `${eventSpots.length} events found`
                      : `${filteredVenues.length} spots found`}
                  </p>
                </div>

                <button
                  onClick={() => setSheetExpanded((prev) => !prev)}
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10"
                >
                  {sheetExpanded ? <X size={18} /> : <ChevronUp size={20} />}
                </button>
              </div>

              {viewMode === "events" ? (
                <div className="space-y-2">
                  {eventSpots.map((venue) => (
                    <button
                      key={venue.id}
                      onClick={() => {
                        setSelected(venue);
                        setSheetExpanded(true);
                        setViewMode("map");
                        map?.flyTo({
                          center: [venue.lng, venue.lat],
                          zoom: 14,
                        });
                      }}
                      className="w-full rounded-2xl bg-white/[0.07] p-4 text-left active:scale-[0.99]"
                    >
                      <div className="mb-2 flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-black">
                            {venue.tonightEvent?.title}
                          </p>
                          <p className="text-xs text-white/45">
                            {venue.name} • {venue.city}
                          </p>
                        </div>

                        <p className="shrink-0 text-xs font-black">
                          {statusLabel(venue.status)}
                        </p>
                      </div>

                      <div className="rounded-xl bg-black/30 p-3 text-xs text-white/55">
                        <p>
                          {venue.tonightEvent?.genre || "Mixed"}
                          {venue.tonightEvent?.dj
                            ? ` • DJ: ${venue.tonightEvent.dj}`
                            : ""}
                        </p>

                        <p className="mt-1">
                          Cover: {venue.tonightEvent?.cover_price || "Varies"}
                          {venue.tonightEvent?.start_time
                            ? ` • Starts: ${venue.tonightEvent.start_time}`
                            : ""}
                        </p>

                        <p className="mt-1 text-white/40">
                          {venue.voteCount || 0} active •{" "}
                          {minutesAgo(venue.lastUpdated)}
                        </p>
                      </div>
                    </button>
                  ))}

                  {eventSpots.length === 0 && (
                    <div className="rounded-2xl bg-white/[0.07] p-4 text-sm text-white/50">
                      No events listed for tonight yet.
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  {visibleTopSpots.map((venue) => (
                    <button
                      key={venue.id}
                      onClick={() => {
                        setSelected(venue);
                        setSheetExpanded(true);
                        map?.flyTo({
                          center: [venue.lng, venue.lat],
                          zoom: 14,
                        });
                      }}
                      className="flex w-full items-center justify-between rounded-2xl border border-white/5 bg-white/[0.055] px-4 py-3 text-left shadow-sm active:scale-[0.99]"
                    >
                      <div>
                        <p className="text-sm font-bold">{venue.name}</p>
                        <p className="text-xs text-white/40">
                          {venue.tonightEvent
                            ? `${venue.tonightEvent.title} • ${
                                venue.tonightEvent.genre || "Mixed"
                              }`
                            : `${venue.music_genre || "Mixed"} • ${
                                venue.age_limit || "21+"
                              }`}
                        </p>
                        <p className="mt-1 text-[10px] text-white/50">
                          {venue.momentumLabel}
                        </p>
                      </div>

                      <div className="text-right">
                        <p className="text-sm font-black">
                          {statusLabel(venue.status)}
                        </p>
                        <p className="text-[11px] text-white/40">
                          {venue.voteCount || 0} active •{" "}
                          {minutesAgo(venue.lastUpdated)}
                        </p>
                      </div>
                    </button>
                  ))}

                  {visibleTopSpots.length === 0 && (
                    <div className="rounded-2xl bg-white/[0.07] p-4 text-sm text-white/50">
                      No spots match that yet.
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="mb-3 overflow-hidden rounded-[2rem] bg-white/5 bg-gradient-to-br from-white/10 via-white/5 to-transparent p-4 shadow-[0_0_40px_rgba(255,255,255,0.08)] backdrop-blur-xl">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate text-3xl font-extrabold leading-tight tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-white to-slate-200 drop-shadow-[0_0_14px_rgba(255,255,255,0.2)] sm:text-4xl">
                        {selected.name}
                      </h2>
                      <span className="select-none rounded-full border border-white/10 bg-white/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-white/65 backdrop-blur-xl">
                        {venueType(selected)}
                      </span>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                      <span className="select-none rounded-full bg-red-500/15 px-2.5 py-1 font-semibold uppercase tracking-[0.18em] text-red-100 ring-1 ring-red-400/20">
                        🔥 {selected.voteCount || 0} active • {selected.updateCount || 0} updates
                      </span>
                      <span className="select-none rounded-full bg-white/10 px-2.5 py-1 font-semibold uppercase tracking-[0.18em] text-white/70 ring-1 ring-white/10 backdrop-blur-xl">
                        {confidenceLabel(selected.confidence)}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => {
                        setSuggestionOpen(true);
                        setSuggestionStatus(null);
                        setSuggestionFeedback("");
                      }}
                      className="select-none flex h-10 items-center justify-center rounded-3xl bg-white/10 px-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-white transition hover:bg-white/15 focus:outline-none"
                    >
                      Suggest Update
                    </button>

                    <button
                      onClick={() => {
                        setEventOpen(true);
                        setEventStatus(null);
                        setEventFeedback("");
                      }}
                      className="select-none flex h-10 items-center justify-center rounded-3xl bg-white/10 px-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-white transition hover:bg-white/15 focus:outline-none"
                    >
                      Submit Event
                    </button>

                    <button
                      onClick={() => {
                        navigator.share?.({
                          title: selected.name,
                          text: `${selected.name} is ${statusLabel(
                            selected.status
                          )} right now on Lit757. Check before you pull up.`,
                          url: window.location.href,
                        });
                      }}
                      className="select-none flex h-10 w-10 items-center justify-center rounded-3xl bg-white/10 text-white transition hover:bg-white/15 focus:outline-none"
                    >
                      <Share2 size={18} />
                    </button>

                    <button
                      onClick={() => {
                        setSelected(null);
                        setSheetExpanded(false);
                      }}
                      className="select-none flex h-10 w-10 items-center justify-center rounded-3xl bg-white/10 text-white transition hover:bg-white/15 focus:outline-none"
                    >
                      <X size={20} />
                    </button>
                  </div>
                </div>
              </div>

              {suggestionStatus && suggestionFeedback && (
                <div
                  className={`mb-3 rounded-3xl border px-3 py-2 text-sm ${
                    suggestionStatus === "success"
                      ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-100"
                      : "border-rose-400/20 bg-rose-500/10 text-rose-100"
                  }`}
                >
                  {suggestionFeedback}
                </div>
              )}

              {eventStatus && eventFeedback && (
                <div
                  className={`mb-3 rounded-3xl border px-3 py-2 text-sm ${
                    eventStatus === "success"
                      ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-100"
                      : "border-rose-400/20 bg-rose-500/10 text-rose-100"
                  }`}
                >
                  {eventFeedback}
                </div>
              )}

              {selected.tonightEvent && (
                <div className="mb-4 rounded-3xl border border-white/10 bg-white/5 p-4">
                  <div className="mb-2 flex items-center gap-2">
                    <CalendarDays size={16} className="text-white/60" />
                    <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-white/35">
                      Tonight&apos;s Event
                    </p>
                  </div>

                  <p className="text-sm font-black leading-tight">
                    {selected.tonightEvent.title}
                  </p>

                  <p className="mt-1 text-[11px] text-white/50">
                    {selected.tonightEvent.genre || "Mixed"}
                    {selected.tonightEvent.dj
                      ? ` • DJ: ${selected.tonightEvent.dj}`
                      : ""}
                  </p>

                  <p className="mt-2 text-[11px] text-white/45">
                    Cover: {selected.tonightEvent.cover_price || "Varies"}
                    {selected.tonightEvent.start_time
                      ? ` • Starts: ${selected.tonightEvent.start_time}`
                      : ""}
                  </p>

                  {selected.tonightEvent.description && (
                    <p className="mt-3 text-sm text-white/45">
                      {selected.tonightEvent.description}
                    </p>
                  )}
                </div>
              )}

              <div className="mb-3 grid gap-2 sm:grid-cols-3">
                <div className="select-none rounded-3xl bg-white/10 backdrop-blur-xl border border-white/10 p-3 shadow-inner shadow-white/5 transition duration-200 ease-out hover:-translate-y-0.5 active:scale-[0.98]">
                  <div className="mb-2 flex items-center gap-2">
                    <Music size={16} className="text-white/60" />
                    <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-white/35">
                      Music
                    </p>
                  </div>
                  <p className="text-sm font-black leading-tight text-white">
                    {selected.tonightEvent?.genre ||
                      selected.music_genre ||
                      "Mixed"}
                  </p>
                </div>

                <div className="select-none rounded-3xl bg-white/10 backdrop-blur-xl border border-white/10 p-3 shadow-inner shadow-white/5 transition duration-200 ease-out hover:-translate-y-0.5 active:scale-[0.98]">
                  <div className="mb-2 flex items-center gap-2">
                    <UserRoundCheck size={16} className="text-white/60" />
                    <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-white/35">
                      Age
                    </p>
                  </div>
                  <p className="text-sm font-black leading-tight text-white">
                    {selected.age_limit || "21+"}
                  </p>
                </div>

                <div className="select-none rounded-3xl bg-white/10 backdrop-blur-xl border border-white/10 p-3 shadow-inner shadow-white/5 transition duration-200 ease-out hover:-translate-y-0.5 active:scale-[0.98]">
                  <div className="mb-2 flex items-center gap-2">
                    <BadgeDollarSign size={16} className="text-white/60" />
                    <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-white/35">
                      Cover
                    </p>
                  </div>
                  <p className="text-sm font-black leading-tight text-white">
                    {selected.tonightEvent?.cover_price ||
                      selected.cover ||
                      "Varies"}
                  </p>
                </div>
              </div>

              <div className="mb-3 grid grid-cols-2 gap-2">
                <div className={`select-none rounded-3xl border p-3 ${vibeGlowClass}`}>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-white/45">
                    Current Vibe
                  </p>
                  <p className="mt-3 text-lg font-extrabold text-white sm:text-xl">
                    {statusLabel(selected.status)}
                  </p>
                  <p className="mt-2 text-[11px] text-white/50">
                    {selected.momentumLabel}
                  </p>
                </div>
              </div>

              <div className="mb-4 rounded-3xl border border-white/10 bg-white/5 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-white/45">
                  Recent Updates
                </p>
                <div className="mt-3 space-y-2">
                  {recentUpdates.length === 0 ? (
                    <div className="rounded-3xl bg-white/5 p-3 text-sm text-white/55">
                      No updates yet — be the first
                    </div>
                  ) : (
                    recentUpdates.map((update) => (
                      <div
                        key={update.id}
                        className="rounded-3xl bg-white/5 p-3 text-sm text-white/90"
                      >
                        <div className="flex items-start gap-3">
                          <div className="mt-1 text-lg">
                            {updateTypeIcon(update.update_type || "")}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-white">
                              {update.message || "No message provided"}
                            </p>
                            <p className="mt-1 text-[11px] text-white/50">
                              {minutesAgo(update.created_at)}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="mb-4 rounded-3xl border border-white/10 bg-white/5 p-3 text-xs text-white/55">
                <p className="select-none">Parking: {selected.parking || "Unknown"}</p>
                <p className="select-none">
                  Dress: {selected.tonightEvent?.dress_code ||
                    selected.dress_code ||
                    "Casual"}
                </p>
              </div>

              <p className="mb-2 text-sm font-bold text-white/80 select-none">
                How&apos;s the vibe?
              </p>

              <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <button
                  onClick={() => vote("lit")}
                  className="select-none rounded-[1.75rem] border border-red-300/20 bg-gradient-to-br from-red-500 via-red-500 to-red-700 px-3 py-3 text-sm font-black shadow-lg shadow-red-500/15 transition hover:-translate-y-0.5 active:scale-[0.98]"
                >
                  <span className="block text-xl">🔥</span>
                  <span className="mt-1 block text-[10px] uppercase tracking-[0.24em]">
                    Lit
                  </span>
                </button>

                <button
                  onClick={() => vote("decent")}
                  className="select-none rounded-[1.75rem] border border-yellow-200/30 bg-gradient-to-br from-yellow-400 to-yellow-600 px-3 py-3 text-sm font-black text-black shadow-lg shadow-yellow-400/15 transition hover:-translate-y-0.5 active:scale-[0.98]"
                >
                  <span className="block text-xl">👍</span>
                  <span className="mt-1 block text-[10px] uppercase tracking-[0.24em]">
                    Decent
                  </span>
                </button>

                <button
                  onClick={() => vote("dead")}
                  className="select-none rounded-[1.75rem] border border-slate-300/20 bg-gradient-to-br from-slate-600 via-slate-700 to-slate-900 px-3 py-3 text-sm font-black shadow-lg shadow-slate-800/25 transition hover:-translate-y-0.5 active:scale-[0.98]"
                >
                  <span className="block text-xl">💤</span>
                  <span className="mt-1 block text-[10px] uppercase tracking-[0.24em]">
                    Dead
                  </span>
                </button>

                <button
                  onClick={() => vote("line_crazy")}
                  className="select-none rounded-[1.75rem] border border-purple-300/20 bg-gradient-to-br from-purple-500 to-fuchsia-700 px-3 py-3 text-sm font-black shadow-lg shadow-purple-500/15 transition hover:-translate-y-0.5 active:scale-[0.98]"
                >
                  <span className="block text-xl">🚫</span>
                  <span className="mt-1 block text-[10px] uppercase tracking-[0.24em]">
                    Line
                  </span>
                </button>
              </div>

              <a
                href={`https://www.google.com/maps/dir/?api=1&destination=${selected.lat},${selected.lng}`}
                target="_blank"
                className="select-none sticky bottom-0 z-10 block w-full rounded-3xl border border-white/10 bg-white py-3 text-center text-sm font-black text-black shadow-xl shadow-black/20"
              >
                <MapPin size={17} />
                Get Directions
              </a>
            </>
          )}
        </div>
      </div>

      {suggestionOpen && selected && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 px-4 py-6 sm:items-center">
          <div className="w-full max-w-md rounded-[2rem] border border-white/15 bg-zinc-950/95 p-5 shadow-2xl backdrop-blur-3xl">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-white/45">
                  Suggest Update
                </p>
                <h3 className="mt-2 text-lg font-black text-white">
                  Help keep the city current
                </h3>
                <p className="mt-1 text-xs text-white/50">
                  Suggest a quick update for {selected.name}.
                </p>
              </div>
              <button
                onClick={() => setSuggestionOpen(false)}
                className="rounded-full bg-white/10 p-2 text-white transition hover:bg-white/15"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-[0.24em] text-white/45">
                  Update type
                </label>
                <select
                  value={suggestionType}
                  onChange={(e) => setSuggestionType(e.target.value)}
                  className="mt-2 w-full rounded-3xl border border-white/10 bg-black/80 px-4 py-3 text-sm text-white outline-none"
                >
                  <option>Event info</option>
                  <option>Cover charge</option>
                  <option>Music/DJ</option>
                  <option>Line update</option>
                  <option>Crowd/vibe</option>
                  <option>Other</option>
                </select>
              </div>

              <div>
                <label className="text-[10px] font-semibold uppercase tracking-[0.24em] text-white/45">
                  Message
                </label>
                <textarea
                  value={suggestionMessage}
                  onChange={(e) => setSuggestionMessage(e.target.value)}
                  rows={4}
                  placeholder="Share what’s happening now…"
                  className="mt-2 w-full rounded-3xl border border-white/10 bg-black/80 px-4 py-3 text-sm text-white outline-none placeholder:text-white/35"
                />
              </div>

              <div className="rounded-3xl border border-white/10 bg-white/5 px-4 py-3 text-xs text-white/55">
                <p className="font-semibold text-white">Venue</p>
                <p>{selected.name}</p>
              </div>

              {suggestionStatus === "error" && suggestionFeedback && (
                <div className="rounded-3xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                  {suggestionFeedback}
                </div>
              )}

              <button
                onClick={submitSuggestion}
                disabled={suggestionLoading || !suggestionMessage.trim()}
                className="w-full rounded-3xl bg-white py-3 text-sm font-black text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {suggestionLoading ? "Sending update..." : "Send update"}
              </button>
            </div>
          </div>
        </div>
      )}

      {eventOpen && selected && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 px-4 py-6 sm:items-center">
          <div className="w-full max-w-md rounded-[2rem] border border-white/15 bg-zinc-950/95 p-5 shadow-2xl backdrop-blur-3xl">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-white/45">
                  Submit Event
                </p>
                <h3 className="mt-2 text-lg font-black text-white">
                  Share event details for {selected.name}
                </h3>
              </div>
              <button
                onClick={() => setEventOpen(false)}
                className="rounded-full bg-white/10 p-2 text-white transition hover:bg-white/15"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-[0.24em] text-white/45">
                  Event title
                </label>
                <input
                  value={eventTitle}
                  onChange={(e) => setEventTitle(e.target.value)}
                  placeholder="Name of the event"
                  className="mt-2 w-full rounded-3xl border border-white/10 bg-black/80 px-4 py-3 text-sm text-white outline-none"
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-[0.24em] text-white/45">
                    Event date
                  </label>
                  <input
                    type="date"
                    value={eventDate}
                    onChange={(e) => setEventDate(e.target.value)}
                    className="mt-2 w-full rounded-3xl border border-white/10 bg-black/80 px-4 py-3 text-sm text-white outline-none"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-[0.24em] text-white/45">
                    Start time
                  </label>
                  <input
                    type="time"
                    value={eventTime}
                    onChange={(e) => setEventTime(e.target.value)}
                    className="mt-2 w-full rounded-3xl border border-white/10 bg-black/80 px-4 py-3 text-sm text-white outline-none"
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-[0.24em] text-white/45">
                    Genre
                  </label>
                  <input
                    value={eventGenre}
                    onChange={(e) => setEventGenre(e.target.value)}
                    placeholder="Hip-Hop, EDM, etc."
                    className="mt-2 w-full rounded-3xl border border-white/10 bg-black/80 px-4 py-3 text-sm text-white outline-none"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-[0.24em] text-white/45">
                    DJ
                  </label>
                  <input
                    value={eventDj}
                    onChange={(e) => setEventDj(e.target.value)}
                    placeholder="DJ name"
                    className="mt-2 w-full rounded-3xl border border-white/10 bg-black/80 px-4 py-3 text-sm text-white outline-none"
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-[0.24em] text-white/45">
                    Cover price
                  </label>
                  <input
                    value={eventCoverPrice}
                    onChange={(e) => setEventCoverPrice(e.target.value)}
                    placeholder="$20, Free, etc."
                    className="mt-2 w-full rounded-3xl border border-white/10 bg-black/80 px-4 py-3 text-sm text-white outline-none"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-[0.24em] text-white/45">
                    Age limit
                  </label>
                  <input
                    value={eventAgeLimit}
                    onChange={(e) => setEventAgeLimit(e.target.value)}
                    placeholder="21+, All ages"
                    className="mt-2 w-full rounded-3xl border border-white/10 bg-black/80 px-4 py-3 text-sm text-white outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="text-[10px] font-semibold uppercase tracking-[0.24em] text-white/45">
                  Description
                </label>
                <textarea
                  value={eventDescription}
                  onChange={(e) => setEventDescription(e.target.value)}
                  rows={4}
                  placeholder="Add extra details for the event"
                  className="mt-2 w-full rounded-3xl border border-white/10 bg-black/80 px-4 py-3 text-sm text-white outline-none placeholder:text-white/35"
                />
              </div>

              <div className="rounded-3xl border border-white/10 bg-white/5 px-4 py-3 text-xs text-white/55">
                <p className="font-semibold text-white">Venue</p>
                <p>{selected.name}</p>
              </div>

              {eventStatus === "error" && eventFeedback && (
                <div className="rounded-3xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                  {eventFeedback}
                </div>
              )}

              <button
                onClick={submitEvent}
                disabled={eventLoading || !eventTitle.trim()}
                className="w-full rounded-3xl bg-white py-3 text-sm font-black text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {eventLoading ? "Submitting event..." : "Submit event"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}