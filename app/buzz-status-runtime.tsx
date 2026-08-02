"use client";

import { useEffect } from "react";
import { activityStatusLabel, activityTruthMode } from "../src/lib/buzz/truth-labels";
import "./buzz-status-trends.css";

type TrendDirection = "rising_fast" | "rising" | "steady" | "cooling" | "cooling_fast" | "new";

type Venue = {
  id: string;
  name: string;
  reason?: string;
  openNow?: boolean | null;
  event?: { name?: string | null } | null;
  activity?: {
    score?: number;
    confidence?: string;
    scoreMode?: "live" | "forecast";
  };
};

type VenueTrend = {
  direction: TrendDirection;
  label: string;
  samples: number[];
  delta: number;
  windowMinutes: number;
};

type DiscoveryPayload = { venues?: Venue[]; picks?: Venue[] };
type TrendPayload = { success?: boolean; trends?: Record<string, VenueTrend> };
type TrendCache = Record<string, Array<{ score: number; at: number }>>;

const CACHE_KEY = "buzz-venue-trend-history-v1";
const HISTORY_WINDOW_MS = 6 * 60 * 60 * 1000;
const OBSERVATION_GAP_MS = 4 * 60 * 1000;
const REFRESH_MS = 5 * 60 * 1000;
const SVG_NS = "http://www.w3.org/2000/svg";

const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
const clampScore = (value: unknown) => Math.max(0, Math.min(100, Number(value ?? 35)));

function statusFor(score: number, mode?: string) {
  const slug = score >= 75 ? "lit" : score >= 55 ? "buzzing" : score >= 35 ? "picking-up" : "chill";
  return { label: activityStatusLabel(score, mode), slug };
}

function trendFromSamples(values: number[]): VenueTrend {
  const samples = values.filter(Number.isFinite).slice(-12);
  if (samples.length < 2) return { direction: "new", label: "New signal", samples, delta: 0, windowMinutes: 0 };
  const delta = Math.round(samples[samples.length - 1] - samples[0]);
  if (delta >= 12) return { direction: "rising_fast", label: "Rising fast", samples, delta, windowMinutes: 0 };
  if (delta >= 5) return { direction: "rising", label: "Trending up", samples, delta, windowMinutes: 0 };
  if (delta <= -12) return { direction: "cooling_fast", label: "Cooling fast", samples, delta, windowMinutes: 0 };
  if (delta <= -5) return { direction: "cooling", label: "Cooling down", samples, delta, windowMinutes: 0 };
  return { direction: "steady", label: "Holding steady", samples, delta, windowMinutes: 0 };
}

