"use client";

import { useEffect } from "react";

type Venue = {
  id: string;
  name: string;
  city?: string | null;
  openNow?: boolean | null;
  event?: { name?: string | null; timeLabel?: string | null } | null;
  heat?: { level?: "active" | "hot"; label?: string; detail?: string } | null;
  activity?: {
    score: number;
    label: string;
    trendLabel: string;
    confidence: "high" | "medium" | "limited";
  };
};

type Payload = {
  generatedAt?: string;
  venues?: Venue[];
  picks?: Venue[];
};

function relativeTime(value?: string) {
  if (!value) return "Updated now";
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 20) return "Updated just now";
  if (seconds < 60) return `Updated ${seconds}s ago`;
  return `Updated ${Math.max(1, Math.round(seconds / 60))}m ago`;
}

function activityMessage(venue: Venue) {
  const trend = venue.activity?.trendLabel;
  const score = venue.activity?.score ?? 0;
  if (venue.event?.name) return `${venue.event.name}${venue.event.timeLabel ? ` · ${venue.event.timeLabel}` : ""}`;
  if (trend === "Getting Busier") return `${venue.name} is getting busier`;
  if (score >= 85) return `${venue.name} is one of the busiest places right now`;
  if (score >= 70) return `${venue.name} has strong activity right now`;
  return `${venue.name} is active now`;
}

