"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { supabase } from "../src/lib/supabase";
import { Event, Venue, Vibe } from "../src/types";
import {
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
  energyLevel?: "high" | "medium" | "low" | "negative";
};

type MapMode = "day" | "night";

type NavigationStep = {
  instruction: string;
  distance: number;
  duration: number;
};

type ActiveNavigation = {
  venueName: string;
  distanceMiles: number;
  durationMinutes: number;
  steps: NavigationStep[];
};

const MAPBOX_STYLES: Record<MapMode, string> = {
  day: "mapbox://styles/mapbox/outdoors-v12",
  night: "mapbox://styles/mapbox/dark-v11",
};

function getInitialMapMode(): MapMode {
  // Keep the first server render and first client render identical.
  // Browser-only values like time/localStorage can cause hydration mismatches.
  return "night";
}

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

function energyColor(level?: string) {
  if (level === "high") return "#fb923c";
  if (level === "medium") return "#facc15";
  if (level === "negative") return "#60a5fa";
  return "#94a3b8";
}

function energyGlow(level?: string) {
  if (level === "high") return "shadow-[0_0_40px_rgba(251,146,60,0.3)]";
  if (level === "medium") return "shadow-[0_0_30px_rgba(250,204,21,0.28)]";
  if (level === "negative") return "shadow-[0_0_26px_rgba(96,165,250,0.22)]";
  return "shadow-[0_0_16px_rgba(148,163,184,0.14)]";
}

function energyLabel(level?: string) {
  if (level === "high") return "🔥 heating up";
  if (level === "medium") return "📈 gaining fast";
  if (level === "negative") return "🧊 dead right now";
  return "😴 quiet night";
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

function getHeatWeight(venue: VenueWithEvent) {
  const baseVotes = venue.voteCount || 0;
  const baseUpdates = venue.updateCount || 0;
  const score = Math.max(0, venue.score || 0);
  const trending = Math.max(0, venue.trendingScore || 0);

  const rawValue = baseVotes + baseUpdates + score + trending;
  return Math.max(1, rawValue);
}

function updateMarkerElement(el: HTMLElement, venue: VenueWithEvent, zoom: number) {
  const signals = (venue.voteCount || 0) + (venue.updateCount || 0);
  const trending = (venue.trendingScore || 0);
  const hasRecentVotes = (venue.lastUpdated && Date.now() - new Date(venue.lastUpdated).getTime() <= 30 * 60 * 1000);
  const active = signals > 0 || trending > 2 || venue.status === "lit";
  
  let shouldShow = true;
  let displaySize = 0;
  
  if (zoom < 10) {
    shouldShow = active;
    displaySize = active ? Math.max(10, Math.round(16 * 0.65)) : 4;
  } else if (zoom < 12) {
    shouldShow = true;
    displaySize = active ? Math.max(12, Math.round(20 * 0.8)) : 8;
  } else {
    shouldShow = true;
    displaySize = active
      ? signals === 0 ? 16 : signals <= 2 ? 24 : signals <= 5 ? 32 : 40
      : 12;
  }
  
  el.style.display = shouldShow ? "block" : "none";
  el.style.width = `${displaySize}px`;
  el.style.height = `${displaySize}px`;
  
  const isVeryZoomedOut = zoom <= 9;
  el.style.opacity = active
    ? "1"
    : isVeryZoomedOut
      ? "0"
      : zoom < 12
        ? "0.35"
        : "0.72";

  const core = el.querySelector(".lit-marker-core") as HTMLElement | null;
  if (!core) return;

  const baseColor = active ? energyColor(venue.energyLevel) : "#64748b";
  core.style.background = baseColor;
  core.style.border = active ? "2px solid white" : zoom < 12 ? "none" : "1px solid rgba(255,255,255,0.2)";
  core.style.transform = active && zoom >= 12 && venue.energyLevel === "high" ? "scale(1.08)" : "scale(1)";
  core.style.filter = active ? "none" : "brightness(0.75)";
  
  const glow = active
    ? zoom <= 10
      ? "0 0 12px rgba(239,146,60,0.15)"
      : energyGlow(venue.energyLevel)
    : zoom < 11
      ? "none"
      : "0 0 8px rgba(148,163,184,0.1)";
  core.style.boxShadow = glow;
  
  core.style.animation =
    active && venue.energyLevel === "high" && zoom >= 12
      ? "litPulse 1.6s ease-in-out infinite"
      : "none";
}

function buildVenueHeatmapGeoJSON(
  venues: VenueWithEvent[]
): GeoJSON.FeatureCollection<GeoJSON.Geometry, GeoJSON.GeoJsonProperties> {
  type HeatFeature = GeoJSON.Feature<
    GeoJSON.Point,
    {
      weight: number;
      voteCount: number;
      updateCount: number;
      score: number;
      trendingScore: number;
    }
  >;

  const features: HeatFeature[] = venues.flatMap((venue) => {
    const active =
      (venue.voteCount || 0) > 0 ||
      (venue.updateCount || 0) > 0 ||
      (venue.score || 0) > 0;

    if (!active || !venue.lng || !venue.lat) return [];

    const weight = getHeatWeight(venue);

    return [
      {
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [venue.lng, venue.lat],
        },
        properties: {
          weight,
          voteCount: venue.voteCount || 0,
          updateCount: venue.updateCount || 0,
          score: venue.score || 0,
          trendingScore: venue.trendingScore || 0,
        },
      },
    ];
  });

  console.log("heatmap geojson build: feature count", features.length);

  return {
    type: "FeatureCollection",
    features,
  };
}

function getVibeIntensity(venue: VenueWithEvent | null) {
  if (!venue) return 12;

  const signalCount = (venue.voteCount || 0) + (venue.updateCount || 0);
  const score = Math.max(0, venue.score || 0);
  const trending = Math.max(0, venue.trendingScore || 0);
  const raw = signalCount * 12 + score * 6 + trending * 5;

  if (venue.energyLevel === "high") return Math.min(100, Math.max(72, raw));
  if (venue.energyLevel === "medium") return Math.min(78, Math.max(44, raw));
  if (venue.energyLevel === "negative") return Math.min(40, Math.max(18, raw));
  return Math.min(34, Math.max(12, raw));
}

function vibeMeterLabel(venue: VenueWithEvent | null) {
  if (!venue) return "Warming up";
  if (venue.energyLevel === "high") return "City is moving here";
  if (venue.energyLevel === "medium") return "Momentum building";
  if (venue.energyLevel === "negative") return "Cold right now";
  return "Needs more signals";
}

function buildVenuePointsGeoJSON(
  venues: VenueWithEvent[]
): GeoJSON.FeatureCollection<GeoJSON.Point, GeoJSON.GeoJsonProperties> {
  const features = venues.flatMap((venue) => {
    if (!venue.lng || !venue.lat) return [];

    const signalCount = (venue.voteCount || 0) + (venue.updateCount || 0);
    const activeScore =
      signalCount > 0 || (venue.trendingScore || 0) >= 4 || venue.status === "lit"
        ? Math.max(1, signalCount + Math.max(0, venue.trendingScore || 0))
        : 0;

    return [
      {
        type: "Feature" as const,
        id: venue.id,
        geometry: {
          type: "Point" as const,
          coordinates: [venue.lng, venue.lat],
        },
        properties: {
          id: venue.id,
          name: venue.name,
          status: venue.status || "dead",
          energyLevel: venue.energyLevel || "low",
          voteCount: venue.voteCount || 0,
          updateCount: venue.updateCount || 0,
          score: venue.score || 0,
          trendingScore: venue.trendingScore || 0,
          signalCount,
          activeScore,
        },
      },
    ];
  });

  return {
    type: "FeatureCollection",
    features,
  };
}

