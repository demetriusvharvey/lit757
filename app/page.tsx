"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { supabase } from "../src/lib/supabase";
import { Venue, Vibe } from "../src/types";
import { MapPin, Navigation, Share2, Flame, X, ChevronUp } from "lucide-react";

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

function venueType(venue: Venue) {
  return (venue as any).type || "Nightlife Spot";
}

function minutesAgo(date?: string | null) {
  if (!date) return "No recent votes";
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Updated just now";
  return `Updated ${mins} min ago`;
}

export default function Home() {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const touchStartY = useRef<number | null>(null);

  const [venues, setVenues] = useState<Venue[]>([]);
  const [selected, setSelected] = useState<Venue | null>(null);
  const [city, setCity] = useState("All 757");
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

        const sortedVotes = [...venueVotes].sort(
          (a, b) =>
            new Date(b.created_at).getTime() -
            new Date(a.created_at).getTime()
        );

        return {
          ...venue,
          score,
          status: getStatus(score),
          lastUpdated: sortedVotes[0]?.created_at || null,
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
    if (city === "All 757") return venues;
    return venues.filter((v) => v.city === city);
  }, [venues, city]);

  useEffect(() => {
    if (!map) return;

    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    filteredVenues.forEach((venue) => {
      const el = document.createElement("button");

      el.type = "button";
      el.setAttribute("aria-label", venue.name);
      el.style.width = venue.status === "lit" ? "34px" : "30px";
      el.style.height = venue.status === "lit" ? "34px" : "30px";
      el.style.borderRadius = "9999px";
      el.style.background = pinColor(venue.status);
      el.style.border = "3px solid white";
      el.style.boxShadow =
        venue.status === "lit"
          ? "0 0 26px rgba(239,68,68,.95)"
          : "0 0 12px rgba(0,0,0,.8)";
      el.style.cursor = "pointer";

      el.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();

        setSelected(venue);
        setSheetExpanded(true);

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

    const { error } = await supabase.from("votes").insert({
      venue_id: selected.id,
      vibe,
    });

    if (error) {
      console.error("Vote error:", error);
      return;
    }

    await loadVenues();

    setSelected((prev) =>
      prev ? { ...prev, lastUpdated: new Date().toISOString() } : prev
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

  const visibleTopSpots = sheetExpanded ? topSpots : topSpots.slice(0, 3);

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-black text-white">
      <div ref={mapContainerRef} className="absolute inset-0 h-full w-full" />

      <div className="absolute left-3 right-3 top-3 z-20">
        <div className="rounded-3xl border border-white/10 bg-black/70 px-4 py-3 shadow-2xl backdrop-blur-2xl">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-black tracking-tight">
                What’s lit tonight? 🔥
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
        </div>
      </div>

      <button
        onClick={() => map?.flyTo({ center: [-76.2859, 36.8508], zoom: 10 })}
        className="absolute right-4 top-28 z-20 flex h-11 w-11 items-center justify-center rounded-full bg-black/70 shadow-xl backdrop-blur-xl"
      >
        <Navigation size={18} />
      </button>

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
              ? "max-h-[58vh]"
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
                  <h2 className="text-lg font-black">Top Spots Tonight</h2>
                  <p className="text-xs text-white/45">
                    Swipe up to see more spots
                  </p>
                </div>

                <button
                  onClick={() => setSheetExpanded((prev) => !prev)}
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10"
                >
                  {sheetExpanded ? (
                    <X size={18} />
                  ) : (
                    <ChevronUp size={20} />
                  )}
                </button>
              </div>

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
                      <p className="text-xs text-white/40">{venue.city}</p>
                    </div>

                    <div className="text-right">
                      <p className="text-sm font-black">
                        {statusLabel(venue.status)}
                      </p>
                      <p className="text-[11px] text-white/40">
                        {minutesAgo(venue.lastUpdated)}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
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

              <p className="mb-2 text-sm font-bold text-white/80">
                How’s the vibe?
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