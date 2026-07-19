"use client";

import { useEffect } from "react";

type ActivityVenue = {
  id: string;
  name: string;
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

function badgeTone(score: number) {
  if (score >= 85) return "#b42318";
  if (score >= 70) return "#d94f2b";
  if (score >= 52) return "#e97832";
  if (score >= 30) return "#6f6b62";
  return "#8b877f";
}

function decorateCards(venues: ActivityVenue[]) {
  const byName = new Map(venues.map((venue) => [venue.name, venue]));
  const cards = document.querySelectorAll<HTMLButtonElement>('button[aria-label^="Open "][aria-label*="pick "]');

  cards.forEach((card) => {
    const label = card.getAttribute("aria-label") || "";
    const match = label.match(/^Open (.*), pick \d+$/);
    const venue = match ? byName.get(match[1]) : undefined;
    if (!venue?.activity) return;

    let badge = card.querySelector<HTMLElement>("[data-activity-status]");
    if (!badge) {
      badge = document.createElement("span");
      badge.dataset.activityStatus = "true";
      badge.style.position = "absolute";
      badge.style.right = "0.75rem";
      badge.style.top = "0.75rem";
      badge.style.zIndex = "5";
      badge.style.borderRadius = "999px";
      badge.style.padding = "0.3rem 0.55rem";
      badge.style.fontSize = "9px";
      badge.style.fontWeight = "800";
      badge.style.letterSpacing = "0.08em";
      badge.style.textTransform = "uppercase";
      badge.style.color = "white";
      badge.style.boxShadow = "0 8px 20px rgba(0,0,0,.18)";
      card.style.position = "relative";
      card.appendChild(badge);
    }

    badge.style.background = badgeTone(venue.activity.score);
    badge.textContent = `${venue.activity.label} · ${venue.activity.trendLabel}`;
    badge.setAttribute(
      "aria-label",
      `${venue.name}: ${venue.activity.label}, ${venue.activity.trendLabel}, ${venue.activity.confidence} confidence`
    );
  });
}

export default function ActivityStatusEnhancer() {
  useEffect(() => {
    let latest: ActivityVenue[] = [];
    let timer = 0;

    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => decorateCards(latest), 40);
    };

    const handleDiscovery = (event: Event) => {
      const payload = (event as CustomEvent<DiscoveryPayload>).detail;
      latest = payload?.picks || payload?.venues || [];
      schedule();
    };

    window.addEventListener("activity757:discovery", handleDiscovery);
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      window.removeEventListener("activity757:discovery", handleDiscovery);
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, []);

  return null;
}
