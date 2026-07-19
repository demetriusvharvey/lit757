"use client";

import { useEffect } from "react";

type ActivityVenue = {
  id: string;
  name: string;
  city?: string | null;
  address?: string | null;
  lat?: number;
  lng?: number;
  kind?: "food" | "nightlife" | "activity" | "events" | "other";
  type?: string | null;
  rating?: number | null;
  openNow?: boolean | null;
  reason?: string | null;
  event?: { name?: string | null; timeLabel?: string | null } | null;
  activity?: {
    score: number;
    label: string;
    trendLabel: string;
    confidence: "high" | "medium" | "limited";
  };
};

type DiscoveryPayload = { venues?: ActivityVenue[]; picks?: ActivityVenue[] };

type PlannerPreferences = {
  prompt: string;
  city: string;
  energy: "any" | "quiet" | "balanced" | "high";
  group: "solo" | "date" | "friends" | "family";
};

const escapeHtml = (value: string) =>
  value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character] || character);

function scoreVenue(venue: ActivityVenue, preferences: PlannerPreferences, index: number) {
  let score = venue.activity?.score || 0;
  const text = `${venue.name} ${venue.type || ""} ${venue.reason || ""} ${venue.event?.name || ""}`.toLowerCase();
  const prompt = preferences.prompt.toLowerCase();

  if (venue.openNow === false) score -= 80;
  if (preferences.city !== "All 757" && venue.city === preferences.city) score += 24;
  if (preferences.energy === "high") score += (venue.activity?.score || 0) * 0.25;
  if (preferences.energy === "quiet") score += 100 - (venue.activity?.score || 0);
  if (preferences.energy === "balanced" && (venue.activity?.score || 0) >= 42 && (venue.activity?.score || 0) <= 75) score += 20;

  if (/date|romantic|wife|girlfriend|boyfriend/.test(prompt) && /restaurant|wine|cocktail|dessert|rooftop|italian|seafood/.test(text)) score += 24;
  if (/food|eat|dinner|lunch|brunch/.test(prompt) && venue.kind === "food") score += 26;
  if (/drink|bar|club|nightlife|dance|music/.test(prompt) && venue.kind === "nightlife") score += 24;
  if (/event|concert|show|live music/.test(prompt) && (venue.kind === "events" || venue.event)) score += 28;
  if (/family|kids|child/.test(prompt) && venue.kind === "activity") score += 24;
  if (/cheap|budget|under \$|affordable/.test(prompt) && !/steak|fine dining|rooftop/.test(text)) score += 12;

  if (preferences.group === "date" && /restaurant|wine|cocktail|dessert|rooftop/.test(text)) score += 18;
  if (preferences.group === "family" && venue.kind === "activity") score += 20;
  if (preferences.group === "friends" && (venue.kind === "nightlife" || venue.event)) score += 14;

  return score - index * 0.08;
}

function buildPlan(venues: ActivityVenue[], preferences: PlannerPreferences) {
  const ranked = venues
    .map((venue, index) => ({ venue, score: scoreVenue(venue, preferences, index) }))
    .filter(({ venue }) => venue.openNow !== false)
    .sort((a, b) => b.score - a.score)
    .map(({ venue }) => venue);

  const selected: ActivityVenue[] = [];
  const preferredKinds: ActivityVenue["kind"][] = /food|dinner|date|eat|brunch/i.test(preferences.prompt)
    ? ["food", "activity", "nightlife", "events"]
    : ["activity", "food", "nightlife", "events"];

  preferredKinds.forEach((kind) => {
    const match = ranked.find((venue) => venue.kind === kind && !selected.some((item) => item.id === venue.id));
    if (match && selected.length < 3) selected.push(match);
  });

  ranked.forEach((venue) => {
    if (selected.length < 3 && !selected.some((item) => item.id === venue.id)) selected.push(venue);
  });

  return selected.slice(0, 3);
}

