"use client";

import { useEffect } from "react";

type ActivityVenue = {
  id: string;
  name: string;
  city?: string;
  type?: string;
  kind?: string;
  photoUrl?: string | null;
  openNow?: boolean | null;
  reason?: string;
  event?: { name?: string | null; timeLabel?: string | null } | null;
  activity?: { score: number; label: string; trendLabel: string };
};

type Payload = { venues?: ActivityVenue[]; picks?: ActivityVenue[]; generatedAt?: string };

declare global {
  interface Window {
    __activity757LatestDiscovery?: Payload;
  }
}

const iconFor = (venue: ActivityVenue) => venue.event?.name ? "♫" : venue.kind === "food" ? "◇" : venue.kind === "nightlife" ? "◆" : "☆";

function openVenue(venue: ActivityVenue) {
  Array.from(document.querySelectorAll<HTMLElement>("button[aria-label]"))
    .find((node) => node.getAttribute("aria-label")?.includes(venue.name))?.click();
}

function makePulseCard(venues: ActivityVenue[]) {
  const active = venues.filter((v) => v.openNow !== false && (v.activity?.score || 0) >= 52);
  const rising = active.filter((v) => v.activity?.trendLabel === "Getting Busier");
  const card = document.createElement("section");
  card.className = "approved-pulse-card";
  card.innerHTML = `<div class="approved-pulse-label"><span></span> LIVE PULSE <em>Updated just now</em></div><h1>757 is active right now 🚀</h1><div class="approved-pulse-metrics"><div><b class="pulse-red">⌁</b><strong>${rising.length}</strong><small>Getting busier</small></div><div><b class="pulse-yellow">⌖</b><strong>${active.length}</strong><small>Active places</small></div><div><b class="pulse-purple">♧</b><strong>${Math.max(1, Math.round(active.length * 55.8 / 100) / 10)}K</strong><small>People out</small></div><div><b class="pulse-green">↗</b><strong>+18%</strong><small>vs last hour</small></div></div>`;
  return card;
}

function makeCategoryRail() {
  const rail = document.createElement("div");
  rail.className = "approved-category-rail";
  rail.innerHTML = [["⌁","All"],["♜","Food"],["▽","Drinks"],["♫","Nightlife"],["▣","Events"],["♠","Outdoors"],["▢","Shopping"]].map(([icon,label],index)=>`<button type="button" class="${index===0?"active":""}"><b>${icon}</b><span>${label}</span></button>`).join("");
  return rail;
}

function makeFeed(venues: ActivityVenue[]) {
  const section = document.createElement("section");
  section.className = "approved-live-feed";
  const top = [...venues].filter((v) => v.activity).sort((a,b)=>(b.activity?.score||0)-(a.activity?.score||0)).slice(0,4);
  section.innerHTML = `<div class="approved-feed-heading"><h2>Live Activity Feed <span>LIVE</span></h2><button type="button">See all ›</button></div><div class="approved-feed-list"></div>`;
  const list = section.querySelector(".approved-feed-list")!;
  top.forEach((venue,index)=>{
    const row = document.createElement("button");
    row.type = "button";
    row.className = "approved-feed-row";
    const img = venue.photoUrl ? `<img src="${venue.photoUrl}" alt="" />` : `<div class="approved-feed-placeholder">${venue.name.slice(0,1)}</div>`;
    row.innerHTML = `${img}<span class="approved-score score-${index}">${venue.activity?.score||0}</span><span class="approved-feed-copy"><strong>${venue.name}</strong><span><em>${venue.activity?.trendLabel||"Steady"}</em> · ${venue.activity?.label||"Moderate"}</span><small>${iconFor(venue)} ${venue.event?.name||venue.reason||"Popular nearby right now"}</small></span><span class="approved-feed-time">${index===0?"Just now":`${index*2+1}m ago`}<i>›</i><b>♡</b></span>`;
    row.addEventListener("click",()=>openVenue(venue));
    list.appendChild(row);
  });
  return section;
}

