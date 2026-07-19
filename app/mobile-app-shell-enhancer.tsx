"use client";

import { useEffect } from "react";

type ActivityVenue = {
  id: string;
  name: string;
  city?: string;
  openNow?: boolean | null;
  activity?: { score: number; label: string; trendLabel: string };
};

type Payload = { venues?: ActivityVenue[]; picks?: ActivityVenue[]; generatedAt?: string };

function makePulseCard(venues: ActivityVenue[]) {
  const active = venues.filter((venue) => venue.openNow !== false && (venue.activity?.score || 0) >= 52);
  const rising = active.filter((venue) => venue.activity?.trendLabel === "Getting Busier");
  const average = active.length
    ? Math.round(active.reduce((sum, venue) => sum + (venue.activity?.score || 0), 0) / active.length)
    : 0;

  const card = document.createElement("section");
  card.dataset.mobilePulseCard = "true";
  card.className = "mobile-pulse-card";
  card.innerHTML = `
    <div class="mobile-pulse-topline">
      <span class="mobile-live-dot"></span>
      <span>Live pulse</span>
      <span class="mobile-pulse-time">Updated now</span>
    </div>
    <h1>757 is active right now</h1>
    <div class="mobile-pulse-metrics">
      <div><strong>${rising.length}</strong><span>Getting busier</span></div>
      <div><strong>${active.length}</strong><span>Active places</span></div>
      <div><strong>${average}</strong><span>Activity score</span></div>
    </div>
  `;
  return card;
}

function makeBottomNav() {
  const nav = document.createElement("nav");
  nav.dataset.mobileBottomNav = "true";
  nav.className = "mobile-bottom-nav";
  nav.setAttribute("aria-label", "Primary navigation");
  nav.innerHTML = `
    <button type="button" class="is-active"><span>◉</span><small>Explore</small></button>
    <button type="button"><span>⌖</span><small>Map</small></button>
    <button type="button"><span>♡</span><small>Favorites</small></button>
    <button type="button"><span>♢</span><small>Alerts</small></button>
    <button type="button"><span>▣</span><small>Plans</small></button>
  `;
  const buttons = Array.from(nav.querySelectorAll("button"));
  buttons[1]?.addEventListener("click", () => document.querySelector('[aria-label="757 venue map"]')?.scrollIntoView({ behavior: "smooth", block: "start" }));
  buttons[2]?.addEventListener("click", () => (document.querySelector('[aria-label*="saved places"]') as HTMLElement | null)?.click());
  buttons[3]?.addEventListener("click", () => (document.querySelector('[aria-label*="saved places"]') as HTMLElement | null)?.click());
  buttons[4]?.addEventListener("click", () => document.querySelector('[data-night-planner]')?.scrollIntoView({ behavior: "smooth", block: "center" }));
  return nav;
}

export default function MobileAppShellEnhancer() {
  useEffect(() => {
    let latest: ActivityVenue[] = [];
    let timer = 0;

    const render = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (window.innerWidth >= 1024) return;
        const main = document.querySelector("main");
        const content = document.querySelector<HTMLElement>(".no-scrollbar.min-h-0.flex-1.overflow-y-auto");
        const map = document.querySelector<HTMLElement>('[aria-label="757 venue map"]');
        const header = document.querySelector<HTMLElement>("main header");
        if (!main || !content || !map || !header) return;

        main.dataset.mobileAppShell = "true";
        header.dataset.mobileHeader = "true";

        const brand = header.querySelector("p");
        if (brand) brand.textContent = "757 THINGS TO DO";

        const oldPulse = content.querySelector("[data-mobile-pulse-card]");
        oldPulse?.remove();
        if (latest.length) content.prepend(makePulseCard(latest));

        if (map.parentElement !== content) {
          const tabs = content.querySelector('[role="tablist"][aria-label="Discovery categories"]');
          const pulse = content.querySelector("[data-mobile-pulse-card]");
          if (tabs) tabs.insertAdjacentElement("beforebegin", map);
          else pulse?.insertAdjacentElement("afterend", map);
        }

        if (!main.querySelector("[data-mobile-bottom-nav]")) main.appendChild(makeBottomNav());
      }, 80);
    };

    const handle = (event: Event) => {
      const payload = (event as CustomEvent<Payload>).detail;
      latest = payload?.venues || payload?.picks || [];
      render();
    };

    window.addEventListener("activity757:discovery", handle);
    window.addEventListener("resize", render);
    const observer = new MutationObserver(render);
    observer.observe(document.body, { childList: true, subtree: true });
    render();

    return () => {
      window.removeEventListener("activity757:discovery", handle);
      window.removeEventListener("resize", render);
      observer.disconnect();
      window.clearTimeout(timer);
      document.querySelector("[data-mobile-bottom-nav]")?.remove();
      document.querySelector("[data-mobile-pulse-card]")?.remove();
    };
  }, []);

  return null;
}
