"use client";

import { useEffect, useRef } from "react";
import "./buzz-score-transparency.css";

type Venue = {
  id: string;
  name: string;
  activity?: {
    scoreMode?: "live" | "forecast";
    confidence?: "low" | "medium" | "high";
    updatedAt?: string | null;
    evidenceAgeMinutes?: number | null;
    explanation?: string | null;
    scoreVersion?: string | null;
  };
};

type Payload = { venues?: Venue[]; picks?: Venue[] };

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function ageLabel(venue: Venue) {
  const supplied = venue.activity?.evidenceAgeMinutes;
  if (supplied != null && Number.isFinite(supplied)) return supplied <= 1 ? "now" : `${Math.round(supplied)}m`;
  const updatedAt = venue.activity?.updatedAt ? new Date(venue.activity.updatedAt).getTime() : NaN;
  if (!Number.isFinite(updatedAt)) return "";
  const minutes = Math.max(0, Math.round((Date.now() - updatedAt) / 60_000));
  return minutes <= 1 ? "now" : minutes < 60 ? `${minutes}m` : `${Math.round(minutes / 60)}h`;
}

function badgeText(venue: Venue) {
  const mode = venue.activity?.scoreMode || "forecast";
  const confidence = venue.activity?.confidence || "low";
  const age = mode === "live" ? ageLabel(venue) : "";
  return [mode.toUpperCase(), confidence.toUpperCase(), age].filter(Boolean).join(" · ");
}

function upsertBadge(container: Element, venue: Venue) {
  let badge = container.querySelector<HTMLElement>(":scope > .buzz-proof-badge");
  if (!badge) {
    badge = document.createElement("span");
    badge.className = "buzz-proof-badge";
    container.appendChild(badge);
  }
  const mode = venue.activity?.scoreMode || "forecast";
  const confidence = venue.activity?.confidence || "low";
  const text = badgeText(venue);
  if (badge.textContent !== text) badge.textContent = text;
  badge.dataset.mode = mode;
  badge.dataset.confidence = confidence;
  badge.title = venue.activity?.explanation || (mode === "live" ? "Uses timely live evidence" : "Expected activity; not proof of a current crowd");
}

export default function BuzzScoreTransparency() {
  const venuesRef = useRef(new Map<string, Venue>());

  useEffect(() => {
    let frame = 0;
    let observer: MutationObserver | null = null;

    const setPayload = (payload: Payload | null) => {
      if (!payload) return;
      const venues = payload.venues || payload.picks || [];
      venuesRef.current = new Map(venues.map(venue => [normalize(venue.name), venue]));
      schedule();
    };

    const apply = () => {
      frame = 0;
      const venues = venuesRef.current;
      const bind = (selector: string, nameSelector: string, containerSelector: string) => {
        document.querySelectorAll<HTMLElement>(selector).forEach(root => {
          const name = root.querySelector<HTMLElement>(nameSelector)?.textContent?.trim() || "";
          const venue = venues.get(normalize(name));
          const container = root.querySelector(containerSelector);
          if (venue && container) upsertBadge(container, venue);
        });
      };

      bind(".buzz-feed-row", ".buzz-feed-copy strong", ".buzz-feed-copy");
      bind(".buzz-map-preview", ".buzz-map-preview strong", ".buzz-map-preview>div:nth-child(2)");
      bind(".buzz-desktop-card-grid article", ".buzz-card-copy h3", ".buzz-card-copy");
      bind(".buzz-detail-sheet", ".utility-head h2", ".utility-head>div");
      bind(".buzz-desktop-detail", "h2", ".buzz-desktop-detail");

      const mobileSummary = document.querySelector<HTMLElement>(".buzz-mobile-summary");
      if (mobileSummary && !mobileSummary.parentElement?.querySelector(":scope > .buzz-score-legend")) {
        const legend = document.createElement("div");
        legend.className = "buzz-score-legend";
        legend.innerHTML = "<i></i><span><b>Live</b> uses current evidence · Forecast is expected activity</span>";
        mobileSummary.insertAdjacentElement("afterend", legend);
      }
      const desktopHeading = document.querySelector<HTMLElement>(".buzz-section-heading>div");
      if (desktopHeading && !desktopHeading.querySelector(":scope > .buzz-score-legend")) {
        const legend = document.createElement("div");
        legend.className = "buzz-score-legend";
        legend.innerHTML = "<i></i><span><b>Live</b> uses current evidence · Forecast is expected activity</span>";
        desktopHeading.appendChild(legend);
      }
    };

    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(apply);
    };

    const receive = (event: Event) => setPayload((event as CustomEvent<Payload>).detail);
    window.addEventListener("activity757:discovery", receive);
    void fetch("/api/nearby?limit=400", { cache: "no-store" })
      .then(response => response.ok ? response.json() : null)
      .then(setPayload)
      .catch(() => undefined);

    observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    schedule();

    return () => {
      window.removeEventListener("activity757:discovery", receive);
      observer?.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  return null;
}