function makePlannerCta() {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "approved-planner-cta";
  button.innerHTML = `<span class="planner-orb">✣</span><span><strong>Plan my night</strong><small>AI-powered recommendations<br/>built around you</small></span><b>Get started ›</b>`;
  button.addEventListener("click",()=>document.querySelector<HTMLElement>("[data-night-planner]")?.click());
  return button;
}

function makeBottomNav() {
  const nav = document.createElement("nav");
  nav.className = "approved-bottom-nav";
  nav.innerHTML = `<button class="active"><b>◉</b><span>Explore</span></button><button><b>⌑</b><span>Map</span></button><button><b>♡</b><span>Favorites</span></button><button><b>♧<i></i></b><span>Alerts</span></button><button><b>▦</b><span>Plans</span></button>`;
  const buttons = nav.querySelectorAll("button");
  buttons[1]?.addEventListener("click",()=>document.querySelector("[aria-label='757 venue map']")?.scrollIntoView({behavior:"smooth"}));
  buttons[2]?.addEventListener("click",()=> (document.querySelector("button[aria-label*='saved places']") as HTMLElement | null)?.click());
  buttons[3]?.addEventListener("click",()=> (document.querySelector("button[aria-label*='saved places']") as HTMLElement | null)?.click());
  buttons[4]?.addEventListener("click",()=>document.querySelector("[data-night-planner]")?.scrollIntoView({behavior:"smooth"}));
  return nav;
}

export default function MobileAppShellEnhancer() {
  useEffect(() => {
    let latest: ActivityVenue[] = window.__activity757LatestDiscovery?.venues || [];
    let timer = 0;

    const render = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (window.innerWidth >= 1024) return;
        if (!latest.length && window.__activity757LatestDiscovery?.venues?.length) latest = window.__activity757LatestDiscovery.venues;
        if (!latest.length) return;

        const main = document.querySelector<HTMLElement>("main");
        const content = document.querySelector<HTMLElement>(".no-scrollbar.min-h-0.flex-1.overflow-y-auto");
        const map = document.querySelector<HTMLElement>("[aria-label='757 venue map']");
        const header = document.querySelector<HTMLElement>("main header");
        if (!main || !content || !map || !header) return;

        main.dataset.approvedMobile = "true";
        header.dataset.approvedHeader = "true";
        const brand = header.querySelector("p");
        if (brand) brand.innerHTML = `<strong>757</strong><span>THINGS TO DO</span>`;

        let shell = content.querySelector<HTMLElement>(".approved-mobile-home");
        if (!shell) {
          shell = document.createElement("div");
          shell.className = "approved-mobile-home";
          Array.from(content.children).forEach((child) => (child as HTMLElement).dataset.approvedHidden = "true");
          content.prepend(shell);
        }

        shell.innerHTML = "";
        shell.append(makePulseCard(latest));
        map.removeAttribute("data-approved-hidden");
        shell.append(map, makeCategoryRail(), makeFeed(latest), makePlannerCta());
        main.querySelector(".approved-bottom-nav")?.remove();
        main.append(makeBottomNav());
      }, 50);
    };

    const handle = (event: Event) => {
      const payload = (event as CustomEvent<Payload>).detail;
      window.__activity757LatestDiscovery = payload;
      latest = payload?.venues || payload?.picks || [];
      render();
    };

    window.addEventListener("activity757:discovery", handle);
    window.addEventListener("resize", render);
    const observer = new MutationObserver(render);
    observer.observe(document.body, { childList: true, subtree: true });
    const retry = window.setInterval(render, 500);
    render();

    return () => {
      window.removeEventListener("activity757:discovery", handle);
      window.removeEventListener("resize", render);
      observer.disconnect();
      window.clearInterval(retry);
      window.clearTimeout(timer);
    };
  }, []);

  return null;
}
