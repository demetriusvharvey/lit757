"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Ticket, Users } from "lucide-react";
import { supabase } from "../src/lib/supabase";

type EventInfo = { id: string; name: string; ticketStatus?: string | null };
type VenueInfo = { id: string; event?: EventInfo | null };
type Engagement = {
  eventId: string;
  interested: number;
  going: number;
  mine: "interested" | "going" | null;
  ticketing: {
    capacity: number | null;
    ticketsSold: number | null;
    status: string | null;
    source: string | null;
    verified: boolean;
    updatedAt: string | null;
  } | null;
};

function ticketLabel(ticketing: Engagement["ticketing"]) {
  if (!ticketing) return null;
  if (ticketing.verified && ticketing.capacity != null && ticketing.ticketsSold != null) {
    return `${ticketing.ticketsSold.toLocaleString()} / ${ticketing.capacity.toLocaleString()} tickets sold`;
  }
  return ticketing.status || null;
}

export default function EventEngagementEnhancer() {
  const [venues, setVenues] = useState<VenueInfo[]>([]);
  const [venueId, setVenueId] = useState<string | null>(null);
  const [mount, setMount] = useState<HTMLElement | null>(null);
  const [engagement, setEngagement] = useState<Engagement | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const selectedEvent = useMemo(
    () => venues.find((venue) => venue.id === venueId)?.event || null,
    [venues, venueId]
  );

  useEffect(() => {
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<{ venues?: VenueInfo[] }>).detail;
      if (Array.isArray(detail?.venues)) setVenues(detail.venues);
    };
    window.addEventListener("lit757:discovery", receive);
    return () => window.removeEventListener("lit757:discovery", receive);
  }, []);

  useEffect(() => {
    const sync = () => {
      setVenueId(new URLSearchParams(window.location.search).get("venue"));
      const scheduleLabel = Array.from(document.querySelectorAll("p")).find(
        (node) => node.textContent?.trim() === "On the schedule"
      );
      const card = scheduleLabel?.parentElement?.parentElement?.parentElement as HTMLElement | null;
      if (!card) {
        setMount(null);
        return;
      }
      let host = card.querySelector<HTMLElement>("#lit-event-engagement");
      if (!host) {
        host = document.createElement("div");
        host.id = "lit-event-engagement";
        card.appendChild(host);
      }
      setMount(host);
    };

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("popstate", sync);
    const timer = window.setInterval(sync, 500);
    return () => {
      observer.disconnect();
      window.removeEventListener("popstate", sync);
      window.clearInterval(timer);
      document.getElementById("lit-event-engagement")?.remove();
    };
  }, []);

  const load = useCallback(async () => {
    if (!selectedEvent) return;
    const { data } = await supabase.auth.getSession();
    const headers: HeadersInit = {};
    if (data.session?.access_token) headers.Authorization = `Bearer ${data.session.access_token}`;
    const response = await fetch(`/api/events/engagement?eventId=${encodeURIComponent(selectedEvent.id)}`, {
      cache: "no-store",
      headers,
    });
    if (response.ok) setEngagement((await response.json()) as Engagement);
  }, [selectedEvent]);

  useEffect(() => {
    // Selection drives a fresh remote engagement snapshot.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // Engagement is cached between selections, but it is only valid while the
  // event that produced it remains selected.
  const visibleEngagement = selectedEvent ? engagement : null;

  async function update(status: "interested" | "going") {
    if (!selectedEvent) return;
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      setMessage("Sign in from the account button to save your plans.");
      return;
    }

    setBusy(true);
    setMessage("");
    const nextStatus = visibleEngagement?.mine === status ? null : status;
    try {
      const response = await fetch("/api/events/engagement", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${data.session.access_token}`,
        },
        body: JSON.stringify({ eventId: selectedEvent.id, status: nextStatus }),
      });
      const payload = (await response.json()) as Engagement & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not save your plans.");
      setEngagement(payload);
      setMessage(nextStatus === "going" ? "Added to Going." : nextStatus === "interested" ? "Saved as Interested." : "Removed.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save your plans.");
    } finally {
      setBusy(false);
    }
  }

  if (!mount || !selectedEvent) return null;

  const salesLabel = ticketLabel(visibleEngagement?.ticketing || null) || selectedEvent.ticketStatus || null;
  const ticketing = visibleEngagement?.ticketing;
  const percentage = ticketing?.verified && ticketing.capacity != null && ticketing.capacity > 0 && ticketing.ticketsSold != null
    ? Math.min(100, Math.round((ticketing.ticketsSold / ticketing.capacity) * 100))
    : null;

  return createPortal(
    <div className="mt-4 border-t border-black/[0.07] pt-4">
      {salesLabel && (
        <div className="rounded-[1rem] bg-black/[0.045] p-3">
          <div className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-2 text-[11px] font-semibold text-black/68">
              <Ticket size={14} /> {salesLabel}
            </span>
            {ticketing?.verified && <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-[#d44b2b]">Verified</span>}
          </div>
          {percentage != null && (
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-black/[0.08]">
              <div className="h-full rounded-full bg-[#ff5c35]" style={{ width: `${percentage}%` }} />
            </div>
          )}
        </div>
      )}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" disabled={busy} onClick={() => void update("interested")} className={`flex h-11 items-center justify-center gap-2 rounded-full text-[11px] font-semibold transition disabled:opacity-50 ${visibleEngagement?.mine === "interested" ? "bg-[#171716] text-white" : "border border-black/[0.09] bg-white text-black/68"}`}>
          {visibleEngagement?.mine === "interested" ? <Check size={14} /> : <Users size={14} />}
          Interested · {visibleEngagement?.interested || 0}
        </button>
        <button type="button" disabled={busy} onClick={() => void update("going")} className={`flex h-11 items-center justify-center gap-2 rounded-full text-[11px] font-semibold transition disabled:opacity-50 ${visibleEngagement?.mine === "going" ? "bg-[#ff5c35] text-white" : "border border-[#ffb49f] bg-[#fff0e8] text-[#ba3e24]"}`}>
          {visibleEngagement?.mine === "going" && <Check size={14} />}
          Going · {visibleEngagement?.going || 0}
        </button>
      </div>
      {message && <p className="mt-2 text-center text-[10px] text-black/44">{message}</p>}
    </div>,
    mount
  );
}
