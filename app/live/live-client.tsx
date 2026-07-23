"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bell, Car, Check, ChevronRight, Clock3, Flame, Heart, Info, LocateFixed, MapPin, Navigation, RefreshCw, Search, Share2, ShieldCheck, Sparkles, Ticket, TrendingDown, TrendingUp, Users, X } from "lucide-react";
import { DISCOVERY_INTENTS, type IntentId } from "../../src/lib/buzz/product-intelligence";
import type { CityPulse, DynamicCollection, LiveVenue } from "../../src/lib/buzz/platform-suite";

type Horizon = "now" | "soon" | "hour" | "later" | "typical";
type LivePayload = {
  success: boolean;
  generatedAt: string;
  pulse: CityPulse;
  collections: DynamicCollection[];
  metrics: { coveragePct: number; livePct: number; highConfidencePct: number; arrivalCoveragePct: number; unknownCount: number; manipulationRiskCount: number };
  picks: LiveVenue[];
  venues: LiveVenue[];
  error?: string;
};

type Watch = { id: string; name: string; kind: "venue" | "area"; mode: "essential" | "balanced" | "live" };
const WATCH_KEY = "buzz:platform-watches:v1";
const HORIZONS: Array<{ id: Horizon; label: string }> = [
  { id: "now", label: "Now" },
  { id: "soon", label: "+30 min" },
  { id: "hour", label: "+1 hour" },
  { id: "later", label: "Later tonight" },
  { id: "typical", label: "Typical" },
];
const CITIES = ["All 757", "Norfolk", "Virginia Beach", "Chesapeake", "Portsmouth", "Suffolk", "Hampton", "Newport News"];

function tone(venue: LiveVenue) {
  if (venue.activity.state === "hot") return "border-[#ff8061] bg-[#fff1eb]";
  if (venue.activity.state === "active") return "border-[#e6c65d] bg-[#fff9df]";
  if (venue.activity.state === "quiet") return "border-[#8fd6bd] bg-[#effbf7]";
  return "border-black/10 bg-white/75";
}

function stateLabel(venue: LiveVenue) {
  const state = venue.activity.state === "unknown" ? "Unknown" : venue.activity.state[0].toUpperCase() + venue.activity.state.slice(1);
  const trend = venue.activity.trend === "falling" ? "Cooling" : venue.activity.trend[0].toUpperCase() + venue.activity.trend.slice(1);
  return `${state} · ${trend}`;
}

