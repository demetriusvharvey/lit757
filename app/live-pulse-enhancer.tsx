"use client";

import { useEffect } from "react";

type ActivityVenue = {
  id: string;
  name: string;
  city?: string;
  openNow?: boolean | null;
  activity?: {
    score: number;
    label: string;
    trendLabel: string;
    confidence: "high" | "medium" | "limited";
  };
};

type DiscoveryPayload = {
  venues?: ActivityVenue[];
  picks?: ActivityVenue[];
};

type CityPulse = {
  city: string;
  score: number;
  activeCount: number;
  risingCount: number;
};

function pulseLabel(score: number) {
  if (score >= 75) return "Very active";
  if (score >= 58) return "Active";
  if (score >= 40) return "Picking up";
  return "Calm";
}

function cityPulse(venues: ActivityVenue[]) {
  const grouped = new Map<string, ActivityVenue[]>();

  venues.forEach((venue) => {
    if (!venue.city || !venue.activity || venue.openNow === false) return;
    const current = grouped.get(venue.city) || [];
    current.push(venue);
    grouped.set(venue.city, current);
  });

  return Array.from(grouped.entries())
    .map(([city, items]): CityPulse => {
      const ranked = [...items].sort((a, b) => (b.activity?.score || 0) - (a.activity?.score || 0));
      const strongest = ranked.slice(0, Math.min(5, ranked.length));
      const score = Math.round(
        strongest.reduce((total, venue) => total + (venue.activity?.score || 0), 0) /
          Math.max(1, strongest.length)
      );
      return {
        city,
        score,
        activeCount: items.filter((venue) => (venue.activity?.score || 0) >= 52).length,
        risingCount: items.filter((venue) => venue.activity?.trendLabel === "Getting Busier").length,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);
}

function decorateBrand() {
  const brandSubtitle = Array.from(document.querySelectorAll<HTMLParagraphElement>("header p")).find(
    (node) => node.textContent?.trim() === "Any time · All 757"
  );
  if (brandSubtitle && !brandSubtitle.dataset.brandPromise) {
    brandSubtitle.dataset.brandPromise = "true";
    brandSubtitle.textContent = "WHAT'S HAPPENING · RIGHT NOW";
  }

  const mainHeading = document.querySelector<HTMLHeadingElement>("main h1");
  if (!mainHeading || mainHeading.parentElement?.querySelector("[data-brand-tagline]")) return;

  const tagline = document.createElement("p");
  tagline.dataset.brandTagline = "true";
  tagline.textContent = "The fastest way to know what’s happening around you in real time.";
  tagline.style.margin = ".65rem 0 0";
  tagline.style.maxWidth = "390px";
  tagline.style.fontSize = "13px";
  tagline.style.lineHeight = "1.45";
  tagline.style.fontWeight = "650";
  tagline.style.color = "rgba(0,0,0,.68)";
  mainHeading.insertAdjacentElement("afterend", tagline);
}

function decoratePulse(venues: ActivityVenue[]) {
  const tabs = document.querySelector<HTMLElement>('[role="tablist"][aria-label="Discovery categories"]');
  if (!tabs) return;

  const existing = tabs.parentElement?.querySelector<HTMLElement>("[data-live-pulse]");
  const pulses = cityPulse(venues);
  if (!pulses.length) return;

  const section = existing || document.createElement("section");
  section.dataset.livePulse = "true";
  section.style.marginTop = ".8rem";
  section.style.border = "1px solid rgba(0,0,0,.08)";
  section.style.borderRadius = "1.25rem";
  section.style.background = "rgba(255,255,255,.7)";
  section.style.padding = ".8rem";

  section.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:.75rem">
      <div style="display:flex;align-items:center;gap:.45rem">
        <span style="position:relative;display:inline-flex;width:8px;height:8px;border-radius:999px;background:#ff5c35"></span>
        <span style="font-size:10px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:rgba(0,0,0,.58)">Live Pulse</span>
      </div>
      <span style="font-size:9px;font-weight:650;color:rgba(0,0,0,.32)">757 activity by city</span>
    </div>
    <div data-pulse-grid style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.45rem;margin-top:.65rem"></div>
  `;

  const grid = section.querySelector<HTMLElement>("[data-pulse-grid]");
  pulses.forEach((pulse, index) => {
    const item = document.createElement("div");
    item.style.borderRadius = ".9rem";
    item.style.padding = ".65rem";
    item.style.background = index === 0 ? "#171716" : "rgba(0,0,0,.045)";
    item.style.color = index === 0 ? "white" : "#171716";
    item.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:.5rem">
        <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;font-weight:750">${pulse.city}</span>
        <span style="font-size:12px;font-weight:850">${pulse.score}</span>
      </div>
      <div style="margin-top:.3rem;font-size:9px;line-height:1.35;opacity:.56">
        ${pulseLabel(pulse.score)} · ${pulse.risingCount} rising · ${pulse.activeCount} active
      </div>
    `;
    grid?.appendChild(item);
  });

  if (!existing) tabs.insertAdjacentElement("afterend", section);
}

export default function LivePulseEnhancer() {
  useEffect(() => {
    let latest: ActivityVenue[] = [];
    let timer = 0;

    const decorate = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        decorateBrand();
        decoratePulse(latest);
      }, 50);
    };

    const handleDiscovery = (event: Event) => {
      const payload = (event as CustomEvent<DiscoveryPayload>).detail;
      latest = payload?.venues || payload?.picks || [];
      decorate();
    };

    window.addEventListener("activity757:discovery", handleDiscovery);
    const observer = new MutationObserver(decorate);
    observer.observe(document.body, { childList: true, subtree: true });
    decorate();

    return () => {
      window.removeEventListener("activity757:discovery", handleDiscovery);
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, []);

  return null;
}