function readCache(): TrendCache {
  try {
    const parsed = JSON.parse(localStorage.getItem(CACHE_KEY) || "{}") as TrendCache;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function updateCache(venues: Venue[]) {
  const now = Date.now();
  const cache = readCache();
  for (const venue of venues) {
    const score = clampScore(venue.activity?.score);
    const history = (cache[venue.id] || []).filter(point => now - point.at <= HISTORY_WINDOW_MS);
    const last = history[history.length - 1];
    if (!last || now - last.at >= OBSERVATION_GAP_MS || last.score !== score) history.push({ score, at: now });
    cache[venue.id] = history.slice(-12);
  }
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch { /* Storage is optional. */ }
  return cache;
}

function localTrend(venue: Venue, cache: TrendCache) {
  const points = cache[venue.id] || [];
  const trend = trendFromSamples(points.map(point => point.score));
  if (points.length >= 2) trend.windowMinutes = Math.max(1, Math.round((points[points.length - 1].at - points[0].at) / 60_000));
  return trend;
}

function confidenceLabel(value?: string) {
  const normalized = String(value || "low").toLowerCase();
  return normalized === "high" ? "High confidence" : normalized === "medium" ? "Medium confidence" : "Early estimate";
}

function reasonLines(venue: Venue) {
  const eventName = venue.event?.name?.trim();
  const raw = String(venue.reason || "")
    .split("·")
    .map(part => part.trim())
    .filter(Boolean)
    .filter(part => !/^conservative forecast/i.test(part));
  const lines = eventName && !raw.some(part => part.toLowerCase().includes(eventName.toLowerCase()))
    ? [`${eventName} is influencing activity`, ...raw]
    : raw;
  if (!lines.length && venue.openNow === true) lines.push("Open now");
  if (!lines.length) lines.push("No strong activity signal yet");
  return lines.slice(0, 3);
}

function trendGlyph(direction: TrendDirection) {
  if (direction === "rising" || direction === "rising_fast") return "↗";
  if (direction === "cooling" || direction === "cooling_fast") return "↘";
  if (direction === "new") return "•";
  return "→";
}

function formatWindow(minutes: number) {
  if (!minutes) return "Activity history is building";
  if (minutes < 60) return `Last ${minutes} min`;
  const hours = Math.max(1, Math.round(minutes / 60));
  return `Last ${hours} hr${hours === 1 ? "" : "s"}`;
}

function sparkline(samples: number[], direction: TrendDirection, compact = false) {
  const values = samples.length >= 2 ? samples : [samples[0] ?? 35, samples[0] ?? 35];
  const width = compact ? 58 : 240;
  const height = compact ? 28 : 48;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(8, max - min);
  const inset = compact ? 2 : 3;
  const points = values.map((value, index) => {
    const x = inset + index * ((width - inset * 2) / Math.max(1, values.length - 1));
    const y = height - inset - ((value - min) / range) * (height - inset * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("buzz-sparkline", `trend-${direction.replaceAll("_", "-")}`);

  const guide = document.createElementNS(SVG_NS, "path");
  guide.setAttribute("d", `M ${inset} ${height / 2} H ${width - inset}`);
  guide.classList.add("buzz-sparkline-guide");
  svg.append(guide);

  const line = document.createElementNS(SVG_NS, "path");
  line.setAttribute("d", `M ${points.join(" L ")}`);
  line.classList.add("buzz-sparkline-line");
  svg.append(line);

  const [lastX, lastY] = points[points.length - 1].split(",");
  const dot = document.createElementNS(SVG_NS, "circle");
  dot.setAttribute("cx", lastX);
  dot.setAttribute("cy", lastY);
  dot.setAttribute("r", compact ? "2" : "2.6");
  svg.append(dot);
  return svg;
}

function createTextElement<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text: string) {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
}

function enhanceCrowdButtons(root: ParentNode) {
  const buttons = root.querySelectorAll<HTMLButtonElement>(".buzz-vote-card>div button");
  buttons.forEach(button => {
    if (button.dataset.signalBars === "true") return;
    const label = button.textContent?.trim().toLowerCase() || "quiet";
    const level = label.includes("packed") ? "packed" : label.includes("busy") ? "busy" : label.includes("steady") ? "steady" : "quiet";
    const oldIcon = button.querySelector("span");
    if (oldIcon) {
      oldIcon.textContent = "";
      oldIcon.className = `buzz-crowd-bars level-${level}`;
      for (let index = 0; index < 4; index += 1) oldIcon.append(document.createElement("i"));
    }
    button.dataset.signalBars = "true";
  });
}

function enhanceList(root: ParentNode, venuesByName: Map<string, Venue>, trends: Map<string, VenueTrend>) {
  root.querySelectorAll<HTMLElement>(".buzz-map-list-scroll article").forEach(article => {
    const name = article.querySelector<HTMLElement>(".buzz-list-copy>strong")?.textContent || "";
    const venue = venuesByName.get(normalize(name));
    if (!venue) return;
    const trend = trends.get(venue.id) || trendFromSamples([clampScore(venue.activity?.score)]);
    const status = statusFor(clampScore(venue.activity?.score), venue.activity?.scoreMode);
    const signature = `${status.slug}:${venue.activity?.scoreMode || "forecast"}:${trend.direction}:${trend.samples.join(",")}`;
    if (article.dataset.buzzSignal === signature) return;

    article.querySelector(".buzz-list-signal")?.remove();
    const copy = article.querySelector<HTMLElement>(".buzz-list-copy");
    const oldStatus = copy?.querySelector<HTMLElement>(".buzz-status");
    if (!copy || !oldStatus) return;
    oldStatus.remove();
    oldStatus.className = `buzz-status status-${status.slug}`;
    oldStatus.textContent = status.label;

    const reason = copy.querySelector<HTMLElement>(":scope>p");
    if (reason) reason.textContent = venue.event?.name || reasonLines(venue)[0];

    const signal = document.createElement("div");
    signal.className = "buzz-list-signal";
    signal.append(oldStatus);
    signal.append(createTextElement("span", `buzz-trend-label trend-${trend.direction.replaceAll("_", "-")}`, `${trendGlyph(trend.direction)} ${trend.label}`));
    signal.append(sparkline(trend.samples, trend.direction, true));
    copy.append(signal);
    article.dataset.buzzSignal = signature;
  });
}

function enhanceDetail(root: ParentNode, venuesByName: Map<string, Venue>, trends: Map<string, VenueTrend>) {
  const detail = root.querySelector<HTMLElement>(".buzz-venue-detail");
  if (!detail) return;
  const name = detail.querySelector<HTMLElement>(".buzz-detail-title h2")?.textContent || "";
  const venue = venuesByName.get(normalize(name));
  if (!venue) return;
  const trend = trends.get(venue.id) || trendFromSamples([clampScore(venue.activity?.score)]);
  const truthMode = activityTruthMode(venue.activity?.scoreMode);
  const status = statusFor(clampScore(venue.activity?.score), truthMode);
  const mode = truthMode === "live" ? "Live evidence" : "Current forecast";
  const signature = `${venue.id}:${status.slug}:${truthMode}:${trend.direction}:${trend.samples.join(",")}:${venue.reason || ""}`;
  if (detail.dataset.buzzSignal === signature) {
    enhanceCrowdButtons(detail);
    return;
  }

  const title = detail.querySelector<HTMLElement>(".buzz-detail-title");
  const titleLabel = title?.querySelector<HTMLElement>("small");
  if (titleLabel) {
    titleLabel.className = `buzz-live-pill${truthMode === "live" ? " live" : ""}`;
    titleLabel.textContent = mode.toUpperCase();
  }

  detail.querySelector(".buzz-signal-panel")?.remove();
  if (title) {
    const panel = document.createElement("section");
    panel.className = `buzz-signal-panel status-${status.slug}`;

    const now = document.createElement("div");
    now.className = "buzz-signal-now";
    now.append(createTextElement("small", "", truthMode === "live" ? "Live evidence" : "Current forecast"));
    now.append(createTextElement("strong", "", status.label));
    now.append(createTextElement("span", "", confidenceLabel(venue.activity?.confidence)));

    const movement = document.createElement("div");
    movement.className = "buzz-signal-trend";
    movement.append(createTextElement("small", "", truthMode === "live" ? "Live movement" : "Forecast movement"));
    movement.append(createTextElement("strong", `trend-${trend.direction.replaceAll("_", "-")}`, `${trendGlyph(trend.direction)} ${trend.label}`));
    movement.append(createTextElement("span", "", formatWindow(trend.windowMinutes)));

    const chart = document.createElement("div");
    chart.className = "buzz-signal-chart";
    chart.append(sparkline(trend.samples, trend.direction));
    panel.append(now, movement, chart);
    title.insertAdjacentElement("afterend", panel);
  }

  const reason = detail.querySelector<HTMLElement>(".buzz-detail-reason");
  if (reason) {
    reason.textContent = "";
    const marker = createTextElement("span", "buzz-reason-marker", "●");
    marker.setAttribute("aria-hidden", "true");
    const content = document.createElement("div");
    content.append(createTextElement("strong", "", "Why now"));
    const list = document.createElement("ul");
    reasonLines(venue).forEach(line => list.append(createTextElement("li", "", line)));
    content.append(list);
    reason.append(marker, content);
  }

  const truth = detail.querySelector<HTMLElement>(".buzz-truth-note");
  if (truth) truth.hidden = false;
  detail.querySelector(".buzz-method-details")?.remove();
  if (reason) {
    const method = document.createElement("details");
    method.className = "buzz-method-details";
    const summary = document.createElement("summary");
    summary.textContent = truthMode === "live" ? "How Buzz verifies this" : "How Buzz estimates this";
    const explanation = createTextElement("p", "", truthMode === "live"
      ? "Live means fresh direct evidence passed Buzz’s truth threshold. It confirms nearby activity, not an exact headcount or room capacity."
      : "This is a forecast, not a measured crowd. Buzz combines opening hours, events, ticket demand, area movement, weather, transit, provider data, and venue patterns.");
    method.append(summary, explanation);
    reason.insertAdjacentElement("afterend", method);
  }

  enhanceCrowdButtons(detail);
  detail.dataset.buzzSignal = signature;
}

export default function BuzzStatusRuntime() {
  useEffect(() => {
    let venues: Venue[] = [];
    let venuesByName = new Map<string, Venue>();
    let trends = new Map<string, VenueTrend>();
    let observer: MutationObserver | null = null;
    let frame = 0;
    let fallbackTimer = 0;

    const enhance = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const root = document.querySelector(".buzz-map-app");
        if (!root) return;
        enhanceList(root, venuesByName, trends);
        enhanceDetail(root, venuesByName, trends);
        enhanceCrowdButtons(root);
      });
    };

    const fetchTrends = async () => {
      if (!venues.length) return;
      try {
        const response = await fetch("/api/buzz/trends", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ venueIds: venues.map(venue => venue.id) }),
          cache: "no-store",
        });
        const payload = await response.json() as TrendPayload;
        if (!response.ok || !payload.success || !payload.trends) return;
        for (const venue of venues) {
          const serverTrend = payload.trends[venue.id];
          if (serverTrend?.samples?.length >= 2) trends.set(venue.id, serverTrend);
        }
        enhance();
      } catch {
        // Local observations continue to provide a useful trend when history is unavailable.
      }
    };

    const acceptVenues = (next: Venue[]) => {
      venues = next;
      venuesByName = new Map(next.map(venue => [normalize(venue.name), venue]));
      const cache = updateCache(next);
      trends = new Map(next.map(venue => [venue.id, localTrend(venue, cache)]));
      enhance();
      void fetchTrends();
    };

    const onDiscovery = (event: Event) => {
      const payload = (event as CustomEvent<DiscoveryPayload>).detail;
      acceptVenues(payload?.venues || payload?.picks || []);
    };

    window.addEventListener("activity757:discovery", onDiscovery);
    observer = new MutationObserver(enhance);
    const app = document.querySelector(".buzz-map-app");
    if (app) observer.observe(app, { childList: true, subtree: true });
    else {
      const wait = new MutationObserver(() => {
        const mounted = document.querySelector(".buzz-map-app");
        if (!mounted || !observer) return;
        observer.observe(mounted, { childList: true, subtree: true });
        wait.disconnect();
      });
      wait.observe(document.documentElement, { childList: true, subtree: true });
    }

    fallbackTimer = window.setTimeout(() => {
      if (venues.length) return;
      void fetch("/api/nearby?limit=400", { cache: "no-store" })
        .then(response => response.ok ? response.json() : null)
        .then((payload: DiscoveryPayload | null) => { if (payload) acceptVenues(payload.venues || payload.picks || []); })
        .catch(() => undefined);
    }, 1_500);

    const refresh = window.setInterval(() => {
      if (document.visibilityState !== "visible" || !venues.length) return;
      const cache = updateCache(venues);
      for (const venue of venues) {
        const current = localTrend(venue, cache);
        if ((trends.get(venue.id)?.samples.length || 0) < 2) trends.set(venue.id, current);
      }
      void fetchTrends();
      enhance();
    }, REFRESH_MS);

    return () => {
      window.removeEventListener("activity757:discovery", onDiscovery);
      observer?.disconnect();
      cancelAnimationFrame(frame);
      window.clearTimeout(fallbackTimer);
      window.clearInterval(refresh);
    };
  }, []);

  return null;
}