function VenueCard({ venue, onOpen, watched, onWatch }: { venue: LiveVenue; onOpen: () => void; watched: boolean; onWatch: () => void }) {
  const Trend = venue.activity.trend === "falling" ? TrendingDown : TrendingUp;
  return (
    <article className={`rounded-[1.55rem] border p-4 shadow-[0_16px_45px_rgba(17,17,16,.06)] ${tone(venue)}`}>
      <button type="button" onClick={onOpen} className="w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ff5c35] rounded-2xl">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-white/75 px-2.5 py-1 text-[9px] font-bold uppercase tracking-[.13em] text-black/64">{venue.activity.truthMode.replaceAll("_", " ")}</span>
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-black/52"><Trend size={11} />{venue.activity.trend}</span>
            </div>
            <h3 className="mt-3 truncate text-[21px] font-semibold tracking-[-.04em] text-[#171716]">{venue.name}</h3>
            <p className="mt-1 text-[11px] text-black/44">{venue.city} · {venue.practical.open}</p>
          </div>
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#171716] text-white"><Flame size={17} fill={venue.activity.state === "hot" ? "currentColor" : "none"} /></span>
        </div>
        <p className="mt-4 text-[14px] font-semibold text-black/72">{stateLabel(venue)}</p>
        <p className="mt-1 text-[11px] text-black/46">{venue.activity.freshnessLabel} · {venue.activity.confidence} confidence</p>
        <p className="mt-3 line-clamp-2 text-[12px] leading-5 text-black/58">{venue.whyNow[0] || venue.activity.reason}</p>
        <div className="mt-4 rounded-[1.1rem] bg-[#171716] px-3.5 py-3 text-white">
          <p className="text-[9px] font-bold uppercase tracking-[.14em] text-[#ff9b82]">When you arrive</p>
          <p className="mt-1 text-[12px] font-semibold">{venue.arrival.label}</p>
        </div>
      </button>
      <div className="mt-3 flex items-center gap-2">
        <button type="button" onClick={onWatch} className={`inline-flex h-10 items-center gap-2 rounded-full px-3.5 text-[11px] font-semibold ${watched ? "bg-[#171716] text-white" : "border border-black/10 bg-white/70 text-black/62"}`}><Bell size={13} />{watched ? "Watching" : "Watch"}</button>
        <a href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(venue.address || `${venue.lat},${venue.lng}`)}`} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-2 rounded-full border border-black/10 bg-white/70 px-3.5 text-[11px] font-semibold text-black/62"><Navigation size={13} />Directions</a>
        <button type="button" onClick={onOpen} className="ml-auto inline-flex h-10 w-10 items-center justify-center rounded-full text-black/45"><ChevronRight size={17} /></button>
      </div>
    </article>
  );
}

function Detail({ venue, watched, onWatch, onClose }: { venue: LiveVenue; watched: boolean; onWatch: () => void; onClose: () => void }) {
  const [report, setReport] = useState("");
  const [message, setMessage] = useState("");
  const [shareMessage, setShareMessage] = useState("");
  async function share() {
    const url = new URL(window.location.href);
    url.searchParams.set("venue", venue.id);
    const text = `${venue.name}: ${stateLabel(venue)}. ${venue.arrival.label}`;
    if (navigator.share) await navigator.share({ title: venue.name, text, url: url.toString() }).catch(() => undefined);
    else await navigator.clipboard.writeText(`${text} ${url}`).then(() => setShareMessage("Link copied.")).catch(() => setShareMessage("Could not copy link."));
  }
  async function submitReport() {
    if (!report) return;
    setMessage("Submitting…");
    const response = await fetch("/api/contributions/activity", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ venueId: venue.id, status: report, verifiedNearby: false }) });
    const payload = await response.json().catch(() => ({}));
    setMessage(response.ok ? payload.message || "Fresh report received." : payload.error || "Sign in and verify nearby to submit this report.");
  }
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-[#f7f5ef] lg:absolute lg:inset-y-0 lg:left-auto lg:right-0 lg:w-[480px] lg:border-l lg:border-black/10 lg:shadow-2xl">
      <div className="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-black/8 bg-[#f7f5ef]/95 px-4 backdrop-blur-xl">
        <button type="button" onClick={onClose} className="inline-flex h-10 items-center gap-2 rounded-full px-3 text-[12px] font-semibold text-black/60"><X size={16} />Close</button>
        <div className="flex gap-2">
          <button type="button" onClick={share} className="flex h-10 w-10 items-center justify-center rounded-full border border-black/10 bg-white"><Share2 size={15} /></button>
          <button type="button" onClick={onWatch} className={`flex h-10 w-10 items-center justify-center rounded-full ${watched ? "bg-[#171716] text-white" : "border border-black/10 bg-white"}`}><Heart size={15} fill={watched ? "currentColor" : "none"} /></button>
        </div>
      </div>
      <div className="p-5 pb-28">
        <p className="text-[10px] font-bold uppercase tracking-[.16em] text-[#d44b2b]">{venue.city} · {venue.activity.truthMode.replaceAll("_", " ")}</p>
        <h2 className="mt-3 text-[38px] font-semibold leading-[.98] tracking-[-.055em]">{venue.name}</h2>
        <p className="mt-3 text-[14px] leading-6 text-black/55">{venue.activity.reason}</p>
        {shareMessage && <p className="mt-2 text-[11px] text-black/45">{shareMessage}</p>}

        <section className={`mt-6 rounded-[1.5rem] border p-4 ${tone(venue)}`}>
          <div className="flex items-center justify-between"><p className="text-[18px] font-semibold">{stateLabel(venue)}</p><span className="rounded-full bg-white/70 px-3 py-1 text-[10px] font-semibold">{venue.activity.score ?? "—"}/100</span></div>
          <p className="mt-2 text-[11px] text-black/50">{venue.activity.freshnessLabel} · {venue.activity.confidence} confidence</p>
          <p className="mt-3 text-[12px] leading-5 text-black/62">{venue.whyNow.join(" ")}</p>
          <div className="mt-4 flex flex-wrap gap-2">{venue.fit.map(item => <span key={item} className="rounded-full bg-white/75 px-2.5 py-1 text-[10px] font-semibold text-black/56">{item}</span>)}</div>
        </section>

        <section className="mt-4 rounded-[1.5rem] bg-[#171716] p-4 text-white">
          <p className="text-[10px] font-bold uppercase tracking-[.16em] text-[#ff8c70]">Arrival intelligence</p>
          <p className="mt-2 text-[17px] font-semibold">{venue.arrival.label}</p>
          <p className="mt-2 text-[11px] leading-5 text-white/58">{venue.arrival.detail}</p>
        </section>

        <section className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-[1.3rem] border border-black/8 bg-white/75 p-4"><Car size={16} className="text-black/40" /><p className="mt-3 text-[11px] font-semibold">Parking</p><p className="mt-1 text-[12px] text-black/50">{venue.practical.parking}</p></div>
          <div className="rounded-[1.3rem] border border-black/8 bg-white/75 p-4"><Clock3 size={16} className="text-black/40" /><p className="mt-3 text-[11px] font-semibold">Entry / line</p><p className="mt-1 text-[12px] text-black/50">{venue.practical.line}</p></div>
          <div className="rounded-[1.3rem] border border-black/8 bg-white/75 p-4"><Ticket size={16} className="text-black/40" /><p className="mt-3 text-[11px] font-semibold">Cover</p><p className="mt-1 text-[12px] text-black/50">{venue.practical.cover}</p></div>
          <div className="rounded-[1.3rem] border border-black/8 bg-white/75 p-4"><ShieldCheck size={16} className="text-black/40" /><p className="mt-3 text-[11px] font-semibold">Trust</p><p className="mt-1 text-[12px] text-black/50">{venue.trust.signalCount} signals · {venue.trust.manipulationRisk} risk</p></div>
        </section>

        <section className="mt-6 rounded-[1.5rem] border border-black/8 bg-white/75 p-4">
          <p className="text-[10px] font-bold uppercase tracking-[.14em] text-[#d44b2b]">Report what you see</p>
          <p className="mt-2 text-[12px] text-black/48">Fresh reports expire quickly and become more valuable when location-verified.</p>
          <div className="mt-3 flex flex-wrap gap-2">{["quiet", "active", "packed", "line_short", "line_long", "parking_easy", "parking_hard"].map(option => <button key={option} type="button" onClick={() => setReport(option)} className={`rounded-full px-3 py-2 text-[10px] font-semibold ${report === option ? "bg-[#171716] text-white" : "bg-black/[.055] text-black/55"}`}>{option.replaceAll("_", " ")}</button>)}</div>
          <button type="button" onClick={submitReport} disabled={!report} className="mt-4 h-11 w-full rounded-full bg-[#ff5c35] text-[12px] font-semibold text-white disabled:opacity-35">Submit fresh update</button>
          {message && <p className="mt-2 text-center text-[10px] text-black/45">{message}</p>}
        </section>
      </div>
      <div className="fixed bottom-0 right-0 z-20 w-full border-t border-black/8 bg-[#f7f5ef]/95 p-4 backdrop-blur-xl lg:w-[480px]">
        <div className="grid grid-cols-[1fr_auto] gap-2"><a href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(venue.address || `${venue.lat},${venue.lng}`)}`} target="_blank" rel="noreferrer" className="flex h-12 items-center justify-center gap-2 rounded-full bg-[#171716] text-[12px] font-semibold text-white"><Navigation size={16} />Get directions</a><button type="button" onClick={share} className="flex h-12 items-center justify-center gap-2 rounded-full border border-black/10 bg-white px-4 text-[12px] font-semibold"><Users size={15} />Crew</button></div>
      </div>
    </div>
  );
}