export default function Home() {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const filteredVenuesRef = useRef<VenueWithEvent[]>([]);
  const touchStartY = useRef<number | null>(null);

  const [venues, setVenues] = useState<VenueWithEvent[]>([]);
  const [selected, setSelected] = useState<VenueWithEvent | null>(null);
  const selectedRef = useRef<VenueWithEvent | null>(null);
  const refreshIntervalRef = useRef<number | null>(null);
  const [city, setCity] = useState("All 757");
  const [query, setQuery] = useState("");
  const [activeChip, setActiveChip] = useState("All");
  const [viewMode, setViewMode] = useState<"map" | "events">("map");
  const [map, setMap] = useState<mapboxgl.Map | null>(null);
  const userLocationMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const [heatmapEnabled, setHeatmapEnabled] = useState(true);
  const [mapMode, setMapMode] = useState<MapMode>(() => getInitialMapMode());
  const [currentZoom, setCurrentZoom] = useState(10);
  const [navigationActive, setNavigationActive] = useState<ActiveNavigation | null>(null);
  const [navigationLoading, setNavigationLoading] = useState(false);
  const [navigationError, setNavigationError] = useState<string | null>(null);
  const [sheetExpanded, setSheetExpanded] = useState(false);
  const [summary, setSummary] = useState("");
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [recommendation, setRecommendation] = useState("");
  const [recommendationVenue, setRecommendationVenue] = useState("");
  const [recommendationLoading, setRecommendationLoading] = useState(false);
  const [recommendationQuestion, setRecommendationQuestion] = useState("");
  const [recognitionActive, setRecognitionActive] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState<"idle" | "listening" | "thinking" | "speaking">("idle");
  const [voiceBubbleOpen, setVoiceBubbleOpen] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const [askModalOpen, setAskModalOpen] = useState(false);
  const [askText, setAskText] = useState("");
  const [recognitionError, setRecognitionError] = useState<string | null>(null);
  const [selectedPreference, setSelectedPreference] = useState<string | null>(null);
  const [suggestionOpen, setSuggestionOpen] = useState(false);
  const [suggestionType, setSuggestionType] = useState("Event info");
  const [suggestionMessage, setSuggestionMessage] = useState("");
  const [suggestionMediaFile, setSuggestionMediaFile] = useState<File | null>(null);
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
    media_url?: string | null;
    media_type?: string | null;
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

  async function fetchRecommendation(question?: string) {
    try {
      setRecommendationLoading(true);
      setRecommendation("");
      setRecommendationVenue("");
      setRecommendationQuestion(question || "");

      const params = new URLSearchParams();
      if (selectedPreference) params.set("preference", selectedPreference);
      if (question) params.set("question", question);
      const url = `/api/recommendation${params.toString() ? `?${params.toString()}` : ""}`;

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error("Recommendation fetch failed");
      }

      const data = await response.json();
      const recommendationText = data.recommendation || "";
      setRecommendation(recommendationText);
      setRecommendationVenue(data.venueName || "");
      return recommendationText;
    } catch (error) {
      console.error("Recommendation error:", error);
      setRecommendation("Unable to find a recommendation right now.");
      return "";
    } finally {
      setRecommendationLoading(false);
    }
  }

  function speakRecommendation(text: string) {
    if (typeof window === "undefined" || !window.speechSynthesis || !text) {
      setVoiceStatus("idle");
      return;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.onstart = () => setVoiceStatus("speaking");
    utterance.onend = () => setVoiceStatus("idle");
    utterance.onerror = () => setVoiceStatus("idle");

    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }

  async function handleAskVoice() {
    setRecognitionError(null);
    setAskText("");
    setVoiceTranscript("");
    setVoiceBubbleOpen(true);

    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setVoiceStatus("idle");
      setAskModalOpen(true);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.continuous = false;

    recognition.onstart = () => {
      setRecognitionActive(true);
      setVoiceStatus("listening");
      setRecommendation("Listening for your question...");
      setRecommendationVenue("");
    };

    recognition.onresult = async (event: any) => {
      const transcript = event.results[0]?.[0]?.transcript?.trim();
      if (!transcript) {
        setRecognitionError("Could not hear that clearly. Try typing instead.");
        setRecognitionActive(false);
        setVoiceStatus("idle");
        return;
      }

      setVoiceTranscript(transcript);
      setVoiceStatus("thinking");

      try {
        const responseText = await fetchRecommendation(transcript);
        if (responseText) {
          speakRecommendation(responseText);
        } else {
          setVoiceStatus("idle");
        }
      } finally {
        setRecognitionActive(false);
      }
    };

    recognition.onerror = (event: any) => {
      console.error("Speech recognition error:", event.error);
      setRecognitionError("Speech recognition failed. Try typing your question.");
      setRecognitionActive(false);
      setVoiceStatus("idle");
      setAskModalOpen(true);
    };

    recognition.onend = () => {
      setRecognitionActive(false);
      setVoiceStatus((current) => (current === "listening" ? "idle" : current));
    };

    recognition.start();
  }

  async function handleAskTextSubmit() {
    const question = askText.trim();
    if (!question) return;

    setAskModalOpen(false);
    setVoiceBubbleOpen(true);
    setVoiceTranscript(question);
    setVoiceStatus("thinking");

    const responseText = await fetchRecommendation(question);
    if (responseText) {
      speakRecommendation(responseText);
    } else {
      setVoiceStatus("idle");
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

        const signalWindow = 30 * 60 * 1000;
        const recentVotes = venueVotes.filter(
          (vote) => Date.now() - new Date(vote.created_at).getTime() <= signalWindow
        );
        const recentUpdates = updateMatches.filter(
          (update) => Date.now() - new Date(update.created_at).getTime() <= signalWindow
        );
        const recentSignalCount = recentVotes.length + recentUpdates.length;
        const hasSignals = voteCount > 0 || updateCount > 0;
        const positiveVoteCount = venueVotes.filter((vote) =>
          ["lit", "decent"].includes(vote.vibe)
        ).length;
        const negativeVoteCount = venueVotes.filter(
          (vote) => vote.vibe === "dead"
        ).length;
        const negativeDominant =
          negativeVoteCount > positiveVoteCount && negativeVoteCount > 0;

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
          ? "😴 quiet night"
          : "🔥 heating up";

        const tonightEvent =
          eventsData?.find((event) => event.venue_id === venue.id) || null;

        const status = getStatus(finalScore, voteCount + updateCount);
        let energyLevel: "high" | "medium" | "low" | "negative" = "low";

        if (!hasSignals) {
          energyLevel = "low";
        } else if (negativeDominant) {
          energyLevel = "negative";
        } else if (recentSignalCount >= 2) {
          energyLevel = "high";
        } else {
          energyLevel = "medium";
        }

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
          status,
          energyLevel,
          lastUpdated:
            sortedVotes[0]?.created_at || sortedUpdates[0]?.created_at || null,
          tonightEvent,
        };
      }) || [];

    setVenues(enriched);

    if (selectedRef.current) {
      const refreshedSelected = enriched.find(
        (venue) => venue.id === selectedRef.current?.id
      );
      if (refreshedSelected) {
        setSelected(refreshedSelected);
      }
    }
  }

  useEffect(() => {
    loadVenues();
  }, []);

  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  useEffect(() => {
    if (refreshIntervalRef.current) {
      window.clearInterval(refreshIntervalRef.current);
    }

    refreshIntervalRef.current = window.setInterval(() => {
      loadVenues();
    }, 20000);

    return () => {
      if (refreshIntervalRef.current) {
        window.clearInterval(refreshIntervalRef.current);
      }
    };
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
      style: MAPBOX_STYLES[mapMode],
      center: [-76.2859, 36.8508],
      zoom: 10.8,
    });

    newMap.on("load", () => {
      newMap.resize();

      if (!newMap.getSource("venue-heat")) {
        newMap.addSource("venue-heat", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: [],
          },
        });
      }

      const sourceExists = !!newMap.getSource("venue-heat");
      console.log("heatmap load: source exists", sourceExists);

      const firstSymbol = newMap
        .getStyle()
        .layers?.find((layer) => layer.type === "symbol")?.id;

      if (!newMap.getLayer("venue-heat-layer")) {
        newMap.addLayer(
          {
            id: "venue-heat-layer",
            type: "heatmap",
            source: "venue-heat",
            maxzoom: 18,
            paint: {
              "heatmap-weight": [
                "interpolate",
                ["linear"],
                ["get", "weight"],
                1,
                0.4,
                2,
                0.9,
                4,
                1.4,
                8,
                1.9,
                16,
                2.5,
              ],
              "heatmap-intensity": [
                "interpolate",
                ["linear"],
                ["zoom"],
                7,
                1.4,
                11,
                2.1,
                15,
                2.8,
              ],
              "heatmap-color": [
                "interpolate",
                ["linear"],
                ["heatmap-density"],
                0,
                "rgba(0,0,0,0)",
                0.1,
                "rgba(252,211,77,0.3)",
                0.25,
                "rgba(251,146,60,0.5)",
                0.4,
                "rgba(249,115,22,0.65)",
                0.6,
                "rgba(239,68,68,0.8)",
                0.8,
                "rgba(220,38,38,0.9)",
                1,
                "rgba(185,28,28,0.95)",
              ],
              "heatmap-radius": [
                "interpolate",
                ["linear"],
                ["zoom"],
                7,
                20,
                10,
                35,
                13,
                50,
                16,
                65,
              ],
              "heatmap-opacity": [
                "interpolate",
                ["linear"],
                ["zoom"],
                7,
                0.45,
                11,
                0.6,
                15,
                0.72,
              ],
            },
          },
          firstSymbol
        );
      }

      if (!newMap.getSource("venue-points")) {
        newMap.addSource("venue-points", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: [],
          },
        });
      }

      const activeExpression: any = [">", ["get", "activeScore"], 0];

      if (!newMap.getLayer("venue-pins-glow")) {
        newMap.addLayer({
          id: "venue-pins-glow",
          type: "circle",
          source: "venue-points",
          paint: {
            "circle-radius": [
              "interpolate",
              ["linear"],
              ["zoom"],
              8,
              ["case", activeExpression, 10, 3],
              10,
              ["case", activeExpression, 15, 5],
              12,
              ["case", activeExpression, 22, 7],
              15,
              ["case", activeExpression, 32, 10],
            ],
            "circle-color": [
              "match",
              ["get", "energyLevel"],
              "high",
              "#fb923c",
              "medium",
              "#facc15",
              "negative",
              "#60a5fa",
              "#64748b",
            ],
            "circle-blur": ["case", activeExpression, 0.75, 0.95],
            "circle-opacity": [
              "interpolate",
              ["linear"],
              ["zoom"],
              8,
              ["case", activeExpression, 0.28, 0.05],
              10,
              ["case", activeExpression, 0.38, 0.1],
              12,
              ["case", activeExpression, 0.48, 0.14],
              15,
              ["case", activeExpression, 0.58, 0.18],
            ],
          },
        });
      }

      if (!newMap.getLayer("venue-pins-core")) {
        newMap.addLayer({
          id: "venue-pins-core",
          type: "circle",
          source: "venue-points",
          paint: {
            "circle-radius": [
              "interpolate",
              ["linear"],
              ["zoom"],
              8,
              ["case", activeExpression, 4, 2.2],
              10,
              ["case", activeExpression, 6, 3.2],
              12,
              ["case", activeExpression, 8, 4.2],
              15,
              [
                "case",
                activeExpression,
                ["case", [">=", ["get", "activeScore"], 8], 12, 10],
                4.5,
              ],
            ],
            "circle-color": [
              "match",
              ["get", "energyLevel"],
              "high",
              "#fb923c",
              "medium",
              "#facc15",
              "negative",
              "#60a5fa",
              "#64748b",
            ],
            "circle-opacity": [
              "interpolate",
              ["linear"],
              ["zoom"],
              8,
              ["case", activeExpression, 1, 0.25],
              10,
              ["case", activeExpression, 1, 0.42],
              12,
              ["case", activeExpression, 1, 0.55],
              15,
              ["case", activeExpression, 1, 0.72],
            ],
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": [
              "interpolate",
              ["linear"],
              ["zoom"],
              8,
              ["case", activeExpression, 1, 0.35],
              12,
              ["case", activeExpression, 2, 0.6],
              15,
              ["case", activeExpression, 2.5, 0.85],
            ],
            "circle-stroke-opacity": ["case", activeExpression, 0.9, 0.25],
          },
        });
      }

      newMap.on("click", "venue-pins-core", (event) => {
        const feature = event.features?.[0];
        const venueId = feature?.properties?.id;
        const venue = filteredVenuesRef.current.find((item) => item.id === venueId);

        if (!venue) return;

        setSelected(venue);
        setSheetExpanded(true);
        setViewMode("map");

        newMap.flyTo({
          center: [venue.lng, venue.lat],
          zoom: Math.max(newMap.getZoom(), 14),
        });
      });

      newMap.on("mouseenter", "venue-pins-core", () => {
        newMap.getCanvas().style.cursor = "pointer";
      });

      newMap.on("mouseleave", "venue-pins-core", () => {
        newMap.getCanvas().style.cursor = "";
      });

      const pointSource = newMap.getSource("venue-points") as mapboxgl.GeoJSONSource | null;
      pointSource?.setData(buildVenuePointsGeoJSON(filteredVenuesRef.current));

      const heatSource = newMap.getSource("venue-heat") as mapboxgl.GeoJSONSource | null;
      heatSource?.setData(buildVenueHeatmapGeoJSON(filteredVenuesRef.current) as GeoJSON.FeatureCollection);

      const layerExists = !!newMap.getLayer("venue-heat-layer");
      console.log("heatmap load: layer exists", layerExists, "firstSymbol", firstSymbol);

      newMap.setLayoutProperty(
        "venue-heat-layer",
        "visibility",
        heatmapEnabled ? "visible" : "none"
      );

      const initialZoom = newMap.getZoom();
      setCurrentZoom(Math.round(initialZoom * 10) / 10);

      const handleZoomEnd = () => {
        const zoom = newMap.getZoom();
        setCurrentZoom(Math.round(zoom * 10) / 10);
      };

      const handleMoveEnd = () => {
        const zoom = newMap.getZoom();
        setCurrentZoom(Math.round(zoom * 10) / 10);
      };

      newMap.on("zoomend", handleZoomEnd);
      newMap.on("moveend", handleMoveEnd);

      return () => {
        newMap.off("zoomend", handleZoomEnd);
        newMap.off("moveend", handleMoveEnd);
      };
    });

    setMap(newMap);

    return () => {
      newMap.remove();
    };
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

    if (activeChip !== "All" && activeChip !== "Events") {
      results = results.filter((venue) => venue.category === activeChip);
    }

    if (query.trim()) {
      const q = query.toLowerCase();

      results = results.filter((venue) => {
        const searchable = [
          venue.name,
          venue.city,
          venue.address,
          venue.type,
          venue.category,
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
    filteredVenuesRef.current = filteredVenues;
  }, [filteredVenues]);

  useEffect(() => {
    if (!map) return;

    const source = map.getSource("venue-points") as mapboxgl.GeoJSONSource | null;
    if (!source) {
      console.log("venue points update: source missing");
      return;
    }

    source.setData(buildVenuePointsGeoJSON(filteredVenues));
  }, [map, filteredVenues]);

  useEffect(() => {
    if (!map) return;

    const source = map.getSource("venue-heat") as mapboxgl.GeoJSONSource | null;
    if (!source) {
      console.log("heatmap update: source missing");
      return;
    }

    const data = buildVenueHeatmapGeoJSON(filteredVenues);
    console.log("heatmap update: updating source", data.features.length);
    source.setData(data as GeoJSON.FeatureCollection);
  }, [map, filteredVenues]);

  useEffect(() => {
    if (!map) return;
    if (!map.getLayer("venue-heat-layer")) {
      console.log("heatmap toggle: layer missing");
      return;
    }

    console.log("heatmap toggle: visibility", heatmapEnabled ? "visible" : "none");
    map.setLayoutProperty(
      "venue-heat-layer",
      "visibility",
      heatmapEnabled ? "visible" : "none"
    );
  }, [map, heatmapEnabled]);

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

  async function uploadSuggestionMedia() {
    if (!suggestionMediaFile || !selected) {
      return { mediaUrl: null as string | null, mediaType: null as string | null };
    }

    const isVideo = suggestionMediaFile.type.startsWith("video/");
    const isImage = suggestionMediaFile.type.startsWith("image/");

    if (!isVideo && !isImage) {
      throw new Error("Only images and videos are supported.");
    }

    const maxSize = isVideo ? 25 * 1024 * 1024 : 8 * 1024 * 1024;
    if (suggestionMediaFile.size > maxSize) {
      throw new Error(isVideo ? "Video must be under 25MB." : "Image must be under 8MB.");
    }

    const extension = suggestionMediaFile.name.split(".").pop() || (isVideo ? "mp4" : "jpg");
    const safeVenueName = selected.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    const path = `${selected.id}/${Date.now()}-${safeVenueName}.${extension}`;

    const { error: uploadError } = await supabase.storage
      .from("update-media")
      .upload(path, suggestionMediaFile, {
        cacheControl: "3600",
        upsert: false,
        contentType: suggestionMediaFile.type,
      });

    if (uploadError) throw uploadError;

    const { data } = supabase.storage.from("update-media").getPublicUrl(path);

    return {
      mediaUrl: data.publicUrl,
      mediaType: isVideo ? "video" : "image",
    };
  }

  async function submitSuggestion() {
    if (!selected) return;

    setSuggestionLoading(true);
    setSuggestionStatus(null);
    setSuggestionFeedback("");

    try {
      const { mediaUrl, mediaType } = await uploadSuggestionMedia();

      const { error } = await supabase.from("suggested_updates").insert({
        venue_id: selected.id || null,
        venue_name: selected.name,
        update_type: suggestionType,
        message: suggestionMessage.trim(),
        media_url: mediaUrl,
        media_type: mediaType,
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
      setSuggestionMediaFile(null);
      setSuggestionType("Event info");
      setSuggestionOpen(false);
    } catch (error) {
      console.error("Suggestion error:", error);
      setSuggestionStatus("error");
      setSuggestionFeedback(error instanceof Error ? error.message : "Could not send update. Please try again.");
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

  function addVenueSourcesAndLayers(targetMap: mapboxgl.Map, modeOverride?: MapMode) {
    const effectiveMode = modeOverride || mapMode;

    if (!targetMap.isStyleLoaded()) {
      targetMap.once("style.load", () => addVenueSourcesAndLayers(targetMap, effectiveMode));
      return;
    }

    if (!targetMap.getSource("venue-heat")) {
      targetMap.addSource("venue-heat", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: [],
        },
      });
    }

    const firstSymbol = targetMap
      .getStyle()
      .layers?.find((layer) => layer.type === "symbol")?.id;

    if (!targetMap.getLayer("venue-heat-layer")) {
      targetMap.addLayer(
        {
          id: "venue-heat-layer",
          type: "heatmap",
          source: "venue-heat",
          maxzoom: 18,
          paint: {
            "heatmap-weight": [
              "interpolate",
              ["linear"],
              ["get", "weight"],
              1,
              0.4,
              2,
              0.9,
              4,
              1.4,
              8,
              1.9,
              16,
              2.5,
            ],
            "heatmap-intensity": [
              "interpolate",
              ["linear"],
              ["zoom"],
              7,
              1.4,
              11,
              2.1,
              15,
              2.8,
            ],
            "heatmap-color": [
              "interpolate",
              ["linear"],
              ["heatmap-density"],
              0,
              "rgba(0,0,0,0)",
              0.1,
              "rgba(252,211,77,0.3)",
              0.25,
              "rgba(251,146,60,0.5)",
              0.4,
              "rgba(249,115,22,0.65)",
              0.6,
              "rgba(239,68,68,0.8)",
              0.8,
              "rgba(220,38,38,0.9)",
              1,
              "rgba(185,28,28,0.95)",
            ],
            "heatmap-radius": [
              "interpolate",
              ["linear"],
              ["zoom"],
              7,
              20,
              10,
              35,
              13,
              50,
              16,
              65,
            ],
            "heatmap-opacity": [
              "interpolate",
              ["linear"],
              ["zoom"],
              7,
              0.45,
              11,
              0.6,
              15,
              0.72,
            ],
          },
        },
        firstSymbol
      );
    }

    if (!targetMap.getSource("venue-points")) {
      targetMap.addSource("venue-points", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: [],
        },
      });
    }

    const activeExpression: any = [">", ["get", "activeScore"], 0];

    if (!targetMap.getLayer("venue-pins-glow")) {
      targetMap.addLayer({
        id: "venue-pins-glow",
        type: "circle",
        source: "venue-points",
        paint: {
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            8,
            ["case", activeExpression, 10, 3],
            10,
            ["case", activeExpression, 15, 5],
            12,
            ["case", activeExpression, 22, 7],
            15,
            ["case", activeExpression, 32, 10],
          ],
          "circle-color": [
            "match",
            ["get", "energyLevel"],
            "high",
            "#fb923c",
            "medium",
            "#facc15",
            "negative",
            "#60a5fa",
            effectiveMode === "day" ? "#334155" : "#64748b",
          ],
          "circle-blur": ["case", activeExpression, 0.75, 0.95],
          "circle-opacity": [
            "interpolate",
            ["linear"],
            ["zoom"],
            8,
            ["case", activeExpression, 0.28, 0.05],
            10,
            ["case", activeExpression, 0.38, 0.1],
            12,
            ["case", activeExpression, 0.48, 0.14],
            15,
            ["case", activeExpression, 0.58, 0.18],
          ],
        },
      });
    }

    if (!targetMap.getLayer("venue-pins-core")) {
      targetMap.addLayer({
        id: "venue-pins-core",
        type: "circle",
        source: "venue-points",
        paint: {
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            8,
            ["case", activeExpression, 4, 2.2],
            10,
            ["case", activeExpression, 6, 3.2],
            12,
            ["case", activeExpression, 8, 4.2],
            15,
            [
              "case",
              activeExpression,
              ["case", [">=", ["get", "activeScore"], 8], 12, 10],
              4.5,
            ],
          ],
          "circle-color": [
            "match",
            ["get", "energyLevel"],
            "high",
            "#fb923c",
            "medium",
            "#facc15",
            "negative",
            "#60a5fa",
            effectiveMode === "day" ? "#334155" : "#64748b",
          ],
          "circle-opacity": [
            "interpolate",
            ["linear"],
            ["zoom"],
            8,
            ["case", activeExpression, 1, 0.25],
            10,
            ["case", activeExpression, 1, 0.42],
            12,
            ["case", activeExpression, 1, 0.55],
            15,
            ["case", activeExpression, 1, 0.72],
          ],
          "circle-stroke-color": effectiveMode === "day" ? "#0f172a" : "#ffffff",
          "circle-stroke-width": [
            "interpolate",
            ["linear"],
            ["zoom"],
            8,
            ["case", activeExpression, 1, 0.35],
            12,
            ["case", activeExpression, 2, 0.6],
            15,
            ["case", activeExpression, 2.5, 0.85],
          ],
          "circle-stroke-opacity": ["case", activeExpression, 0.9, 0.35],
        },
      });
    }

    const pointSource = targetMap.getSource("venue-points") as mapboxgl.GeoJSONSource | null;
    pointSource?.setData(buildVenuePointsGeoJSON(filteredVenuesRef.current));

    const heatSource = targetMap.getSource("venue-heat") as mapboxgl.GeoJSONSource | null;
    heatSource?.setData(buildVenueHeatmapGeoJSON(filteredVenuesRef.current) as GeoJSON.FeatureCollection);

    if (targetMap.getLayer("venue-heat-layer")) {
      targetMap.setLayoutProperty(
        "venue-heat-layer",
        "visibility",
        heatmapEnabled ? "visible" : "none"
      );
    }

    // Mapbox setStyle clears custom sources/layers. Hydrate twice so day/night
    // switches never leave the map without pins while the new style settles.
    window.setTimeout(() => {
      const refreshedPointSource = targetMap.getSource("venue-points") as mapboxgl.GeoJSONSource | null;
      refreshedPointSource?.setData(buildVenuePointsGeoJSON(filteredVenuesRef.current));

      const refreshedHeatSource = targetMap.getSource("venue-heat") as mapboxgl.GeoJSONSource | null;
      refreshedHeatSource?.setData(buildVenueHeatmapGeoJSON(filteredVenuesRef.current) as GeoJSON.FeatureCollection);
    }, 150);
  }

  function switchMapMode() {
    if (!map) return;

    const nextMode: MapMode = mapMode === "day" ? "night" : "day";
    setMapMode(nextMode);
    map.setStyle(MAPBOX_STYLES[nextMode]);

    const restoreCustomLayers = () => {
      addVenueSourcesAndLayers(map, nextMode);
      map.resize();
    };

    map.once("style.load", restoreCustomLayers);
    map.once("idle", restoreCustomLayers);
    window.setTimeout(restoreCustomLayers, 250);
  }

  function clearInAppNavigation() {
    if (!map) return;

    if (map.getLayer("active-route-line")) map.removeLayer("active-route-line");
    if (map.getLayer("active-route-glow")) map.removeLayer("active-route-glow");
    if (map.getSource("active-route")) map.removeSource("active-route");

    setNavigationActive(null);
    setNavigationError(null);
  }

  function drawRouteOnMap(
    routeGeometry: GeoJSON.LineString,
    userLng: number,
    userLat: number,
    venue: VenueWithEvent
  ) {
    if (!map) return;

    const routeData: GeoJSON.FeatureCollection<GeoJSON.LineString> = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: routeGeometry,
          properties: {},
        },
      ],
    };

    if (map.getSource("active-route")) {
      const source = map.getSource("active-route") as mapboxgl.GeoJSONSource;
      source.setData(routeData);
    } else {
      map.addSource("active-route", {
        type: "geojson",
        data: routeData,
      });
    }

    if (!map.getLayer("active-route-glow")) {
      map.addLayer({
        id: "active-route-glow",
        type: "line",
        source: "active-route",
        layout: {
          "line-cap": "round",
          "line-join": "round",
        },
        paint: {
          "line-color": "#fb923c",
          "line-width": 12,
          "line-opacity": 0.24,
          "line-blur": 4,
        },
      });
    }

    if (!map.getLayer("active-route-line")) {
      map.addLayer({
        id: "active-route-line",
        type: "line",
        source: "active-route",
        layout: {
          "line-cap": "round",
          "line-join": "round",
        },
        paint: {
          "line-color": "#f97316",
          "line-width": 5,
          "line-opacity": 0.95,
        },
      });
    }

    userLocationMarkerRef.current?.remove();

    const markerEl = document.createElement("div");
    markerEl.className = "user-location-marker";
    markerEl.style.pointerEvents = "none";
    markerEl.style.width = "42px";
    markerEl.style.height = "42px";

    const label = document.createElement("div");
    label.className = "user-location-label";
    label.textContent = "Start";

    const pulse = document.createElement("div");
    pulse.className = "user-location-pulse";

    const dot = document.createElement("div");
    dot.className = "user-location-dot";

    markerEl.appendChild(label);
    markerEl.appendChild(pulse);
    markerEl.appendChild(dot);

    userLocationMarkerRef.current = new mapboxgl.Marker({
      element: markerEl,
      anchor: "center",
    })
      .setLngLat([userLng, userLat])
      .addTo(map);

    const bounds = new mapboxgl.LngLatBounds();
    bounds.extend([userLng, userLat]);
    bounds.extend([venue.lng, venue.lat]);

    routeGeometry.coordinates.forEach((coord) => {
      bounds.extend(coord as [number, number]);
    });

    map.fitBounds(bounds, {
      padding: { top: 190, bottom: 260, left: 40, right: 80 },
      duration: 900,
      maxZoom: 15,
    });
  }

  async function startInAppNavigation() {
    if (!selected || !map) return;

    setNavigationLoading(true);
    setNavigationError(null);

    try {
      const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
      if (!token) throw new Error("Missing Mapbox token.");

      if (!navigator.geolocation) {
        throw new Error("Your browser does not support location services.");
      }

      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 12000,
          maximumAge: 0,
        });
      });

      const userLng = position.coords.longitude;
      const userLat = position.coords.latitude;

      const directionsUrl =
        `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/` +
        `${userLng},${userLat};${selected.lng},${selected.lat}` +
        `?geometries=geojson&overview=full&steps=true&alternatives=false&access_token=${token}`;

      const response = await fetch(directionsUrl);
      if (!response.ok) throw new Error("Could not get directions right now.");

      const data = await response.json();
      const route = data.routes?.[0];
      if (!route?.geometry) throw new Error("No route found for this venue.");

      const steps: NavigationStep[] =
        route.legs?.[0]?.steps?.map((step: any) => ({
          instruction: step.maneuver?.instruction || "Continue",
          distance: step.distance || 0,
          duration: step.duration || 0,
        })) || [];

      drawRouteOnMap(route.geometry, userLng, userLat, selected);

      setNavigationActive({
        venueName: selected.name,
        distanceMiles: route.distance / 1609.344,
        durationMinutes: Math.max(1, Math.round(route.duration / 60)),
        steps,
      });

      setSheetExpanded(false);
      setViewMode("map");
    } catch (error) {
      console.error("In-app navigation error:", error);
      setNavigationError(
        error instanceof Error
          ? error.message
          : "Could not start in-app navigation. Make sure location permission is allowed."
      );
    } finally {
      setNavigationLoading(false);
    }
  }

  function smoothZoom(direction: "in" | "out") {
    if (!map) return;

    const current = map.getZoom();
    const target = direction === "in"
      ? Math.min(16, current + 1)
      : Math.max(8, current - 1);

    map.easeTo({
      zoom: target,
      duration: 450,
      easing: (t) => t * (2 - t),
    });

    setCurrentZoom(Math.round(target * 10) / 10);
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
    "Nightlife",
    "Bars",
    "Hookah",
    "Breweries",
    "Concerts",
    "Experiences",
    "Beaches",
    "Museums",
    "Food",
    "Events",
  ];

  const vibeGlowClass = selected?.status === "lit"
    ? "border-red-400/20 bg-red-500/10 shadow-[0_0_30px_rgba(239,68,68,0.22)]"
    : selected?.status === "decent"
    ? "border-yellow-300/20 bg-yellow-400/10 shadow-[0_0_30px_rgba(245,179,1,0.22)]"
    : "border-slate-400/20 bg-slate-500/10 shadow-[0_0_30px_rgba(148,163,184,0.22)]";
  const selectedEnergyGlowClass = energyGlow(selected?.energyLevel);
  const selectedVibeIntensity = getVibeIntensity(selected);
  const selectedVibeMeterLabel = vibeMeterLabel(selected);
  const isDay = mapMode === "day";

  return (
    <main className={`relative h-screen w-screen overflow-hidden ${isDay ? "bg-slate-100 text-slate-950" : "bg-black text-white"}`}>
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

        @keyframes livePulse {
          0%, 100% {
            opacity: 1;
            transform: scale(1);
          }
          50% {
            opacity: 0.7;
            transform: scale(1.1);
          }
        }

        @keyframes cardGlow {
          0%, 100% {
            box-shadow: 0 10px 30px rgba(239, 68, 68, 0.22);
          }
          50% {
            box-shadow: 0 10px 35px rgba(239, 68, 68, 0.28);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .live-pulse,
          .card-glow {
            animation: none !important;
          }
        }

        .lit-marker-core {
          transition: box-shadow 0.25s ease, filter 0.25s ease;
        }

        .live-pulse {
          animation: livePulse 1.5s ease-in-out infinite;
        }

        .card-glow {
          animation: cardGlow 3s ease-in-out infinite;
        }

        .user-location-marker {
          position: relative;
          width: 72px;
          height: 72px;
          display: flex;
          align-items: center;
          justify-content: center;
          pointer-events: none;
        }

        .user-location-pulse {
          position: absolute;
          width: 54px;
          height: 54px;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(59, 130, 246, 0.32) 0%, rgba(59, 130, 246, 0.16) 45%, transparent 72%);
          border: 1px solid rgba(96, 165, 250, 0.45);
          animation: locationPulse 2s ease-in-out infinite;
        }

        .user-location-dot {
          position: relative;
          width: 18px;
          height: 18px;
          border-radius: 9999px;
          background: #3b82f6;
          border: 3px solid white;
          box-shadow: 0 0 22px rgba(59, 130, 246, 0.9);
        }

        .user-location-label {
          position: absolute;
          top: -8px;
          left: 50%;
          transform: translateX(-50%);
          white-space: nowrap;
          border-radius: 9999px;
          background: rgba(0, 0, 0, 0.78);
          border: 1px solid rgba(255, 255, 255, 0.16);
          color: white;
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          padding: 3px 8px;
          backdrop-filter: blur(12px);
        }

        @keyframes locationPulse {
          0% {
            transform: scale(1);
            opacity: 1;
          }
          50% {
            transform: scale(1.5);
            opacity: 0.7;
          }
          100% {
            transform: scale(1);
            opacity: 1;
          }
        }

        select option {
          background: #111827;
          color: white;
        }
      `}</style>

      <div ref={mapContainerRef} className="absolute inset-0 h-full w-full" />

      <div className="absolute inset-x-0 top-2 z-20 px-3 sm:left-3 sm:right-3 sm:px-0">
        <div className={`rounded-2xl border p-2 sm:p-3 shadow-2xl backdrop-blur-2xl ${
          isDay
            ? "border-white/70 bg-white/90 text-slate-950 shadow-slate-900/10"
            : "border-white/10 bg-black/75 text-white"
        }`}>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className={`text-[10px] font-bold uppercase tracking-wide ${isDay ? "text-red-600" : "text-red-400"}`}>
                    Live in the 757
                  </p>
                  <h1 className={`text-lg font-black leading-tight tracking-tight sm:text-xl truncate ${isDay ? "text-slate-950" : "text-white"}`}>
                    {activeCount > 0
                      ? `🔥 ${activeCount} active right now`
                      : "What’s lit tonight? 🔥"}
                  </h1>
                </div>
                <select
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  className="shrink-0 w-24 rounded-full bg-zinc-900 px-2 py-1 text-xs font-semibold text-white outline-none sm:w-28"
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

              <div className={`mt-2 flex items-center gap-2 text-xs ${isDay ? "text-slate-600" : "text-white/50"}`}>
                <p className="truncate">
                  {heroSpot
                    ? `Best move: ${heroSpot.name}`
                    : "Real-time nightlife map for Hampton Roads"}
                </p>
                <span className={`shrink-0 inline-flex items-center gap-2 rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.22em] shadow-[0_0_12px_rgba(251,146,60,0.12)] ${isDay ? "border-red-500/30 bg-red-500/10 text-red-700" : "border-red-500/20 bg-red-500/10 text-red-100"}`}>
                  <span className="h-2 w-2 rounded-full bg-red-400 live-pulse" />
                  Live
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:items-end">
              <div className="flex flex-wrap gap-1">
                {["Turn up", "Chill", "Hip-Hop", "Cheap cover", "21+"].map((pref) => (
                  <button
                    key={pref}
                    onClick={() => setSelectedPreference(selectedPreference === pref ? null : pref)}
                    className={`px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.18em] rounded-full border transition ${
                      selectedPreference === pref
                        ? isDay
                          ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-800"
                          : "border-emerald-400/30 bg-emerald-500/20 text-emerald-100"
                        : isDay
                          ? "border-slate-300/70 bg-slate-900/5 text-slate-700 hover:bg-slate-900/10"
                          : "border-white/10 bg-white/5 text-white/60 hover:bg-white/10"
                    }`}
                  >
                    {pref}
                  </button>
                ))}
              </div>
              <button
                onClick={() => fetchRecommendation()}
                disabled={recommendationLoading}
                className={`inline-flex items-center justify-center gap-1 rounded-full border px-3 py-1.5 text-xs font-semibold shadow-lg transition disabled:cursor-not-allowed disabled:opacity-60 ${isDay ? "border-slate-300/70 bg-slate-950 text-white shadow-slate-900/10 hover:bg-slate-800" : "border-white/10 bg-gradient-to-r from-white/10 to-white/5 text-white shadow-black/20 hover:from-white/20 hover:to-white/10"}`}
              >
                {recommendationLoading ? (
                  <>
                    <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
                    Finding...
                  </>
                ) : (
                  "Ask AI"
                )}
              </button>
            </div>
          </div>

          {(recommendationLoading || recommendation) && (
            <div className={`mt-2 rounded-2xl border px-3 py-2 text-xs shadow-xl backdrop-blur-xl ${isDay ? "border-slate-200/80 bg-white/75 text-slate-900 shadow-slate-900/10" : "border-white/10 bg-white/10 text-white shadow-black/20"}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.22em] ${isDay ? "bg-slate-900/10 text-slate-700" : "bg-white/10 text-white/75"}`}>
                  AI Pick
                </span>
                {selectedPreference && (
                  <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.18em] text-emerald-100 border border-emerald-400/30">
                    {selectedPreference}
                  </span>
                )}
                <p className={`text-[9px] uppercase tracking-[0.25em] ${isDay ? "text-slate-500" : "text-white/45"}`}>
                  {recommendationLoading ? "Analyzing tonight’s best move" : "Premium insight"}
                </p>
              </div>
              <p className={`mt-1 text-xs leading-4 ${isDay ? "text-slate-700" : "text-white/90"}`}>
                {recommendationLoading
                  ? "Crunching the latest signals for your best spot."
                  : recommendationVenue ? (
                      <>
                        <span className={isDay ? "font-semibold text-slate-950" : "font-semibold text-white"}>
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

          <div className={`mt-2 flex items-center gap-2 rounded-xl border px-2 py-1.5 ${isDay ? "border-slate-300/70 bg-white/80" : "border-white/10 bg-white/[0.08]"}`}>
            <Search size={14} className={isDay ? "text-slate-500" : "text-white/50"} />
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSelected(null);
                setSheetExpanded(true);
              }}
              placeholder="Search DJ, genre, event, age..."
              className={`w-full bg-transparent text-xs outline-none ${isDay ? "text-slate-950 placeholder:text-slate-500" : "text-white placeholder:text-white/35"}`}
            />
          </div>

          <div className="mt-2 flex gap-1 overflow-x-auto pb-0.5">
            {chips.map((chip) => (
              <button
                key={chip}
                onClick={() => {
                  setActiveChip(chip);
                  setSelected(null);
                  setSheetExpanded(true);
                  if (chip === "Events") setViewMode("events");
                }}
                className={`shrink-0 whitespace-nowrap rounded-full px-2 py-1 text-xs font-bold transition ${
                  activeChip === chip
                    ? isDay
                      ? "bg-slate-950 text-white shadow-sm"
                      : "bg-white text-black"
                    : isDay
                      ? "bg-slate-900/5 text-slate-700 hover:bg-slate-900/10"
                      : "bg-white/10 text-white/75"
                }`}
              >
                {chip}
              </button>
            ))}
          </div>

          <div className={`mt-2 grid grid-cols-2 gap-1 rounded-xl p-0.5 ${isDay ? "bg-slate-200/80" : "bg-white/[0.08]"}`}>
            <button
              onClick={() => {
                setViewMode("map");
                setSelected(null);
              }}
              className={`rounded-lg py-1.5 text-xs font-black transition ${
                viewMode === "map"
                  ? isDay
                    ? "bg-white text-slate-950 shadow-sm"
                    : "bg-white text-black"
                  : isDay
                    ? "text-slate-600 hover:text-slate-950"
                    : "text-white/60"
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
              className={`rounded-lg py-1.5 text-xs font-black transition ${
                viewMode === "events"
                  ? isDay
                    ? "bg-white text-slate-950 shadow-sm"
                    : "bg-white text-black"
                  : isDay
                    ? "text-slate-600 hover:text-slate-950"
                    : "text-white/60"
              }`}
            >
              Events
            </button>
          </div>
        </div>
      </div>

      <div className="absolute right-4 top-1/2 -translate-y-1/2 z-20 flex flex-col items-end gap-3">
        <button
          onClick={() => {
            if (!map) return;

            if (userLocationMarkerRef.current) {
              userLocationMarkerRef.current.remove();
              userLocationMarkerRef.current = null;
              return;
            }

            if (!navigator.geolocation) {
              console.error("Geolocation unavailable");
              map.flyTo({ center: [-76.2859, 36.8508], zoom: 10 });
              return;
            }

            navigator.geolocation.getCurrentPosition(
              (position) => {
                const { longitude, latitude } = position.coords;
                if (!map) return;
                map.flyTo({ center: [longitude, latitude], zoom: 15 });
                userLocationMarkerRef.current?.remove();

                const markerEl = document.createElement("div");
                markerEl.className = "user-location-marker";
                markerEl.style.pointerEvents = "none";
                markerEl.style.width = "42px";
                markerEl.style.height = "42px";

                const label = document.createElement("div");
                label.className = "user-location-label";
                label.textContent = "You";

                const pulse = document.createElement("div");
                pulse.className = "user-location-pulse";

                const dot = document.createElement("div");
                dot.className = "user-location-dot";

                markerEl.appendChild(label);
                markerEl.appendChild(pulse);
                markerEl.appendChild(dot);

                userLocationMarkerRef.current = new mapboxgl.Marker({
                  element: markerEl,
                  anchor: "center",
                })
                  .setLngLat([longitude, latitude])
                  .addTo(map);
              },
              (error) => {
                console.error("Geolocation error:", error);
                map.flyTo({ center: [-76.2859, 36.8508], zoom: 10 });
              },
              { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
            );
          }}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-black/70 shadow-xl backdrop-blur-xl"
          aria-label="Locate me"
        >
          <Navigation size={18} />
        </button>

        <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/70 shadow-xl backdrop-blur-xl">
          <button
            onClick={() => smoothZoom("in")}
            className="flex h-10 w-11 items-center justify-center border-b border-white/10 text-lg font-black text-white transition hover:bg-white/10 active:scale-95"
            aria-label="Zoom in"
          >
            +
          </button>
          <div className="flex h-6 w-11 items-center justify-center border-b border-white/10 bg-white/5 text-[9px] font-bold text-white/50">
            {currentZoom.toFixed(1)}
          </div>
          <button
            onClick={() => smoothZoom("out")}
            className="flex h-10 w-11 items-center justify-center text-xl font-black text-white transition hover:bg-white/10 active:scale-95"
            aria-label="Zoom out"
          >
            −
          </button>
        </div>

        <button
          onClick={switchMapMode}
          className={`flex min-w-[88px] items-center justify-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold shadow-xl backdrop-blur-xl transition ${
            mapMode === "day"
              ? "border-sky-300/40 bg-white/80 text-slate-950"
              : "border-violet-300/20 bg-black/70 text-white"
          }`}
          aria-label="Toggle day night map mode"
        >
          <span>{mapMode === "day" ? "☀️" : "🌙"}</span>
          <span>{mapMode === "day" ? "Day" : "Night"}</span>
        </button>

        <button
          onClick={() => {
            const nextValue = !heatmapEnabled;
            setHeatmapEnabled(nextValue);
            if (map?.getLayer("venue-heat-layer")) {
              map.setLayoutProperty(
                "venue-heat-layer",
                "visibility",
                nextValue ? "visible" : "none"
              );
              console.log(
                "heatmap control clicked: visibility",
                nextValue ? "visible" : "none"
              );
            }
          }}
          className={`flex min-w-[88px] items-center justify-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold transition ${
            heatmapEnabled
              ? "border-orange-400 bg-orange-500/15 text-orange-100"
              : "border-white/10 bg-white/5 text-white/65"
          }`}
          aria-pressed={heatmapEnabled}
        >
          <span>Heat</span>
          <span className="inline-flex h-6 min-w-[32px] items-center justify-center rounded-full bg-white/10 text-[10px] uppercase tracking-[0.24em]">
            {heatmapEnabled ? "On" : "Off"}
          </span>
        </button>

        <button
          onClick={handleAskVoice}
          className={`flex h-11 min-w-[88px] items-center justify-center rounded-full border px-3 py-2 text-sm font-semibold text-white transition hover:bg-white/10 ${
            voiceStatus !== "idle"
              ? "border-emerald-300/40 bg-emerald-500/15 shadow-[0_0_24px_rgba(16,185,129,0.18)]"
              : "border-white/10 bg-white/5"
          }`}
          aria-label="Ask voice concierge"
        >
          {voiceStatus === "listening"
            ? "🎙️ Listening"
            : voiceStatus === "thinking"
            ? "✨ Thinking"
            : voiceStatus === "speaking"
            ? "🔊 Speaking"
            : "🎙️ Ask"}
        </button>

        {voiceBubbleOpen && (
          <div className="w-64 rounded-3xl border border-white/10 bg-black/80 p-3 text-left shadow-2xl backdrop-blur-2xl">
            <div className="mb-2 flex items-start justify-between gap-3">
              <div>
                <p className="text-[9px] font-bold uppercase tracking-[0.24em] text-emerald-300/80">
                  Lit757 Concierge
                </p>
                <p className="mt-1 text-xs font-black text-white">
                  {voiceStatus === "listening"
                    ? "Listening..."
                    : voiceStatus === "thinking"
                    ? "Finding your best move..."
                    : voiceStatus === "speaking"
                    ? "Speaking..."
                    : "Ready"}
                </p>
              </div>
              <button
                onClick={() => {
                  setVoiceBubbleOpen(false);
                  setVoiceStatus("idle");
                  if (typeof window !== "undefined") window.speechSynthesis?.cancel();
                }}
                className="rounded-full bg-white/10 p-1.5 text-white/70 transition hover:bg-white/15"
                aria-label="Close voice concierge"
              >
                <X size={14} />
              </button>
            </div>

            {voiceTranscript && (
              <div className="mb-2 rounded-2xl bg-white/5 p-2">
                <p className="text-[9px] uppercase tracking-[0.2em] text-white/35">You asked</p>
                <p className="mt-1 text-xs text-white/80">{voiceTranscript}</p>
              </div>
            )}

            {recommendation && (
              <div className="rounded-2xl bg-emerald-500/10 p-2 ring-1 ring-emerald-300/10">
                <p className="text-[9px] uppercase tracking-[0.2em] text-emerald-200/60">AI says</p>
                <p className="mt-1 text-xs leading-4 text-white/85">
                  {recommendationVenue ? `${recommendationVenue} — ` : ""}
                  {recommendation}
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {navigationActive && viewMode === "map" && (
        <div className="absolute bottom-20 left-3 right-3 z-30 sm:bottom-24 sm:left-3 sm:right-auto sm:max-w-md">
          <div className="overflow-hidden rounded-[2rem] border border-orange-300/20 bg-black/85 shadow-2xl shadow-orange-500/20 backdrop-blur-3xl">
            <div className="border-b border-white/10 bg-gradient-to-r from-orange-500/20 via-red-500/10 to-fuchsia-500/10 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.28em] text-orange-300">
                    Live route
                  </p>
                  <h3 className="mt-1 text-lg font-black text-white">
                    {navigationActive.venueName}
                  </h3>
                  <p className="mt-1 text-xs font-semibold text-white/65">
                    {navigationActive.distanceMiles.toFixed(1)} mi • about {navigationActive.durationMinutes} min
                  </p>
                </div>
                <button
                  onClick={clearInAppNavigation}
                  className="rounded-full border border-white/10 bg-white/10 p-2 text-white/70 transition hover:bg-white/15"
                  aria-label="End navigation"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            <div className="max-h-44 overflow-y-auto p-3">
              {navigationActive.steps.slice(0, 4).map((step, index) => (
                <div
                  key={`${step.instruction}-${index}`}
                  className="mb-2 rounded-2xl border border-white/10 bg-white/[0.06] px-3 py-2 last:mb-0"
                >
                  <p className="text-xs font-bold leading-4 text-white">
                    {index + 1}. {step.instruction}
                  </p>
                  <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/40">
                    {(step.distance / 1609.344).toFixed(1)} mi
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {!selected && trending.length > 0 && viewMode === "map" && (
        <div className="absolute bottom-20 left-3 right-3 z-30 sm:bottom-24 sm:left-3 sm:right-auto sm:max-w-sm">
          <div className="w-full rounded-2xl border border-red-500/20 bg-black/80 p-2 shadow-xl shadow-red-500/15 backdrop-blur-2xl">
            <div className="mb-1 flex items-center justify-between gap-2">
              <p className="text-[10px] font-black uppercase tracking-[0.28em] text-red-400">
                {trendingLabelText}
              </p>
              <p className="text-[9px] text-white/45">Live signals</p>
            </div>

            <div className="flex gap-1 overflow-x-auto pb-0.5">
              {trending.slice(0, 3).map((v) => (
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
                  className="min-w-[120px] rounded-2xl border bg-white/5 px-2 py-2 text-left transition hover:-translate-y-0.5 active:scale-[0.98] card-glow sm:min-w-[130px]"
                  style={{
                    borderColor: energyColor(v.energyLevel),
                    boxShadow: `0 8px 20px ${energyColor(v.energyLevel)}22`,
                  }}
                >
                  <p className="text-xs font-bold text-white truncate">{v.name}</p>
                  <p className="mt-0.5 text-[10px] text-white/45 truncate">
                    {v.music_genre || "Mixed"}
                  </p>
                  <p className="mt-0.5 text-[10px] text-white/50 truncate">{v.momentumLabel}</p>
                  <p className="mt-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-white/75">
                    {statusLabel(v.status)}
                  </p>
                  <p className="mt-0.5 text-[9px] font-bold text-red-400">
                    🔥 {v.voteCount || 0} active
                  </p>
                </button>
              ))}
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
          className={`overflow-y-auto rounded-t-[2rem] border border-white/10 bg-zinc-950/95 p-3 shadow-[0_-18px_80px_rgba(0,0,0,0.55)] backdrop-blur-3xl transition-all duration-300 select-none ${
            selected
              ? sheetExpanded
                ? "max-h-[70vh] sm:max-h-[64vh]"
                : "max-h-[24vh] sm:max-h-[22vh]"
              : sheetExpanded
              ? "max-h-[45vh] sm:max-h-[48vh]"
              : "max-h-[12vh] sm:max-h-[14vh]"
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
                      className="flex w-full items-center justify-between rounded-2xl border bg-white/[0.055] px-4 py-3 text-left shadow-sm active:scale-[0.99]"
                      style={{
                        borderColor: energyColor(venue.energyLevel),
                        boxShadow: `0 10px 24px ${energyColor(venue.energyLevel)}18`,
                      }}
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
                        <p className="mt-1 text-[10px] uppercase tracking-[0.12em] text-white/40">
                          {energyLabel(venue.energyLevel)}
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
                      <span
                        className="select-none rounded-full border px-2.5 py-1 font-semibold uppercase tracking-[0.18em] text-white/85 ring-1 ring-white/10"
                        style={{
                          backgroundColor: `${energyColor(selected.energyLevel)}1f`,
                          borderColor: energyColor(selected.energyLevel),
                        }}
                      >
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

              <div className="mb-4 overflow-hidden rounded-[2rem] border border-orange-300/20 bg-gradient-to-br from-orange-500/15 via-red-500/10 to-fuchsia-500/10 p-4 shadow-2xl shadow-orange-500/10 backdrop-blur-2xl">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.28em] text-orange-300">
                      Tonight&apos;s Move
                    </p>
                    <h3 className="mt-2 text-lg font-black text-white">
                      {selected.status === "lit"
                        ? "Pull up now"
                        : selected.status === "decent"
                        ? "Worth watching"
                        : "Check before you go"}
                    </h3>
                    <p className="mt-1 text-xs leading-5 text-white/65">
                      {selected.status === "lit"
                        ? `${selected.name} is showing the strongest live energy right now. The map signals say this is one of the better moves tonight.`
                        : selected.status === "decent"
                        ? `${selected.name} has some momentum, but it is not fully on fire yet. Watch the updates or ask AI before you commit.`
                        : `${selected.name} is quiet based on the latest signals. A fresh vote or update could change this fast.`}
                    </p>
                  </div>
                  <div className="shrink-0 rounded-3xl border border-white/10 bg-black/35 px-3 py-2 text-center shadow-inner shadow-white/5">
                    <p className="text-2xl font-black text-white">{Math.round(selectedVibeIntensity)}</p>
                    <p className="text-[9px] font-bold uppercase tracking-[0.22em] text-white/40">Vibe</p>
                  </div>
                </div>

                <div className="mt-4">
                  <div className="mb-2 flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.22em] text-white/45">
                    <span>{selectedVibeMeterLabel}</span>
                    <span>{statusLabel(selected.status)}</span>
                  </div>
                  <div className="h-3 overflow-hidden rounded-full bg-white/10 ring-1 ring-white/10">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-orange-300 via-red-400 to-fuchsia-500 shadow-[0_0_22px_rgba(249,115,22,0.45)] transition-all duration-700"
                      style={{ width: `${selectedVibeIntensity}%` }}
                    />
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-2xl border border-white/10 bg-white/[0.06] px-2 py-3">
                    <p className="text-base font-black text-white">{selected.voteCount || 0}</p>
                    <p className="mt-1 text-[9px] font-bold uppercase tracking-[0.18em] text-white/40">Votes</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/[0.06] px-2 py-3">
                    <p className="text-base font-black text-white">{selected.updateCount || 0}</p>
                    <p className="mt-1 text-[9px] font-bold uppercase tracking-[0.18em] text-white/40">Updates</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/[0.06] px-2 py-3">
                    <p className="text-base font-black text-white">{selected.trendingScore || 0}</p>
                    <p className="mt-1 text-[9px] font-bold uppercase tracking-[0.18em] text-white/40">Heat</p>
                  </div>
                </div>
              </div>

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

              <div className="mb-3 grid gap-2 sm:grid-cols-2">
                <div className={`select-none rounded-[2rem] border p-4 ${vibeGlowClass} ${selectedEnergyGlowClass}`}>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-white/45">
                        Current Vibe
                      </p>
                      <p className="mt-3 text-2xl font-extrabold text-white sm:text-3xl">
                        {statusLabel(selected.status)}
                      </p>
                    </div>
                    <div className="flex h-16 w-16 items-center justify-center rounded-full border border-white/10 bg-black/30 text-xl shadow-inner shadow-white/5">
                      {selected.energyLevel === "high" ? "🔥" : selected.energyLevel === "medium" ? "📈" : selected.energyLevel === "negative" ? "🧊" : "🌙"}
                    </div>
                  </div>
                  <p className="mt-3 text-[11px] font-semibold text-white/65">
                    {selected.momentumLabel}
                  </p>
                  <p className="mt-1 text-[10px] uppercase tracking-[0.18em] text-white/40">
                    {energyLabel(selected.energyLevel)}
                  </p>
                </div>

                <div className="select-none rounded-[2rem] border border-white/10 bg-white/[0.06] p-4 shadow-inner shadow-white/5">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-white/45">
                    Crowd Confidence
                  </p>
                  <p className="mt-3 text-2xl font-extrabold text-white sm:text-3xl">
                    {confidenceLabel(selected.confidence)}
                  </p>
                  <p className="mt-3 text-[11px] leading-5 text-white/50">
                    Based on recent votes, suggested updates, event info, and last activity. More live check-ins make this smarter.
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

                        {update.media_url && (
                          <div className="mt-3 max-h-[220px] overflow-hidden rounded-2xl border border-white/10 bg-black/40">
                            {update.media_type === "video" ? (
                              <video
                                src={update.media_url}
                                controls
                                playsInline
                                className="h-full max-h-[220px] w-full object-cover"
                              />
                            ) : (
                              <img
                                src={update.media_url}
                                alt="User submitted nightlife update"
                                className="h-full max-h-[220px] w-full object-cover"
                              />
                            )}
                          </div>
                        )}
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

              <button
                type="button"
                onClick={startInAppNavigation}
                disabled={navigationLoading}
                className="select-none sticky bottom-0 z-10 flex w-full items-center justify-center gap-2 rounded-3xl border border-orange-300/30 bg-gradient-to-r from-orange-400 via-red-500 to-fuchsia-600 py-3 text-center text-sm font-black text-white shadow-xl shadow-orange-500/25 transition hover:-translate-y-0.5 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70"
              >
                <Navigation size={17} />
                {navigationLoading ? "Starting route..." : "Start In-App Navigation"}
              </button>

              {navigationError && (
                <p className="mt-2 rounded-2xl border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-100">
                  {navigationError}
                </p>
              )}
            </>
          )}
        </div>
      </div>

      {askModalOpen && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 px-4 py-6 sm:items-center">
          <div className="w-full max-w-md rounded-[2rem] border border-white/15 bg-zinc-950/95 p-5 shadow-2xl backdrop-blur-3xl">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-white/45">
                  Ask AI
                </p>
                <h3 className="mt-2 text-lg font-black text-white">
                  Type your question instead
                </h3>
                <p className="mt-1 text-xs text-white/50">
                  Speech recognition is not available or failed.
                </p>
              </div>
              <button
                onClick={() => setAskModalOpen(false)}
                className="rounded-full bg-white/10 p-2 text-white transition hover:bg-white/15"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-[0.24em] text-white/45">
                  Your question
                </label>
                <input
                  value={askText}
                  onChange={(e) => setAskText(e.target.value)}
                  placeholder="Where should I go tonight?"
                  className="mt-2 w-full rounded-3xl border border-white/10 bg-black/80 px-4 py-3 text-sm text-white outline-none"
                />
              </div>

              {recognitionError && (
                <div className="rounded-3xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                  {recognitionError}
                </div>
              )}

              <button
                onClick={handleAskTextSubmit}
                disabled={!askText.trim()}
                className="w-full rounded-3xl bg-white py-3 text-sm font-black text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Ask AI
              </button>
            </div>
          </div>
        </div>
      )}

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

              <div>
                <label className="text-[10px] font-semibold uppercase tracking-[0.24em] text-white/45">
                  Photo / video optional
                </label>
                <input
                  type="file"
                  accept="image/*,video/*"
                  onChange={(e) => setSuggestionMediaFile(e.target.files?.[0] || null)}
                  className="mt-2 w-full rounded-3xl border border-white/10 bg-black/80 px-4 py-3 text-sm text-white file:mr-3 file:rounded-full file:border-0 file:bg-white file:px-3 file:py-1.5 file:text-xs file:font-bold file:text-black"
                />
                {suggestionMediaFile && (
                  <div className="mt-2 flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/60">
                    <span className="truncate">{suggestionMediaFile.name}</span>
                    <button
                      type="button"
                      onClick={() => setSuggestionMediaFile(null)}
                      className="ml-3 rounded-full bg-white/10 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-white"
                    >
                      Remove
                    </button>
                  </div>
                )}
                <p className="mt-2 text-[11px] text-white/40">
                  MVP limit: images under 8MB, videos under 25MB. Posts show in Recent Updates after submit.
                </p>
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
