"use client";

import { useEffect } from "react";

type ActivityVenue = {
  id: string;
  name: string;
  city?: string | null;
  activity?: { score: number; label: string; trendLabel: string };
};

type DiscoveryPayload = { venues?: ActivityVenue[]; picks?: ActivityVenue[] };

const STORAGE_KEY = "things-to-do-757-alerts";

function loadAlerts(): Record<string, { name: string; city?: string | null; threshold: number }> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") as Record<
      string,
      { name: string; city?: string | null; threshold: number }
    >;
  } catch {
    return {};
  }
}

function saveAlerts(alerts: Record<string, { name: string; city?: string | null; threshold: number }>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(alerts));
  window.dispatchEvent(new CustomEvent("activity757:alerts-changed", { detail: alerts }));
}

function createAlertSheet(venue: ActivityVenue) {
  document.querySelector("[data-alert-sheet]")?.remove();
  const alerts = loadAlerts();
  const existing = alerts[venue.id];
  const overlay = document.createElement("div");
  overlay.dataset.alertSheet = "true";
  overlay.style.cssText = "position:fixed;inset:0;z-index:9999;background:rgba(16,16,15,.38);backdrop-filter:blur(8px);display:flex;align-items:flex-end;justify-content:center;padding:12px";

  const sheet = document.createElement("section");
  sheet.style.cssText = "width:min(100%,520px);border-radius:28px;background:#f7f5ef;padding:20px;border:1px solid rgba(0,0,0,.08);box-shadow:0 24px 70px rgba(0,0,0,.22)";
  sheet.innerHTML = `
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px">
      <div>
        <p style="margin:0;font-size:10px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#d44b2b">Smart alert</p>
        <h3 style="margin:8px 0 0;font-size:24px;line-height:1.05;letter-spacing:-.04em;color:#171716">Tell me when ${venue.name} heats up</h3>
        <p style="margin:9px 0 0;font-size:13px;line-height:1.5;color:rgba(0,0,0,.54)">We’ll only alert you when activity meaningfully changes—not every time the score moves.</p>
      </div>
      <button data-close-alert type="button" aria-label="Close" style="width:38px;height:38px;border-radius:999px;border:0;background:rgba(0,0,0,.06);font-size:20px;cursor:pointer">×</button>
    </div>
    <div style="margin-top:18px;display:grid;gap:10px">
      <label style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px;border-radius:18px;background:white;border:1px solid rgba(0,0,0,.07)">
        <span><strong style="display:block;font-size:14px">Getting busy</strong><span style="display:block;margin-top:3px;font-size:11px;color:rgba(0,0,0,.44)">Alert around Activity Score 65</span></span>
        <input type="radio" name="threshold" value="65" ${!existing || existing.threshold === 65 ? "checked" : ""} />
      </label>
      <label style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px;border-radius:18px;background:white;border:1px solid rgba(0,0,0,.07)">
        <span><strong style="display:block;font-size:14px">Very busy</strong><span style="display:block;margin-top:3px;font-size:11px;color:rgba(0,0,0,.44)">Alert around Activity Score 80</span></span>
        <input type="radio" name="threshold" value="80" ${existing?.threshold === 80 ? "checked" : ""} />
      </label>
    </div>
    <button data-save-alert type="button" style="margin-top:14px;width:100%;height:48px;border:0;border-radius:999px;background:#171716;color:white;font-size:14px;font-weight:800;cursor:pointer">${existing ? "Update alert" : "Turn on alert"}</button>
    ${existing ? '<button data-remove-alert type="button" style="margin-top:8px;width:100%;height:42px;border:0;background:transparent;color:#b23c25;font-size:12px;font-weight:750;cursor:pointer">Remove alert</button>' : ""}
  `;

  overlay.appendChild(sheet);
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });
  sheet.querySelector("[data-close-alert]")?.addEventListener("click", close);
  sheet.querySelector("[data-save-alert]")?.addEventListener("click", () => {
    const threshold = Number((sheet.querySelector('input[name="threshold"]:checked') as HTMLInputElement)?.value || 65);
    alerts[venue.id] = { name: venue.name, city: venue.city, threshold };
    saveAlerts(alerts);
    close();
  });
  sheet.querySelector("[data-remove-alert]")?.addEventListener("click", () => {
    delete alerts[venue.id];
    saveAlerts(alerts);
    close();
  });
}

function decorateVenueAlert(venues: ActivityVenue[]) {
  const heading = Array.from(document.querySelectorAll<HTMLHeadingElement>("h2")).find((node) =>
    venues.some((venue) => venue.name === node.textContent?.trim())
  );
  if (!heading) return;
  const venue = venues.find((item) => item.name === heading.textContent?.trim());
  const content = heading.parentElement;
  if (!venue || !content || content.querySelector("[data-venue-alert-button]")) return;

  const button = document.createElement("button");
  button.type = "button";
  button.dataset.venueAlertButton = "true";
  button.style.cssText = "margin-top:14px;width:100%;height:48px;border-radius:999px;border:1px solid rgba(0,0,0,.1);background:rgba(255,255,255,.78);font-size:13px;font-weight:800;color:#171716;cursor:pointer";
  const alerts = loadAlerts();
  button.textContent = alerts[venue.id] ? "Alert is on · Manage" : "Notify me when this place heats up";
  button.addEventListener("click", () => createAlertSheet(venue));
  content.appendChild(button);
}

export default function SmartAlertsEnhancer() {
  useEffect(() => {
    let latest: ActivityVenue[] = [];
    let timer = 0;
    const decorate = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => decorateVenueAlert(latest), 70);
    };
    const handleDiscovery = (event: Event) => {
      const payload = (event as CustomEvent<DiscoveryPayload>).detail;
      latest = payload?.picks || payload?.venues || [];
      decorate();
    };
    const handleChanged = () => {
      document.querySelectorAll("[data-venue-alert-button]").forEach((node) => node.remove());
      decorate();
    };
    window.addEventListener("activity757:discovery", handleDiscovery);
    window.addEventListener("activity757:alerts-changed", handleChanged);
    const observer = new MutationObserver(decorate);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      window.removeEventListener("activity757:discovery", handleDiscovery);
      window.removeEventListener("activity757:alerts-changed", handleChanged);
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, []);
  return null;
}
