"use client";

import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  CloudSun,
  Database,
  RefreshCw,
  RadioTower,
  ShipWheel,
  TrainFront,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

type UnknownRecord = Record<string, unknown>;

type DashboardPayload = {
  dataHealth: UnknownRecord | null;
  cityCalendars: UnknownRecord | null;
  institutions: UnknownRecord | null;
  integrations: UnknownRecord | null;
  errors: string[];
  loadedAt: string;
};

const emptyPayload: DashboardPayload = {
  dataHealth: null,
  cityCalendars: null,
  institutions: null,
  integrations: null,
  errors: [],
  loadedAt: "",
};

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : {};
}

function rows(value: unknown) {
  return Array.isArray(value) ? value.filter(item => item && typeof item === "object") as UnknownRecord[] : [];
}

function stringRows(value: unknown) {
  return Array.isArray(value) ? value.filter(item => typeof item === "string").map(String) : [];
}

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function text(value: unknown, fallback = "—") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function formatTime(value: unknown) {
  const raw = typeof value === "string" ? value : "";
  const date = new Date(raw);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date)
    : "Not available";
}

function healthClass(status: unknown) {
  const normalized = String(status || "").toLowerCase();
  if (["healthy", "ok", "live", "success"].includes(normalized)) return "healthy";
  if (["partial", "degraded", "warning"].includes(normalized)) return "degraded";
  return "error";
}

function StatusIcon({ status }: { status: unknown }) {
  const state = healthClass(status);
  return state === "healthy" ? <CheckCircle2 /> : state === "degraded" ? <AlertTriangle /> : <XCircle />;
}

async function json(path: string) {
  const response = await fetch(path, { cache: "no-store" });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload) throw new Error(`${path} returned ${response.status}`);
  return payload as UnknownRecord;
}

