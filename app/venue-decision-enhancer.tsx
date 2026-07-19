"use client";

import { useEffect } from "react";

type ActivityVenue = {
  id: string;
  name: string;
  city?: string | null;
  type?: string | null;
  openNow?: boolean | null;
  parking?: string | null;
  cover?: string | null;
  rating?: number | null;
  event?: { name?: string | null; timeLabel?: string | null } | null;
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

function crowdEstimate(score: number) {
  if (score >= 85) return "Large crowd expected";
  if (score >= 70) return "Busy crowd";
  if (score >= 52) return "Crowd building";
  if (score >= 30) return "Moderate crowd";
  return "Light crowd";
}

function waitEstimate(score: number, hasEvent: boolean) {
  const eventBoost = hasEvent ? 5 : 0;
  if (score >= 85) return `${20 + eventBoost}–35 min`;
  if (score >= 70) return `${12 + eventBoost}–25 min`;
  if (score >= 52) return `${6 + eventBoost}–15 min`;
  if (score >= 30) return "Usually under 10 min";
  return "Little or no wait expected";
}

function recommendation(venue: ActivityVenue) {
  const score = venue.activity?.score ?? 0;
  if (venue.openNow === false) return "Check the venue schedule before leaving";
  if (score >= 82) return "Worth going now if you want high energy";
  if (score >= 68 && venue.activity?.trendLabel === "Getting Busier") return "Go soon before activity peaks";
  if (score >= 52) return "A good time to head out";
  if (venue.event) return "The scheduled event may increase activity soon";
  return "Good for a quieter visit right now";
}

function metric(label: string, value: string, detail?: string) {
  const item = document.createElement("div");
  item.style.padding = ".8rem";
  item.style.borderRadius = "1rem";
  item.style.background = "rgba(0,0,0,.035)";
  item.innerHTML = `<span style="display:block;font-size:9px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:rgba(0,0,0,.38)">${label}</span><strong style="display:block;margin-top:.35rem;font-size:13px;line-height:1.25;color:rgba(0,0,0,.78)">${value}</strong>${detail ? `<span style="display:block;margin-top:.2rem;font-size:10px;line-height:1.35;color:rgba(0,0,0,.4)">${detail}</span>` : ""}`;
  return item;
}

function makeDecisionPanel(venue: ActivityVenue) {
  const score = venue.activity?.score ?? 0;
  const section = document.createElement("section");
  section.dataset.venueDecision = "true";
  section.style.marginTop = "1rem";
  section.style.padding = "1rem";
  section.style.border = "1px solid rgba(0,0,0,.08)";
  section.style.borderRadius = "1.4rem";
  section.style.background = "rgba(255,255,255,.8)";

  const header = document.createElement("div");
  header.style.display = "flex";
  header.style.alignItems = "flex-start";
  header.style.justifyContent = "space-between";
  header.style.gap = "1rem";
  header.innerHTML = `<div><p style="margin:0;font-size:10px;font-weight:800;letter-spacing:.15em;text-transform:uppercase;color:rgba(0,0,0,.4)">Quick decision</p><p style="margin:.4rem 0 0;font-size:16px;font-weight:750;line-height:1.25;color:rgba(0,0,0,.84)">${recommendation(venue)}</p></div><span style="display:inline-flex;align-items:center;justify-content:center;min-width:50px;height:50px;border-radius:999px;background:#171716;color:white;font-size:17px;font-weight:800">${score}</span>`;

  const grid = document.createElement("div");
  grid.style.display = "grid";
  grid.style.gridTemplateColumns = "repeat(2,minmax(0,1fr))";
  grid.style.gap = ".55rem";
  grid.style.marginTop = "1rem";
  grid.appendChild(metric("Current activity", venue.activity?.label || "Unknown", venue.activity?.trendLabel));
  grid.appendChild(metric("Estimated crowd", crowdEstimate(score)));
  grid.appendChild(metric("Estimated wait", waitEstimate(score, Boolean(venue.event)), "Estimate, not venue-reported"));
  grid.appendChild(metric("Parking", venue.parking && venue.parking !== "Unknown" ? venue.parking : "Check before leaving"));

  if (venue.cover && venue.cover !== "Unknown") {
    grid.appendChild(metric("Cover", venue.cover));
  }
  if (venue.event?.name) {
    grid.appendChild(metric("Scheduled", venue.event.name, venue.event.timeLabel || undefined));
  }

  const note = document.createElement("p");
  note.style.margin = ".85rem 0 0";
  note.style.fontSize = "10px";
  note.style.lineHeight = "1.45";
  note.style.color = "rgba(0,0,0,.38)";
  note.textContent = `Decision guidance uses current activity signals and available venue information · ${venue.activity?.confidence || "limited"} confidence`;

  section.appendChild(header);
  section.appendChild(grid);
  section.appendChild(note);
  return section;
}

function decorateDetail(venues: ActivityVenue[]) {
  const heading = Array.from(document.querySelectorAll<HTMLHeadingElement>("h2")).find((node) =>
    venues.some((venue) => venue.name === node.textContent?.trim())
  );
  if (!heading) return;

  const venue = venues.find((item) => item.name === heading.textContent?.trim());
  if (!venue?.activity) return;

  const content = heading.parentElement;
  if (!content || content.querySelector("[data-venue-decision]")) return;

  const timeline = content.querySelector("[data-activity-timeline]");
  const panel = makeDecisionPanel(venue);
  if (timeline) timeline.insertAdjacentElement("afterend", panel);
  else heading.nextElementSibling?.insertAdjacentElement("afterend", panel);
}

export default function VenueDecisionEnhancer() {
  useEffect(() => {
    let latest: ActivityVenue[] = [];
    let timer = 0;

    const decorate = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => decorateDetail(latest), 70);
    };

    const handleDiscovery = (event: Event) => {
      const payload = (event as CustomEvent<DiscoveryPayload>).detail;
      latest = payload?.picks || payload?.venues || [];
      decorate();
    };

    window.addEventListener("activity757:discovery", handleDiscovery);
    const observer = new MutationObserver(decorate);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      window.removeEventListener("activity757:discovery", handleDiscovery);
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, []);

  return null;
}
