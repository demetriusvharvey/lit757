"use client";

import {
  ArrowRight,
  Clock3,
  MapPin,
  Navigation,
  Route,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import {
  buildNightPlan,
  parseNightPlanPrompt,
  type NightPlan,
} from "../../src/lib/night-planner";
import type { BuzzVenue, NearbyPayload } from "../buzz-map-model";

const samplePrompts = [
  "Date night under $100 in Norfolk",
  "Sober night with live music",
  "Something fun with kids",
  "Dinner then dancing, high energy",
  "Quiet and wheelchair accessible",
];

type BuzzNightPlannerProps = {
  open: boolean;
  venues: BuzzVenue[];
  onClose: () => void;
  onSelectVenue: (venue: BuzzVenue) => void;
};

function directionsUrl(venue: BuzzVenue) {
  const destination = venue.address || `${venue.lat},${venue.lng}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
}

function stopTypeLabel(value: string) {
  return value.replaceAll("_", " ");
}

export function BuzzNightPlanner({ open, venues, onClose, onSelectVenue }: BuzzNightPlannerProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [prompt, setPrompt] = useState("");
  const [plan, setPlan] = useState<NightPlan | null>(null);
  const [inventory, setInventory] = useState<BuzzVenue[]>(venues);
  const [planning, setPlanning] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!open) return;
    const focusedElement = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const returnTarget = focusedElement && focusedElement !== document.body
      ? focusedElement
      : document.querySelector<HTMLElement>(".buzz-plan-night");
    textareaRef.current?.focus();

    const handleDialogKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>(
        "button:not([disabled]), textarea, input, a[href], summary",
      ) || [])].filter(element => !element.hidden);
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleDialogKey);
    return () => {
      document.removeEventListener("keydown", handleDialogKey);
      if (returnTarget?.isConnected) returnTarget.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  const submitPlan = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPlanning(true);
    setMessage("Reading your vibe and checking current places…");

    let candidates = venues;
    const now = new Date();
    const intent = parseNightPlanPrompt(prompt, now);
    try {
      const params = new URLSearchParams({ limit: "400" });
      if (intent.city) params.set("q", intent.city);
      const response = await fetch(`/api/nearby?${params.toString()}`, { cache: "no-store" });
      const payload = await response.json() as NearbyPayload;
      const refreshed = payload.venues || payload.picks || [];
      if (response.ok && payload.success !== false && refreshed.length) candidates = refreshed;
    } catch {
      // The current on-screen inventory remains a safe, useful fallback.
    }

    const nextPlan = buildNightPlan(candidates, prompt, { now });
    setInventory(candidates);
    setPlan(nextPlan);
    setPlanning(false);
    setMessage(nextPlan.stops.length
      ? `Built ${nextPlan.stops.length} stop${nextPlan.stops.length === 1 ? "" : "s"} from ${candidates.length} current places.`
      : "No trustworthy match yet. Try a wider area or fewer constraints.");
  };

  const chooseVenue = (venueId: string) => {
    const venue = inventory.find(candidate => String(candidate.id) === String(venueId));
    if (!venue) return;
    onSelectVenue(venue);
    onClose();
  };

  return (
    <div className="buzz-planner-backdrop" onMouseDown={event => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section
        ref={dialogRef}
        className="buzz-planner"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <header className="buzz-planner-head">
          <div className="buzz-planner-icon" aria-hidden="true"><Sparkles /></div>
          <div>
            <small>ASK BUZZ</small>
            <h2 id={titleId}>Plan my night</h2>
            <p id={descriptionId}>Say what you want in your own words. Buzz turns it into a route using current 757 places and activity evidence.</p>
          </div>
          <button type="button" className="buzz-planner-close" aria-label="Close night planner" onClick={onClose}><X /></button>
        </header>

        <form className="buzz-planner-form" onSubmit={submitPlan}>
          <label htmlFor={`${titleId}-prompt`}>What kind of night do you want?</label>
          <div className="buzz-planner-prompt">
            <textarea
              ref={textareaRef}
              id={`${titleId}-prompt`}
              value={prompt}
              onChange={event => setPrompt(event.target.value)}
              maxLength={500}
              rows={3}
              placeholder="Dinner, dancing, under $80, no long lines…"
            />
            <button type="submit" disabled={planning}>
              <Sparkles /> {planning ? "Planning…" : "Build my night"}
            </button>
          </div>
          <div className="buzz-planner-samples" aria-label="Example requests">
            {samplePrompts.map(sample => (
              <button type="button" key={sample} onClick={() => {
                setPrompt(sample);
                textareaRef.current?.focus();
              }}>{sample}</button>
            ))}
          </div>
          <p className="buzz-planner-status" role="status" aria-live="polite">{message || "Try anything—date, family, sober, budget, accessibility, vibe, location, or a sequence of stops."}</p>
        </form>

        {plan && (
          <div className="buzz-planner-results">
            <div className="buzz-planner-understood">
              <span>BUZZ HEARD</span>
              <div>{plan.intent.understood.map(item => <b key={item}>{item}</b>)}</div>
            </div>

            <div className="buzz-planner-plan-head">
              <div>
                <small>{plan.liveStops ? `${plan.liveStops} LIVE` : "CURRENT FORECAST"}</small>
                <h3>{plan.title}</h3>
                <p>{plan.summary}</p>
              </div>
              <div className="buzz-planner-count"><Route /><strong>{plan.stops.length}</strong><span>stops</span></div>
            </div>

            <ol className="buzz-planner-stops">
              {plan.stops.map((stop, index) => {
                const venue = inventory.find(candidate => String(candidate.id) === String(stop.venue.id));
                return (
                  <li key={stop.venue.id}>
                    <div className="buzz-planner-line" aria-hidden="true"><b>{index + 1}</b><i /></div>
                    <article>
                      <div className="buzz-planner-stop-meta">
                        <span><Clock3 /> {stop.timeLabel}</span>
                        {stop.travelMinutesFromPrevious !== null && <span><Navigation /> {stop.travelMinutesFromPrevious} min from last stop</span>}
                        <b className={stop.truthLabel === "Live activity" ? "live" : "forecast"}>{stop.truthLabel}</b>
                      </div>
                      <small>{stopTypeLabel(stop.interest)}</small>
                      <h4>{stop.venue.name}</h4>
                      <p><MapPin /> {stop.venue.city || "Hampton Roads"}{stop.venue.address ? ` · ${stop.venue.address}` : ""}</p>
                      <ul>{stop.why.map(reason => <li key={reason}>{reason}</li>)}</ul>
                      <div className="buzz-planner-stop-actions">
                        <button type="button" disabled={!venue} onClick={() => chooseVenue(stop.venue.id)}>See on Buzz <ArrowRight /></button>
                        {venue && <a href={directionsUrl(venue)} target="_blank" rel="noreferrer">Directions <Navigation /></a>}
                      </div>
                    </article>
                  </li>
                );
              })}
            </ol>

            {plan.backup && (
              <button type="button" className="buzz-planner-backup" onClick={() => chooseVenue(plan.backup!.id)}>
                <ShieldCheck />
                <span><small>BACKUP</small><strong>{plan.backup.name}</strong><em>{plan.backupWhy}</em></span>
                <ArrowRight />
              </button>
            )}

            {plan.caveats.length > 0 && (
              <details className="buzz-planner-caveats">
                <summary>What Buzz could not verify</summary>
                <ul>{plan.caveats.map(caveat => <li key={caveat}>{caveat}</li>)}</ul>
              </details>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
