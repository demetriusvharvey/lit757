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
};

const VIBE_SCORE: Record<Vibe, number> = {
  lit: 2,
  decent: 1,
  dead: -2,
  line_crazy: 1,
};

function getStatus(score: number) {
  if (score >= 5) return "lit";
  if (score >= 1) return "decent";
  return "dead";
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

    const enriched =
      venuesData?.map((venue) => {
        const venueVotes =
          votesData?.filter((vote) => vote.venue_id === venue.id) || [];

        const score = venueVotes.reduce(
          (sum, vote) => sum + VIBE_SCORE[vote.vibe as Vibe],
          0
        );

        const voteCount = venueVotes.length;

        const sortedVotes = [...venueVotes].sort(
          (a, b) =>
            new Date(b.created_at).getTime() -
            new Date(a.created_at).getTime()
        );

        const tonightEvent =
          eventsData?.find((event) => event.venue_id === venue.id) || null;

        return {
          ...venue,
          score,
          voteCount,
          status: getStatus(score),
          lastUpdated: sortedVotes[0]?.created_at || null,
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

      const glow =
        venue.status === "lit"
          ? "0 0 18px rgba(239,68,68,.95), 0 0 42px rgba(239,68,68,.55)"
          : venue.status === "decent"
          ? "0 0 16px rgba(245,179,1,.85), 0 0 34px rgba(245,179,1,.4)"
          : "0 0 10px rgba(156,163,175,.5)";

      el.type = "button";
      el.setAttribute("aria-label", venue.name);
      el.className = "lit-marker";
      el.style.width = `${size}px`;
      el.style.height = `${size}px`;
      el.style.borderRadius = "9999px";
      el.style.background = pinColor(venue.status);
      el.style.border = "3px solid white";
      el.style.boxShadow = glow;
      el.style.cursor = "pointer";
      el.style.transform = "translateZ(0)";
      el.style.animation =
        activity > 0 ? "litPulse 1.6s ease-in-out infinite" : "none";

      const inner = document.createElement("div");
      inner.style.width = "100%";
      inner.style.height = "100%";
      inner.style.borderRadius = "9999px";
      inner.style.background =
        "radial-gradient(circle at 35% 30%, rgba(255,255,255,.95), transparent 28%)";

      el.appendChild(inner);

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
    .filter((v) => (v.voteCount || 0) > 0)
    .sort(
      (a, b) =>
        (b.voteCount || 0) +
        (b.score || 0) -
        ((a.voteCount || 0) + (a.score || 0))
    )
    .slice(0, 5);

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

        .lit-marker {
          transition: width 0.25s ease, height 0.25s ease,
            box-shadow 0.25s ease, filter 0.25s ease;
        }

        .lit-marker:hover {
          filter: brightness(1.25);
        }
      `}</style>

      <div ref={mapContainerRef} className="absolute inset-0 h-full w-full" />

      <div className="absolute left-3 right-3 top-3 z-20">
        <div className="rounded-3xl border border-white/10 bg-black/70 px-4 py-3 shadow-2xl backdrop-blur-2xl">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-black tracking-tight">
                What&apos;s lit tonight? 🔥
              </h1>
              <p className="text-xs text-white/50">Hampton Roads nightlife</p>
            </div>

            <select
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="max-w-[115px] rounded-full bg-white/10 px-3 py-2 text-xs font-semibold outline-none"
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

          <div className="flex items-center gap-2 rounded-2xl bg-white/10 px-3 py-2">
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
                className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-bold transition ${
                  activeChip === chip
                    ? "bg-white text-black"
                    : "bg-white/10 text-white/75"
                }`}
              >
                {chip}
              </button>
            ))}
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 rounded-2xl bg-white/10 p-1">
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
        <div className="absolute bottom-[32vh] left-3 right-3 z-30">
          <div className="rounded-3xl border border-red-500/20 bg-black/80 p-3 shadow-xl backdrop-blur-2xl">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-black tracking-wide text-red-400">
                🔥 TRENDING NOW
              </p>
              <p className="text-[10px] text-white/40">Live signals</p>
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
                  className="min-w-[160px] rounded-2xl bg-white/[0.07] p-3 text-left transition active:scale-[0.98]"
                >
                  <p className="text-sm font-bold">{v.name}</p>

                  <p className="mt-1 text-[11px] text-white/45">
                    {v.music_genre || "Mixed"}
                  </p>

                  <p className="mt-2 text-xs font-black">
                    {statusLabel(v.status)}
                  </p>

                  <p className="text-[11px] font-bold text-red-400">
                    🔥 {v.voteCount || 0} active now
                  </p>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div
        className="absolute bottom-3 left-3 right-3 z-30"
        onTouchStart={(e) => {
          touchStartY.current = e.touches[0].clientY;
        }}
        onTouchEnd={handleTouchEnd}
      >
        <div
          className={`overflow-y-auto rounded-[2rem] border border-white/10 bg-zinc-950/90 p-4 shadow-2xl backdrop-blur-2xl transition-all duration-300 ${
            selected
              ? "max-h-[66vh]"
              : sheetExpanded
              ? "max-h-[58vh]"
              : "max-h-[28vh]"
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
                      className="flex w-full items-center justify-between rounded-2xl bg-white/[0.07] px-4 py-3 text-left active:scale-[0.99]"
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
              <div className="mb-4 flex items-center justify-between">
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
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10"
                >
                  <Share2 size={18} />
                </button>

                <button
                  onClick={() => {
                    setSelected(null);
                    setSheetExpanded(false);
                  }}
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="mb-4">
                <h2 className="text-2xl font-black tracking-tight">
                  {selected.name}
                </h2>
                <p className="text-sm text-white/45">{venueType(selected)}</p>
                <p className="mt-2 text-sm font-bold text-red-400">
                  🔥 {selected.voteCount || 0} active right now
                </p>
              </div>

              {selected.tonightEvent && (
                <div className="mb-4 rounded-2xl border border-white/10 bg-white/[0.08] p-4">
                  <div className="mb-2 flex items-center gap-2">
                    <CalendarDays size={16} className="text-white/60" />
                    <p className="text-[10px] font-bold uppercase text-white/35">
                      Tonight&apos;s Event
                    </p>
                  </div>

                  <p className="text-base font-black">
                    {selected.tonightEvent.title}
                  </p>

                  <p className="mt-1 text-xs text-white/50">
                    {selected.tonightEvent.genre || "Mixed"}
                    {selected.tonightEvent.dj
                      ? ` • DJ: ${selected.tonightEvent.dj}`
                      : ""}
                  </p>

                  <p className="mt-1 text-xs text-white/45">
                    Cover: {selected.tonightEvent.cover_price || "Varies"}
                    {selected.tonightEvent.start_time
                      ? ` • Starts: ${selected.tonightEvent.start_time}`
                      : ""}
                  </p>

                  {selected.tonightEvent.description && (
                    <p className="mt-2 text-xs text-white/45">
                      {selected.tonightEvent.description}
                    </p>
                  )}
                </div>
              )}

              <div className="mb-4 grid grid-cols-3 gap-2">
                <div className="rounded-2xl bg-white/[0.07] p-3">
                  <Music size={15} className="mb-2 text-white/50" />
                  <p className="text-[10px] font-bold uppercase text-white/35">
                    Music
                  </p>
                  <p className="mt-1 text-xs font-black">
                    {selected.tonightEvent?.genre ||
                      selected.music_genre ||
                      "Mixed"}
                  </p>
                </div>

                <div className="rounded-2xl bg-white/[0.07] p-3">
                  <UserRoundCheck size={15} className="mb-2 text-white/50" />
                  <p className="text-[10px] font-bold uppercase text-white/35">
                    Age
                  </p>
                  <p className="mt-1 text-xs font-black">
                    {selected.age_limit || "21+"}
                  </p>
                </div>

                <div className="rounded-2xl bg-white/[0.07] p-3">
                  <BadgeDollarSign size={15} className="mb-2 text-white/50" />
                  <p className="text-[10px] font-bold uppercase text-white/35">
                    Cover
                  </p>
                  <p className="mt-1 text-xs font-black">
                    {selected.tonightEvent?.cover_price ||
                      selected.cover ||
                      "Varies"}
                  </p>
                </div>
              </div>

              <div className="mb-4 grid grid-cols-2 gap-2">
                <div className="rounded-2xl bg-white/[0.07] p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-white/35">
                    Current Vibe
                  </p>
                  <p className="mt-1 text-lg font-black">
                    {statusLabel(selected.status)}
                  </p>
                </div>

                <div className="rounded-2xl bg-white/[0.07] p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-white/35">
                    Freshness
                  </p>
                  <p className="mt-1 text-sm font-bold">
                    {minutesAgo(selected.lastUpdated)}
                  </p>
                </div>
              </div>

              <div className="mb-4 rounded-2xl bg-white/[0.07] p-3 text-xs text-white/55">
                <p>Parking: {selected.parking || "Unknown"}</p>
                <p>
                  Dress:{" "}
                  {selected.tonightEvent?.dress_code ||
                    selected.dress_code ||
                    "Casual"}
                </p>
              </div>

              <p className="mb-2 text-sm font-bold text-white/80">
                How&apos;s the vibe?
              </p>

              <div className="mb-3 grid grid-cols-4 gap-2">
                <button
                  onClick={() => vote("lit")}
                  className="rounded-2xl bg-red-500/90 px-2 py-3 text-xs font-black"
                >
                  🔥
                  <br />
                  Lit
                </button>
                <button
                  onClick={() => vote("decent")}
                  className="rounded-2xl bg-yellow-400 px-2 py-3 text-xs font-black text-black"
                >
                  👍
                  <br />
                  Decent
                </button>
                <button
                  onClick={() => vote("dead")}
                  className="rounded-2xl bg-slate-500 px-2 py-3 text-xs font-black"
                >
                  💤
                  <br />
                  Dead
                </button>
                <button
                  onClick={() => vote("line_crazy")}
                  className="rounded-2xl bg-purple-500 px-2 py-3 text-xs font-black"
                >
                  🚫
                  <br />
                  Line
                </button>
              </div>

              <a
                href={`https://www.google.com/maps/dir/?api=1&destination=${selected.lat},${selected.lng}`}
                target="_blank"
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-white py-3 text-sm font-black text-black"
              >
                <MapPin size={17} />
                Get Directions
              </a>
            </>
          )}
        </div>
      </div>
    </main>
  );
}