"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Flame, TrendingDown, TrendingUp, X } from "lucide-react";
import "./buzz-experience.css";

type Venue = {
  id: string;
  name: string;
  city?: string;
  kind?: string;
  type?: string;
  reason?: string;
  openNow?: boolean | null;
  event?: { name?: string | null } | null;
  activity?: { score?: number; trendLabel?: string; label?: string };
};

type DiscoveryPayload = { venues?: Venue[]; picks?: Venue[] };

const categories = ["All", "Food", "Bars", "Live", "Events", "Family", "Outdoors", "Sports"];
const buzzScore = (venue: Venue) => Math.max(0, Math.min(100, Number(venue.activity?.score ?? 0)));
const categoryText = (venue: Venue) => `${venue.name} ${venue.kind || ""} ${venue.type || ""} ${venue.reason || ""} ${venue.event?.name || ""}`.toLowerCase();
const matchesCategory = (venue: Venue, category: string) => {
  if (category === "All") return true;
  const text = categoryText(venue);
  if (category === "Food") return /restaurant|food|cafe|pizza|grill|kitchen|taco|burger|bakery|seafood/.test(text);
  if (category === "Bars") return /bar|brew|cocktail|wine|pub|lounge/.test(text);
  if (category === "Live") return /live|music|concert|dj|band|karaoke/.test(text);
  if (category === "Events") return Boolean(venue.event?.name) || /event|festival|show|comedy|market/.test(text);
  if (category === "Family") return /family|kids|children|zoo|aquarium|museum|playground/.test(text);
  if (category === "Outdoors") return /park|trail|beach|garden|outdoor|waterfront/.test(text);
  if (category === "Sports") return /sport|game|stadium|arena|tides|admirals|football|basketball|baseball/.test(text);
  return true;
};
const buzzLabel = (score: number) => score >= 90 ? "On fire" : score >= 75 ? "High Buzz" : score >= 50 ? "Moderate Buzz" : "Low Buzz";
const trendFor = (venue: Venue) => {
  const label = venue.activity?.trendLabel?.toLowerCase() || "";
  if (label.includes("slow") || label.includes("fall")) return "falling";
  if (label.includes("steady")) return "steady";
  return buzzScore(venue) >= 68 ? "rising" : "steady";
};
const whyBuzz = (venue: Venue) => {
  const reasons: string[] = [];
  if (venue.event?.name) reasons.push(venue.event.name);
  if (venue.reason) reasons.push(venue.reason);
  if (venue.openNow !== false) reasons.push("Open now and drawing nearby interest");
  if (buzzScore(venue) >= 75) reasons.push("Community activity is increasing");
  return reasons.slice(0, 3).length ? reasons.slice(0, 3) : ["Recent activity and local interest are building"];
};
const timeline = (venue: Venue) => {
  const base = buzzScore(venue);
  return [-18, -8, 3, 10, 5, -7].map((delta, index) => ({
    label: `${6 + index} PM`,
    value: Math.max(12, Math.min(100, base + delta)),
  }));
};