function buildFeed(payload: Payload) {
  const venues = (payload.venues || payload.picks || [])
    .filter((venue) => venue.activity)
    .sort((a, b) => (b.activity?.score || 0) - (a.activity?.score || 0));
  if (!venues.length) return;

  const scrollArea = document.querySelector<HTMLElement>(".no-scrollbar.min-h-0.flex-1.overflow-y-auto");
  if (!scrollArea || scrollArea.querySelector("[data-live-feed]")) return;

  const anchor = Array.from(scrollArea.querySelectorAll<HTMLElement>("div")).find((node) =>
    node.getAttribute("role") === "tablist"
  );
  if (!anchor) return;

  const section = document.createElement("section");
  section.dataset.liveFeed = "true";
  section.style.marginTop = "12px";
  section.style.padding = "14px";
  section.style.border = "1px solid rgba(0,0,0,.075)";
  section.style.borderRadius = "22px";
  section.style.background = "rgba(255,255,255,.72)";
  section.style.boxShadow = "0 14px 40px rgba(24,24,22,.05)";
  section.style.backdropFilter = "blur(18px)";

  const top = venues.slice(0, 4);
  section.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
      <div>
        <div style="display:flex;align-items:center;gap:7px;font-size:9px;font-weight:800;letter-spacing:.17em;text-transform:uppercase;color:rgba(0,0,0,.38)">
          <span style="position:relative;display:inline-flex;width:8px;height:8px">
            <span style="position:absolute;inset:0;border-radius:999px;background:#ff5c35;opacity:.3;animation:activityPulse 1.8s ease-out infinite"></span>
            <span style="position:relative;width:8px;height:8px;border-radius:999px;background:#ff5c35"></span>
          </span>
          Live activity
        </div>
        <p style="margin:5px 0 0;font-size:15px;font-weight:720;letter-spacing:-.025em;color:rgba(0,0,0,.82)">What’s changing right now</p>
      </div>
      <span data-feed-time style="font-size:9px;font-weight:650;color:rgba(0,0,0,.32)">${relativeTime(payload.generatedAt)}</span>
    </div>
    <div data-feed-items style="display:grid;gap:7px;margin-top:11px">
      ${top.map((venue, index) => `
        <button type="button" data-feed-venue="${venue.id}" style="display:flex;width:100%;align-items:center;gap:10px;padding:9px 10px;border:0;border-radius:14px;background:${index === 0 ? "rgba(255,92,53,.085)" : "rgba(0,0,0,.025)"};text-align:left;cursor:pointer">
          <span style="display:flex;width:29px;height:29px;flex:0 0 auto;align-items:center;justify-content:center;border-radius:999px;background:${index === 0 ? "#ff5c35" : "#171716"};font-size:11px;font-weight:800;color:white">${venue.activity?.score || 0}</span>
          <span style="min-width:0;flex:1">
            <strong style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;line-height:1.3;color:rgba(0,0,0,.76)">${activityMessage(venue)}</strong>
            <span style="display:block;margin-top:2px;font-size:9px;color:rgba(0,0,0,.38)">${venue.city || "757"} · ${venue.activity?.trendLabel || "Steady"}</span>
          </span>
          <span style="font-size:13px;color:rgba(0,0,0,.28)">›</span>
        </button>
      `).join("")}
    </div>
  `;

  section.querySelectorAll<HTMLButtonElement>("[data-feed-venue]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.feedVenue;
      const venueCard = document.querySelector<HTMLElement>(`[aria-label*="${CSS.escape(venues.find(v => v.id === id)?.name || "")}"]`);
      venueCard?.click();
    });
  });

  anchor.insertAdjacentElement("afterend", section);
}

function buildMapPulse(payload: Payload) {
  const mapSection = document.querySelector<HTMLElement>('section[aria-label="757 venue map"]');
  if (!mapSection || mapSection.querySelector("[data-map-pulse]")) return;

  const venues = (payload.venues || []).filter((venue) => venue.activity);
  if (!venues.length) return;
  const average = Math.round(venues.reduce((sum, venue) => sum + (venue.activity?.score || 0), 0) / venues.length);
  const rising = venues.filter((venue) => venue.activity?.trendLabel === "Getting Busier").length;

  const overlay = document.createElement("div");
  overlay.dataset.mapPulse = "true";
  overlay.style.pointerEvents = "none";
  overlay.style.position = "absolute";
  overlay.style.inset = "0";
  overlay.style.zIndex = "2";
  overlay.style.background = "radial-gradient(circle at 70% 30%, rgba(255,92,53,.16), transparent 30%), radial-gradient(circle at 42% 68%, rgba(255,154,88,.12), transparent 26%)";
  overlay.style.mixBlendMode = "screen";
  overlay.style.animation = "mapBreathe 4s ease-in-out infinite";

  const badge = document.createElement("div");
  badge.dataset.mapPulse = "true";
  badge.style.position = "absolute";
  badge.style.left = "20px";
  badge.style.bottom = "24px";
  badge.style.zIndex = "12";
  badge.style.padding = "12px 14px";
  badge.style.border = "1px solid rgba(255,255,255,.12)";
  badge.style.borderRadius = "18px";
  badge.style.background = "rgba(10,10,10,.72)";
  badge.style.color = "white";
  badge.style.backdropFilter = "blur(18px)";
  badge.style.boxShadow = "0 18px 50px rgba(0,0,0,.28)";
  badge.innerHTML = `<div style="font-size:9px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:rgba(255,255,255,.48)">757 pulse</div><div style="display:flex;align-items:baseline;gap:8px;margin-top:4px"><strong style="font-size:24px;letter-spacing:-.05em">${average}</strong><span style="font-size:11px;color:rgba(255,255,255,.66)">${rising} places getting busier</span></div>`;

  mapSection.appendChild(overlay);
  mapSection.appendChild(badge);
}

export default function LiveExperienceEnhancer() {
  useEffect(() => {
    const style = document.createElement("style");
    style.textContent = `@keyframes activityPulse{0%{transform:scale(.8);opacity:.5}100%{transform:scale(2.5);opacity:0}}@keyframes mapBreathe{0%,100%{opacity:.55}50%{opacity:1}}`;
    document.head.appendChild(style);

    let latest: Payload | null = null;
    let timer = 0;
    const render = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (!latest) return;
        buildFeed(latest);
        buildMapPulse(latest);
      }, 80);
    };
    const handle = (event: Event) => {
      latest = (event as CustomEvent<Payload>).detail;
      document.querySelectorAll("[data-live-feed],[data-map-pulse]").forEach((node) => node.remove());
      render();
    };
    window.addEventListener("activity757:discovery", handle);
    const observer = new MutationObserver(render);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      window.removeEventListener("activity757:discovery", handle);
      observer.disconnect();
      window.clearTimeout(timer);
      style.remove();
    };
  }, []);
  return null;
}
