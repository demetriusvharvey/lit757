"use client";

import { useEffect } from "react";

type ActivityVenue = {
  id: string;
  name: string;
  city?: string;
  openNow?: boolean | null;
  event?: { timeLabel?: string | null } | null;
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

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function labelFor(score: number) {
  if (score >= 85) return "Very Busy";
  if (score >= 70) return "Busy";
  if (score >= 52) return "Getting Busier";
  if (score >= 30) return "Moderate";
  return "Quiet";
}

function projection(venue: ActivityVenue) {
  const score = venue.activity?.score ?? 0;
  const trend = venue.activity?.trendLabel || "Steady";
  const direction = trend === "Getting Busier" ? 1 : trend === "Slowing Down" ? -1 : 0;
  const now = clamp(score);
  const thirty = clamp(now + direction * 9 + (venue.event ? 4 : 0));
  const sixty = clamp(thirty + direction * 6 - (now > 88 ? 5 : 0));
  const peak = Math.max(now, thirty, sixty);
  const best = now >= 75 ? "Go now" : thirty >= 70 ? "Best in about 30 minutes" : sixty >= 65 ? "Best in about an hour" : "Good time to visit now";
  return {
    best,
    peak,
    rows: [
      { time: "Now", score: now, label: labelFor(now) },
      { time: "+30 min", score: thirty, label: labelFor(thirty) },
      { time: "+60 min", score: sixty, label: labelFor(sixty) },
    ],
  };
}

function makeTimeline(venue: ActivityVenue) {
  const forecast = projection(venue);
  const wrapper = document.createElement("section");
  wrapper.dataset.activityTimeline = "true";
  wrapper.style.marginTop = "1.25rem";
  wrapper.style.padding = "1rem";
  wrapper.style.border = "1px solid rgba(0,0,0,.08)";
  wrapper.style.borderRadius = "1.4rem";
  wrapper.style.background = "rgba(255,255,255,.78)";

  const header = document.createElement("div");
  header.style.display = "flex";
  header.style.alignItems = "flex-start";
  header.style.justifyContent = "space-between";
  header.style.gap = "1rem";
  header.innerHTML = `<div><p style="margin:0;font-size:10px;font-weight:800;letter-spacing:.15em;text-transform:uppercase;color:rgba(0,0,0,.4)">Activity forecast</p><p style="margin:.35rem 0 0;font-size:16px;font-weight:700;color:rgba(0,0,0,.82)">${forecast.best}</p></div><span style="border-radius:999px;background:#171716;color:white;padding:.38rem .6rem;font-size:10px;font-weight:800">Peak ${forecast.peak}</span>`;
  wrapper.appendChild(header);

  const list = document.createElement("div");
  list.style.display = "grid";
  list.style.gap = ".8rem";
  list.style.marginTop = "1rem";

  forecast.rows.forEach((row) => {
    const item = document.createElement("div");
    item.style.display = "grid";
    item.style.gridTemplateColumns = "62px 1fr auto";
    item.style.alignItems = "center";
    item.style.gap = ".65rem";
    item.innerHTML = `<span style="font-size:11px;font-weight:700;color:rgba(0,0,0,.48)">${row.time}</span><span style="height:8px;border-radius:999px;background:rgba(0,0,0,.08);overflow:hidden"><span style="display:block;height:100%;width:${row.score}%;border-radius:999px;background:#ff5c35"></span></span><span style="min-width:78px;text-align:right;font-size:11px;font-weight:700;color:rgba(0,0,0,.68)">${row.label}</span>`;
    list.appendChild(item);
  });

  const note = document.createElement("p");
  note.style.margin = ".9rem 0 0";
  note.style.fontSize = "10px";
  note.style.lineHeight = "1.45";
  note.style.color = "rgba(0,0,0,.38)";
  note.textContent = `Estimate based on current activity, trend, schedule and venue status · ${venue.activity?.confidence || "limited"} confidence`;

  wrapper.appendChild(list);
  wrapper.appendChild(note);
  return wrapper;
}

function decorateDetail(venues: ActivityVenue[]) {
  const heading = Array.from(document.querySelectorAll<HTMLHeadingElement>("h2")).find((node) =>
    venues.some((venue) => venue.name === node.textContent?.trim())
  );
  if (!heading) return;
  const venue = venues.find((item) => item.name === heading.textContent?.trim());
  if (!venue?.activity) return;

  const content = heading.parentElement;
  if (!content || content.querySelector("[data-activity-timeline]")) return;
  const reason = heading.nextElementSibling;
  const timeline = makeTimeline(venue);
  reason?.insertAdjacentElement("afterend", timeline);
}

function decorateTrending(venues: ActivityVenue[]) {
  const tablist = document.querySelector<HTMLElement>('[role="tablist"][aria-label="Business and event categories"]');
  if (!tablist) return;
  const host = tablist.parentElement?.parentElement;
  if (!host || host.querySelector("[data-trending-now]")) return;

  const trending = venues
    .filter((venue) => venue.activity && venue.openNow !== false)
    .sort((a, b) => (b.activity?.score || 0) - (a.activity?.score || 0))
    .slice(0, 3);
  if (!trending.length) return;

  const section = document.createElement("section");
  section.dataset.trendingNow = "true";
  section.style.marginTop = "1rem";
  section.innerHTML = `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.55rem"><p style="margin:0;font-size:10px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:rgba(0,0,0,.42)">Trending now</p><span style="font-size:10px;color:rgba(0,0,0,.32)">Largest current activity</span></div>`;

  const row = document.createElement("div");
  row.style.display = "grid";
  row.style.gridTemplateColumns = "repeat(3,minmax(0,1fr))";
  row.style.gap = ".5rem";

  trending.forEach((venue, index) => {
    const card = document.createElement("button");
    card.type = "button";
    card.style.border = "1px solid rgba(0,0,0,.08)";
    card.style.borderRadius = "1rem";
    card.style.background = index === 0 ? "#171716" : "rgba(255,255,255,.76)";
    card.style.color = index === 0 ? "white" : "#171716";
    card.style.padding = ".75rem";
    card.style.textAlign = "left";
    card.style.minWidth = "0";
    card.innerHTML = `<span style="display:block;font-size:9px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;opacity:.58">${venue.activity?.label}</span><span style="display:block;margin-top:.35rem;font-size:12px;font-weight:750;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${venue.name}</span><span style="display:block;margin-top:.25rem;font-size:10px;opacity:.52">${venue.activity?.trendLabel} · ${venue.city || "757"}</span>`;
    card.addEventListener("click", () => {
      const target = Array.from(document.querySelectorAll<HTMLButtonElement>('button[aria-label^="Open "]')).find((button) =>
        button.getAttribute("aria-label")?.startsWith(`Open ${venue.name},`)
      );
      target?.click();
    });
    row.appendChild(card);
  });

  section.appendChild(row);
  host.insertAdjacentElement("afterend", section);
}

export default function ActivityInsightsEnhancer() {
  useEffect(() => {
    let latest: ActivityVenue[] = [];
    let timer = 0;

    const decorate = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        decorateTrending(latest);
        decorateDetail(latest);
      }, 60);
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