export default function LiveClient() {
  const [payload, setPayload] = useState<LivePayload | null>(null);
  const [intent, setIntent] = useState<IntentId>("best_now");
  const [horizon, setHorizon] = useState<Horizon>("now");
  const [city, setCity] = useState("All 757");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<LiveVenue | null>(null);
  const [watches, setWatches] = useState<Watch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [groupOpen, setGroupOpen] = useState(false);

  useEffect(() => { try { setWatches(JSON.parse(localStorage.getItem(WATCH_KEY) || "[]")); } catch { setWatches([]); } }, []);
  const persistWatches = useCallback((next: Watch[]) => { setWatches(next); try { localStorage.setItem(WATCH_KEY, JSON.stringify(next)); } catch {} }, []);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ intent, horizon, city });
      if (query.trim()) params.set("q", query.trim());
      if (location) { params.set("lat", String(location.lat)); params.set("lng", String(location.lng)); }
      const response = await fetch(`/api/live?${params}`, { cache: "no-store" });
      const next = await response.json() as LivePayload;
      if (!response.ok || !next.success) throw new Error(next.error || "Could not load Buzz live activity.");
      setPayload(next); setError("");
      const deepLink = new URLSearchParams(window.location.search).get("venue");
      if (deepLink) setSelected(next.venues.find(item => item.id === deepLink) || null);
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : "Could not load Buzz."); }
    finally { setLoading(false); }
  }, [intent, horizon, city, query, location]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 250); return () => window.clearTimeout(timer); }, [load]);
  useEffect(() => { const interval = window.setInterval(() => void load(), 120_000); return () => window.clearInterval(interval); }, [load]);

  function locate() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(position => setLocation({ lat: position.coords.latitude, lng: position.coords.longitude }), () => setError("Location permission is off. Buzz can still show citywide activity."), { enableHighAccuracy: false, maximumAge: 120000, timeout: 12000 });
  }
  function toggleWatch(venue: LiveVenue) {
    const exists = watches.some(item => item.id === venue.id);
    persistWatches(exists ? watches.filter(item => item.id !== venue.id) : [...watches, { id: venue.id, name: venue.name, kind: "venue", mode: "balanced" }]);
  }
  const collectionVenues = useMemo(() => new Map((payload?.venues || []).map(venue => [venue.id, venue])), [payload?.venues]);
  const watched = (id: string) => watches.some(item => item.id === id);

  return (
    <main className="min-h-screen bg-[#f7f5ef] text-[#171716]">
      <header className="sticky top-0 z-30 border-b border-black/[.07] bg-[#f7f5ef]/92 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1500px] items-center gap-3 px-4 py-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-[14px] bg-[#ff5c35] text-white"><Flame size={18} fill="currentColor" /></div>
          <div className="min-w-0"><p className="text-[18px] font-semibold tracking-[-.04em]">Buzz</p><p className="text-[9px] font-bold uppercase tracking-[.15em] text-black/36">Real-time activity</p></div>
          <label className="relative ml-auto hidden min-w-[280px] max-w-[520px] flex-1 md:block"><Search size={15} className="absolute left-4 top-3.5 text-black/35" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Active but not packed, food, parking…" className="h-11 w-full rounded-full border border-black/8 bg-white/80 pl-10 pr-4 text-[12px] outline-none focus:ring-2 focus:ring-[#ff5c35]" /></label>
          <button type="button" onClick={locate} className="flex h-10 w-10 items-center justify-center rounded-full border border-black/10 bg-white"><LocateFixed size={15} /></button>
          <button type="button" onClick={() => setGroupOpen(!groupOpen)} className="hidden h-10 items-center gap-2 rounded-full bg-[#171716] px-4 text-[11px] font-semibold text-white sm:flex"><Users size={14} />Choose for us</button>
        </div>
        <div className="mx-auto max-w-[1500px] px-4 pb-3 md:hidden"><label className="relative block"><Search size={15} className="absolute left-4 top-3.5 text-black/35" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="What are you looking for?" className="h-11 w-full rounded-full border border-black/8 bg-white/80 pl-10 pr-4 text-[12px] outline-none" /></label></div>
      </header>

      <div className="mx-auto max-w-[1500px] px-4 py-5">
        <section className="rounded-[1.8rem] bg-[#171716] p-5 text-white shadow-[0_24px_70px_rgba(0,0,0,.15)]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-3xl"><p className="text-[10px] font-bold uppercase tracking-[.17em] text-[#ff8c70]">757 city pulse</p><h1 className="mt-2 text-[28px] font-semibold leading-[1.05] tracking-[-.05em] sm:text-[38px]">{payload?.pulse.headline || "Reading the city right now…"}</h1><div className="mt-4 space-y-1">{payload?.pulse.changes.slice(0, 3).map(change => <p key={change} className="text-[11px] text-white/55">• {change}</p>)}</div></div>
            <div className="grid grid-cols-2 gap-2 text-center"><div className="rounded-[1.1rem] bg-white/8 p-3"><p className="text-[22px] font-semibold">{payload?.metrics.livePct ?? 0}%</p><p className="text-[9px] uppercase tracking-[.12em] text-white/45">Live evidence</p></div><div className="rounded-[1.1rem] bg-white/8 p-3"><p className="text-[22px] font-semibold">{payload?.metrics.coveragePct ?? 0}%</p><p className="text-[9px] uppercase tracking-[.12em] text-white/45">Known status</p></div></div>
          </div>
        </section>

        <section className="mt-4 overflow-x-auto pb-1"><div className="flex min-w-max gap-2">{DISCOVERY_INTENTS.map(item => <button key={item.id} type="button" title={item.description} onClick={() => setIntent(item.id)} className={`h-10 rounded-full px-4 text-[11px] font-semibold ${intent === item.id ? "bg-[#ff5c35] text-white" : "border border-black/8 bg-white/75 text-black/55"}`}>{item.label}</button>)}</div></section>
        <section className="mt-3 flex flex-wrap items-center gap-2"><select value={city} onChange={event => setCity(event.target.value)} className="h-10 rounded-full border border-black/8 bg-white/75 px-4 text-[11px] font-semibold outline-none">{CITIES.map(item => <option key={item}>{item}</option>)}</select>{HORIZONS.map(item => <button key={item.id} type="button" onClick={() => setHorizon(item.id)} className={`h-10 rounded-full px-3.5 text-[10px] font-semibold ${horizon === item.id ? "bg-[#171716] text-white" : "border border-black/8 bg-white/70 text-black/50"}`}>{item.label}</button>)}<button type="button" onClick={() => void load()} className="ml-auto flex h-10 items-center gap-2 rounded-full border border-black/8 bg-white/70 px-3.5 text-[10px] font-semibold"><RefreshCw size={12} className={loading ? "animate-spin" : ""} />Refresh</button></section>

        {error && <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-[12px] text-red-700">{error}</div>}

        {groupOpen && <section className="mt-5 rounded-[1.6rem] border border-black/8 bg-white/75 p-5"><div className="flex items-center justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[.15em] text-[#d44b2b]">Choose for us</p><h2 className="mt-1 text-[22px] font-semibold tracking-[-.04em]">Crew-ready decisions</h2></div><button type="button" onClick={() => setGroupOpen(false)}><X size={17} /></button></div><p className="mt-2 text-[12px] text-black/48">Buzz is currently optimizing the ranked list for your selected intent, arrival horizon, parking friction, confidence, and active conditions. Share any venue card to open a no-install crew decision link.</p></section>}

        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <section>
            <div className="flex items-end justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[.15em] text-[#d44b2b]">Best decisions now</p><h2 className="mt-1 text-[27px] font-semibold tracking-[-.05em]">Go while it still works</h2></div><span className="text-[10px] text-black/35">Auto-refreshes every 2 min</span></div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{loading && !payload ? Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-[270px] animate-pulse rounded-[1.55rem] bg-black/[.06]" />) : payload?.picks.map(venue => <VenueCard key={venue.id} venue={venue} watched={watched(venue.id)} onWatch={() => toggleWatch(venue)} onOpen={() => setSelected(venue)} />)}</div>

            <div className="mt-9 space-y-8">{payload?.collections.map(collection => <section key={collection.id}><div className="flex items-end justify-between"><div><h3 className="text-[20px] font-semibold tracking-[-.04em]">{collection.label}</h3><p className="mt-1 text-[11px] text-black/40">{collection.description}</p></div></div><div className="mt-3 flex snap-x gap-3 overflow-x-auto pb-2">{collection.venueIds.map(id => collectionVenues.get(id)).filter(Boolean).map(venue => <button key={venue!.id} type="button" onClick={() => setSelected(venue!)} className="min-w-[245px] snap-start rounded-[1.35rem] border border-black/8 bg-white/75 p-4 text-left"><div className="flex items-center justify-between"><span className="text-[9px] font-bold uppercase tracking-[.13em] text-[#d44b2b]">{venue!.activity.truthMode.replaceAll("_", " ")}</span><MapPin size={13} className="text-black/30" /></div><p className="mt-3 truncate text-[17px] font-semibold">{venue!.name}</p><p className="mt-1 text-[11px] text-black/40">{stateLabel(venue!)}</p></button>)}</div></section>)}</div>
          </section>

          <aside className="space-y-4">
            <section className="rounded-[1.6rem] border border-black/8 bg-white/75 p-5"><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#171716] text-white"><Bell size={16} /></span><div><h3 className="text-[16px] font-semibold">Buzz watches</h3><p className="text-[10px] text-black/40">Meaningful changes, not noise</p></div></div>{watches.length ? <div className="mt-4 space-y-2">{watches.slice(0, 8).map(watch => <div key={watch.id} className="flex items-center gap-3 rounded-xl bg-black/[.04] p-3"><Check size={13} className="text-[#d44b2b]" /><span className="min-w-0 flex-1 truncate text-[11px] font-semibold">{watch.name}</span><button type="button" onClick={() => persistWatches(watches.filter(item => item.id !== watch.id))}><X size={13} className="text-black/30" /></button></div>)}</div> : <p className="mt-4 text-[11px] leading-5 text-black/45">Watch a place to get quiet alerts when it becomes Hot, starts surging, or improves before you leave.</p>}</section>
            <section className="rounded-[1.6rem] border border-black/8 bg-white/75 p-5"><div className="flex items-center gap-2"><Info size={15} className="text-[#d44b2b]" /><h3 className="text-[15px] font-semibold">How to read Buzz</h3></div><div className="mt-4 space-y-3 text-[11px] text-black/48"><p><strong className="text-black/70">Live:</strong> fresh direct evidence.</p><p><strong className="text-black/70">Confirmed:</strong> recent evidence that is aging.</p><p><strong className="text-black/70">Predicted:</strong> timing, events, movement, and learned patterns.</p><p><strong className="text-black/70">Unknown:</strong> Buzz refuses to guess.</p></div></section>
            <section className="rounded-[1.6rem] bg-[#fff0e9] p-5"><Sparkles size={17} className="text-[#d44b2b]" /><h3 className="mt-3 text-[16px] font-semibold">Privacy by design</h3><p className="mt-2 text-[11px] leading-5 text-black/48">Buzz aggregates activity into places and areas. It does not show individuals, public travel histories, homes, or exact personal locations.</p></section>
          </aside>
        </div>
      </div>
      {selected && <Detail venue={selected} watched={watched(selected.id)} onWatch={() => toggleWatch(selected)} onClose={() => setSelected(null)} />}
    </main>
  );
}