function directionsUrl(venue: ActivityVenue) {
  const destination = venue.address || (venue.lat != null && venue.lng != null ? `${venue.lat},${venue.lng}` : venue.name);
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination || venue.name)}`;
}

function createPlanner(venues: ActivityVenue[]) {
  const overlay = document.createElement("div");
  overlay.dataset.nightPlanner = "true";
  overlay.style.cssText = "position:fixed;inset:0;z-index:9999;display:flex;align-items:flex-end;justify-content:center;background:rgba(17,17,16,.56);backdrop-filter:blur(14px);padding:0;";

  const cities = ["All 757", ...Array.from(new Set(venues.map((venue) => venue.city).filter(Boolean) as string[])).sort()];
  overlay.innerHTML = `
    <section role="dialog" aria-modal="true" aria-label="Plan my night" style="width:min(680px,100%);max-height:94dvh;overflow:auto;border-radius:28px 28px 0 0;background:#f7f5ef;box-shadow:0 -28px 80px rgba(0,0,0,.28);padding:18px 18px 28px;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:16px;">
        <div>
          <p style="margin:0;font-size:10px;font-weight:800;letter-spacing:.17em;text-transform:uppercase;color:#d44b2b;">757 Concierge</p>
          <h2 style="margin:7px 0 0;font-size:30px;line-height:1;letter-spacing:-.055em;color:#171716;">Plan what happens next.</h2>
        </div>
        <button data-close-planner aria-label="Close planner" style="width:42px;height:42px;border-radius:999px;border:1px solid rgba(0,0,0,.09);background:white;font-size:22px;cursor:pointer;">×</button>
      </div>
      <p style="margin:12px 0 0;max-width:520px;font-size:13px;line-height:1.55;color:rgba(0,0,0,.52);">Tell us the vibe. We’ll use what is open, active and worth your time right now to build a simple three-stop plan.</p>

      <label style="display:block;margin-top:18px;">
        <span style="display:block;margin-bottom:7px;font-size:10px;font-weight:800;letter-spacing:.13em;text-transform:uppercase;color:rgba(0,0,0,.42);">What are you looking for?</span>
        <textarea data-plan-prompt rows="3" placeholder="Date night under $100, dinner then drinks, not too loud…" style="width:100%;resize:none;border:1px solid rgba(0,0,0,.09);border-radius:18px;background:white;padding:14px 15px;font:inherit;font-size:14px;line-height:1.45;outline:none;box-sizing:border-box;"></textarea>
      </label>

      <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:12px;">
        <label><span style="display:block;margin:0 0 6px;font-size:9px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:rgba(0,0,0,.38);">Area</span><select data-plan-city style="width:100%;height:44px;border:1px solid rgba(0,0,0,.09);border-radius:14px;background:white;padding:0 12px;font-size:12px;">${cities.map((city) => `<option>${escapeHtml(city)}</option>`).join("")}</select></label>
        <label><span style="display:block;margin:0 0 6px;font-size:9px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:rgba(0,0,0,.38);">Energy</span><select data-plan-energy style="width:100%;height:44px;border:1px solid rgba(0,0,0,.09);border-radius:14px;background:white;padding:0 12px;font-size:12px;"><option value="any">Any vibe</option><option value="quiet">Keep it quiet</option><option value="balanced">Some energy</option><option value="high">High energy</option></select></label>
        <label><span style="display:block;margin:0 0 6px;font-size:9px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:rgba(0,0,0,.38);">Going with</span><select data-plan-group style="width:100%;height:44px;border:1px solid rgba(0,0,0,.09);border-radius:14px;background:white;padding:0 12px;font-size:12px;"><option value="solo">Just me</option><option value="date">A date</option><option value="friends">Friends</option><option value="family">Family</option></select></label>
        <button data-build-plan style="align-self:end;height:44px;border:0;border-radius:14px;background:#ff5c35;color:white;font-size:12px;font-weight:750;cursor:pointer;box-shadow:0 12px 28px rgba(255,92,53,.24);">Build my plan →</button>
      </div>

      <div data-plan-results style="margin-top:16px;"></div>
    </section>`;

  const close = () => overlay.remove();
  overlay.querySelector("[data-close-planner]")?.addEventListener("click", close);
  overlay.addEventListener("click", (event) => { if (event.target === overlay) close(); });

  overlay.querySelector("[data-build-plan]")?.addEventListener("click", () => {
    const prompt = (overlay.querySelector<HTMLTextAreaElement>("[data-plan-prompt]")?.value || "something fun tonight").trim();
    const city = overlay.querySelector<HTMLSelectElement>("[data-plan-city]")?.value || "All 757";
    const energy = (overlay.querySelector<HTMLSelectElement>("[data-plan-energy]")?.value || "any") as PlannerPreferences["energy"];
    const group = (overlay.querySelector<HTMLSelectElement>("[data-plan-group]")?.value || "solo") as PlannerPreferences["group"];
    const plan = buildPlan(venues, { prompt, city, energy, group });
    const results = overlay.querySelector<HTMLElement>("[data-plan-results]");
    if (!results) return;

    if (!plan.length) {
      results.innerHTML = `<div style="border-radius:18px;background:white;padding:18px;text-align:center;font-size:13px;color:rgba(0,0,0,.5);">No strong open matches yet. Try a broader area or vibe.</div>`;
      return;
    }

    results.innerHTML = `
      <div style="display:flex;align-items:end;justify-content:space-between;gap:12px;margin-bottom:9px;"><div><p style="margin:0;font-size:10px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#d44b2b;">Your plan right now</p><p style="margin:5px 0 0;font-size:12px;color:rgba(0,0,0,.45);">Built from live activity across the 757</p></div><span style="font-size:10px;color:rgba(0,0,0,.34);">${plan.length} stops</span></div>
      <div style="display:grid;gap:8px;">${plan.map((venue, index) => `
        <article style="display:grid;grid-template-columns:42px 1fr auto;gap:11px;align-items:center;border:1px solid rgba(0,0,0,.07);border-radius:18px;background:white;padding:11px;">
          <div style="display:flex;width:42px;height:42px;align-items:center;justify-content:center;border-radius:14px;background:${index === 0 ? "#171716" : "rgba(0,0,0,.055)"};color:${index === 0 ? "white" : "#171716"};font-size:12px;font-weight:850;">${index + 1}</div>
          <div style="min-width:0;"><p style="margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:750;color:#171716;">${escapeHtml(venue.name)}</p><p style="margin:4px 0 0;font-size:10px;color:rgba(0,0,0,.45);">${escapeHtml(venue.city || "757")} · ${escapeHtml(venue.activity?.label || "Worth a look")} · ${venue.activity?.score || 0}</p></div>
          <a href="${directionsUrl(venue)}" target="_blank" rel="noreferrer" style="display:inline-flex;height:34px;align-items:center;border-radius:999px;background:#fff0e9;padding:0 11px;color:#c84427;text-decoration:none;font-size:10px;font-weight:750;">Directions</a>
        </article>`).join("")}</div>
      <p style="margin:10px 2px 0;font-size:9px;line-height:1.45;color:rgba(0,0,0,.34);">Plans use currently available venue and activity signals. Hours, prices and availability can change—confirm important details before leaving.</p>`;
  });

  return overlay;
}

function installButton(venues: ActivityVenue[]) {
  const form = document.querySelector<HTMLFormElement>("main form");
  if (!form || form.parentElement?.querySelector("[data-plan-night-button]")) return;

  const button = document.createElement("button");
  button.type = "button";
  button.dataset.planNightButton = "true";
  button.innerHTML = `<span style="font-size:14px">✦</span><span>Plan my night</span><span style="opacity:.48">→</span>`;
  button.style.cssText = "display:flex;width:100%;height:42px;align-items:center;justify-content:center;gap:8px;margin-top:8px;border:1px solid rgba(0,0,0,.08);border-radius:999px;background:#171716;color:white;font-size:11px;font-weight:750;cursor:pointer;box-shadow:0 10px 24px rgba(0,0,0,.10);";
  button.addEventListener("click", () => document.body.appendChild(createPlanner(venues)));
  form.insertAdjacentElement("afterend", button);
}

export default function NightPlannerEnhancer() {
  useEffect(() => {
    let latest: ActivityVenue[] = [];
    let timer = 0;

    const decorate = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => installButton(latest), 60);
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
      document.querySelector("[data-night-planner]")?.remove();
    };
  }, []);

  return null;
}