export default function ProviderHealthDashboard() {
  const [payload, setPayload] = useState<DashboardPayload>(emptyPayload);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const requests = [
      ["dataHealth", "/api/data-health"],
      ["cityCalendars", `/api/data/city-calendars?healthDashboard=${Date.now()}`],
      ["institutions", `/api/data/institution-calendars?healthDashboard=${Date.now()}`],
      ["integrations", "/api/integrations"],
    ] as const;
    const results = await Promise.allSettled(requests.map(([, path]) => json(path)));
    const next: DashboardPayload = { ...emptyPayload, errors: [], loadedAt: new Date().toISOString() };
    results.forEach((result, index) => {
      const [key, path] = requests[index];
      if (result.status === "fulfilled") next[key] = result.value;
      else next.errors.push(`${path}: ${result.reason instanceof Error ? result.reason.message : "Unknown error"}`);
    });
    setPayload(next);
    setLoading(false);
  }, []);

  useEffect(() => {
    // This dashboard is intentionally client-refreshed because every provider
    // status must bypass caches and represent current production health.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const dataHealth = record(payload.dataHealth);
  const cityCalendars = record(payload.cityCalendars);
  const institutions = record(payload.institutions);
  const integrations = record(payload.integrations);
  const eventHealth = record(dataHealth.events);
  const realtime = record(dataHealth.realtime);
  const directPresence = record(realtime.directPresence);
  const publicFeeds = record(dataHealth.publicFeeds);
  const weather = record(publicFeeds.weather);
  const transit = record(publicFeeds.transit);
  const staticTransit = record(transit.static);
  const realtimeTransit = record(transit.realtime);
  const citySummary = record(cityCalendars.summary);
  const cityHealth = record(cityCalendars.cityHealth);
  const institutionSummary = record(institutions.summary);
  const integrationCounts = record(integrations.counts);
  const institutionSources = rows(institutions.sources);

  const cityRows = Object.entries(cityHealth).map(([city, value]) => {
    const details = record(value);
    const working = numberValue(details.successfulFeeds);
    const registered = numberValue(details.registeredFeeds);
    return { city, working, registered, status: working > 0 ? working === registered ? "healthy" : "degraded" : "error" };
  });

  const failedInstitutions = institutionSources.filter(source => String(source.status) !== "ok");
  const healthyInstitutions = institutionSources.filter(source => String(source.status) === "ok");
  const warnings = stringRows(dataHealth.warnings);
  const overallHealthy = Boolean(dataHealth.success)
    && Boolean(cityCalendars.success)
    && !Boolean(cityCalendars.partial)
    && Boolean(institutions.success)
    && !Boolean(institutions.partial)
    && warnings.length === 0
    && payload.errors.length === 0;

  return (
    <main className="provider-health-page">
      <header className="provider-health-hero">
        <div className="provider-health-topline">
          <Link href="/integrations"><ArrowLeft /> Integration Control Center</Link>
          <button type="button" onClick={() => void refresh()} disabled={loading}><RefreshCw className={loading ? "spin" : ""} /> Refresh live health</button>
        </div>
        <div className="provider-health-kicker"><RadioTower /> BUZZ OPERATIONS</div>
        <div className="provider-health-title-row">
          <div><h1>Live provider health</h1><p>Runtime truth for data inventory, official calendars, activity evidence, weather, transit, and production integrations.</p></div>
          <span className={`provider-overall ${overallHealthy ? "healthy" : "degraded"}`}><StatusIcon status={overallHealthy ? "healthy" : "degraded"} />{overallHealthy ? "Systems healthy" : "Operating with warnings"}</span>
        </div>
        <div className="provider-health-meta"><span>Last dashboard refresh: {formatTime(payload.loadedAt)}</span><span>Data generated: {formatTime(dataHealth.generatedAt)}</span></div>
      </header>

      <section className="provider-summary-grid">
        <article><CalendarDays /><div><strong>{numberValue(eventHealth.upcomingNext60Days)}</strong><span>Upcoming events</span><small>Next 60 days</small></div></article>
        <article><Activity /><div><strong>{text(directPresence.activeDeviceBand, "none")}</strong><span>Fresh nearby phones</span><small>{numberValue(directPresence.venuesMeetingLiveThreshold)} live-ready venues</small></div></article>
        <article><Database /><div><strong>{numberValue(realtime.activeScores)}</strong><span>Active Buzz scores</span><small>Newest {formatTime(realtime.newestScoreAt)}</small></div></article>
        <article><RadioTower /><div><strong>{numberValue(integrationCounts.live)}</strong><span>Live integrations</span><small>{numberValue(integrationCounts["needs-key"])} need keys</small></div></article>
        <article><CalendarDays /><div><strong>{numberValue(citySummary.successfulFeeds)}/{numberValue(citySummary.registeredFeeds)}</strong><span>Municipal feeds</span><small>{numberValue(citySummary.dedupedEvents)} events</small></div></article>
        <article><ShipWheel /><div><strong>{numberValue(institutionSummary.successfulSources)}/{numberValue(institutionSummary.registeredSources)}</strong><span>Institution sources</span><small>{numberValue(institutionSummary.dedupedEvents)} events</small></div></article>
      </section>

      {payload.errors.length > 0 && <section className="provider-alert critical"><XCircle /><div><strong>Dashboard requests failed</strong>{payload.errors.map(item => <p key={item}>{item}</p>)}</div></section>}

      <section className="provider-health-layout">
        <div className="provider-health-column">
          <section className="provider-panel">
            <header><div><small>OFFICIAL LOCAL INVENTORY</small><h2>City calendar health</h2></div><span className={healthClass(cityCalendars.partial ? "degraded" : "healthy")}><StatusIcon status={cityCalendars.partial ? "degraded" : "healthy"} />{cityCalendars.partial ? "Degraded" : "Healthy"}</span></header>
            <div className="provider-table">
              {cityRows.map(city => <div key={city.city}><span className={`provider-dot ${city.status}`} /><strong>{city.city}</strong><em>{city.working}/{city.registered} feeds</em></div>)}
              {!cityRows.length && <p>No city health payload is available.</p>}
            </div>
          </section>

          <section className="provider-panel">
            <header><div><small>FIRST-PARTY EVENTS</small><h2>Institution and tourism sources</h2></div><span className={failedInstitutions.length ? "degraded" : "healthy"}><StatusIcon status={failedInstitutions.length ? "degraded" : "healthy"} />{healthyInstitutions.length} healthy</span></header>
            <div className="provider-source-list">
              {institutionSources.map(source => <article key={text(source.id)} className={healthClass(source.status)}><StatusIcon status={source.status} /><div><strong>{text(source.name)}</strong><span>{text(source.city)} · {text(source.kind)} · {text(source.format)}</span>{source.error ? <small>{text(source.error)}</small> : <small>{numberValue(source.eventCount)} events</small>}</div></article>)}
            </div>
          </section>
        </div>

        <div className="provider-health-column">
          <section className="provider-panel">
            <header><div><small>ENVIRONMENT</small><h2>Weather and mobility</h2></div><span className={healthClass(weather.status)}><StatusIcon status={weather.status} />{text(weather.status, "Unknown")}</span></header>
            <div className="provider-feed-cards">
              <article><CloudSun /><div><strong>National Weather Service</strong><span>{rows(weather.points).length} Hampton Roads points</span><small>{weather.error ? text(weather.error) : "Forecasts, hourly conditions, and alerts available"}</small></div></article>
              <article><TrainFront /><div><strong>HRT static GTFS</strong><span>{numberValue(staticTransit.routeCount)} routes · {numberValue(staticTransit.stopCount)} stops</span><small>{text(staticTransit.status, "Unknown")}</small></div></article>
              <article><TrainFront /><div><strong>HRT realtime</strong><span>{numberValue(realtimeTransit.tripUpdates)} trips · {numberValue(realtimeTransit.serviceAlerts)} alerts</span><small>{numberValue(realtimeTransit.vehicles)} vehicle positions</small></div></article>
            </div>
          </section>

          <section className="provider-panel">
            <header><div><small>LIVE-EVIDENCE STACK</small><h2>Signals and score freshness</h2></div><span className={numberValue(realtime.activeSignals) && numberValue(realtime.activeScores) ? "healthy" : "degraded"}><StatusIcon status={numberValue(realtime.activeSignals) && numberValue(realtime.activeScores) ? "healthy" : "degraded"} />Current state</span></header>
            <div className="provider-metrics">
              <div><span>Provider venue mappings</span><strong>{numberValue(realtime.mappedVenues)}</strong></div>
              <div><span>Ticketed-event mappings</span><strong>{numberValue(realtime.mappedTicketedEvents)}</strong></div>
              <div><span>Newest provider success</span><strong>{formatTime(realtime.newestProviderSuccessAt)}</strong></div>
              <div><span>Newest signal</span><strong>{formatTime(realtime.newestSignalAt)}</strong></div>
              <div><span>Newest score</span><strong>{formatTime(realtime.newestScoreAt)}</strong></div>
              <div><span>Fresh nearby phones</span><strong>{text(directPresence.activeDeviceBand, "none")}</strong></div>
              <div><span>Venues with phone evidence</span><strong>{numberValue(directPresence.venuesWithEvidence)}</strong></div>
              <div><span>Venues meeting Live threshold</span><strong>{numberValue(directPresence.venuesMeetingLiveThreshold)}</strong></div>
              <div><span>Newest phone evidence</span><strong>{formatTime(directPresence.newestPresenceAt)}</strong></div>
              <div><span>Snapshot signals</span><strong>{numberValue(realtime.activeSignals)} active · {numberValue(realtime.liveSignals)} live</strong></div>
              <div><span>Events with source links</span><strong>{numberValue(eventHealth.withTicketLink)}</strong></div>
            </div>
          </section>

          <section className="provider-panel">
            <header><div><small>ACTION REQUIRED</small><h2>Warnings and blocked coverage</h2></div><span className={warnings.length || failedInstitutions.length ? "degraded" : "healthy"}><AlertTriangle />{warnings.length + failedInstitutions.length} items</span></header>
            <div className="provider-warning-list">
              {warnings.map(item => <p key={item}><AlertTriangle />{item}</p>)}
              {failedInstitutions.map(source => <p key={text(source.id)}><XCircle />{text(source.name)}: {text(source.error, "Source failed")}</p>)}
              {!warnings.length && !failedInstitutions.length && <p className="clear"><CheckCircle2 />No runtime warnings.</p>}
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}