export default function BuzzExperience() {
  const [venues, setVenues] = useState<Venue[]>([]);
  const [category, setCategory] = useState("All");
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Venue | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const response = await fetch("/api/discover?city=All%20757&mode=all", { cache: "no-store" });
        const payload = await response.json() as DiscoveryPayload;
        setVenues(payload.venues || payload.picks || []);
      } catch {}
    };
    const onDiscovery = (event: Event) => {
      const payload = (event as CustomEvent<DiscoveryPayload>).detail;
      setVenues(payload?.venues || payload?.picks || []);
    };
    window.addEventListener("activity757:discovery", onDiscovery);
    void load();
    return () => window.removeEventListener("activity757:discovery", onDiscovery);
  }, []);

  useEffect(() => {
    const replaceLegacyLanguage = () => {
      document.querySelectorAll("body *").forEach((node) => {
        if (node.children.length || !(node instanceof HTMLElement)) return;
        const value = node.textContent || "";
        const next = value
          .replace(/LIVE SCORE/g, "BUZZ SCORE")
          .replace(/Score (\d+)/g, "Buzz $1")
          .replace(/Very lit/gi, "On fire")
          .replace(/LIT757/g, "Buzz757");
        if (next !== value) node.textContent = next;
      });
    };
    const observer = new MutationObserver(replaceLegacyLanguage);
    observer.observe(document.body, { childList: true, subtree: true });
    replaceLegacyLanguage();
    return () => observer.disconnect();
  }, []);

  const ranked = useMemo(() => venues
    .filter((venue) => matchesCategory(venue, category))
    .sort((a, b) => buzzScore(b) - buzzScore(a))
    .slice(0, 10), [venues, category]);

  const selectedTimeline = selected ? timeline(selected) : [];

  return <>
    <section className="buzz-launcher" aria-label="Trending by Buzz">
      <div className="buzz-category-scroll">
        {categories.map((item) => <button key={item} className={category === item ? "active" : ""} onClick={() => setCategory(item)}>{item}</button>)}
      </div>
      <button className="buzz-open" onClick={() => setOpen(true)}>
        <span><Flame /> <b>Trending by Buzz</b></span>
        <small>{ranked[0] ? `${ranked[0].name} leads at ${buzzScore(ranked[0])}` : "See what is moving now"}</small>
        <ChevronRight />
      </button>
    </section>

    {open && <div className="buzz-backdrop" onClick={() => setOpen(false)}>
      <section className="buzz-sheet" onClick={(event) => event.stopPropagation()}>
        <div className="buzz-handle" />
        <header><div><span>LIVE AROUND YOU</span><h2>Trending by Buzz</h2><p>Ranked by current activity and momentum.</p></div><button onClick={() => setOpen(false)}><X /></button></header>
        <div className="buzz-sheet-categories">{categories.map((item) => <button key={item} className={category === item ? "active" : ""} onClick={() => setCategory(item)}>{item}</button>)}</div>
        <div className="buzz-ranking">
          {ranked.map((venue, index) => {
            const trend = trendFor(venue);
            return <button key={venue.id} onClick={() => setSelected(venue)}>
              <i>{index + 1}</i><span><strong>{venue.name}</strong><small>{buzzLabel(buzzScore(venue))} · {venue.city || "Hampton Roads"}</small></span>
              <b>{buzzScore(venue)}</b>{trend === "falling" ? <TrendingDown /> : <TrendingUp className={trend === "steady" ? "steady" : ""} />}
            </button>;
          })}
        </div>
      </section>
    </div>}

    {selected && <div className="buzz-backdrop buzz-detail-backdrop" onClick={() => setSelected(null)}>
      <section className="buzz-detail" onClick={(event) => event.stopPropagation()}>
        <div className="buzz-handle" />
        <header><div><span>{buzzLabel(buzzScore(selected)).toUpperCase()}</span><h2>{selected.name}</h2><p>{selected.city || "Hampton Roads"}</p></div><button onClick={() => setSelected(null)}><X /></button></header>
        <div className="buzz-score-card"><div><small>BUZZ SCORE</small><strong>{buzzScore(selected)}</strong></div><span>{trendFor(selected) === "falling" ? "↓ Falling" : trendFor(selected) === "steady" ? "→ Steady" : "↑ Rising"}</span></div>
        <section className="buzz-timeline"><div><span>BUZZ TONIGHT</span><small>Estimated activity</small></div>{selectedTimeline.map((point) => <div className="buzz-hour" key={point.label}><small>{point.label}</small><i><b style={{ width: `${point.value}%` }} /></i><span>{point.value}</span></div>)}</section>
        <section className="buzz-why"><span>WHY THE BUZZ?</span>{whyBuzz(selected).map((reason) => <p key={reason}><Flame /> {reason}</p>)}</section>
      </section>
    </div>}
  </>;
}
