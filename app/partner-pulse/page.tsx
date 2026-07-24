"use client";

import { FormEvent, useEffect, useState } from "react";

const bands = [
  { id: "quiet", label: "Quiet", detail: "Plenty of room" },
  { id: "steady", label: "Steady", detail: "Normal crowd" },
  { id: "busy", label: "Busy", detail: "Strong activity" },
  { id: "packed", label: "Packed", detail: "At or near capacity" },
] as const;

type Band = (typeof bands)[number]["id"];

export default function PartnerPulsePage() {
  const [venueId, setVenueId] = useState("");
  const [venueName, setVenueName] = useState("Your venue");
  const [accessKey, setAccessKey] = useState("");
  const [managerName, setManagerName] = useState("");
  const [band, setBand] = useState<Band>("steady");
  const [occupancyPct, setOccupancyPct] = useState("");
  const [waitMinutes, setWaitMinutes] = useState("");
  const [reservationsStatus, setReservationsStatus] = useState("");
  const [ticketsStatus, setTicketsStatus] = useState("");
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const [expiresAt, setExpiresAt] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    // The partner handoff URL pre-fills the venue after client hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVenueId(params.get("venueId") || "");
    setVenueName(params.get("venue") || "Your venue");
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    setExpiresAt(null);

    if (!venueId.trim() || !accessKey.trim()) {
      setMessage("Venue ID and access key are required.");
      return;
    }

    setWorking(true);
    try {
      const response = await fetch("/api/buzz/partner-pulse", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-buzz-partner-secret": accessKey.trim(),
        },
        body: JSON.stringify({
          venueId: venueId.trim(),
          occupancyBand: band,
          occupancyPct: occupancyPct === "" ? null : Number(occupancyPct),
          waitMinutes: waitMinutes === "" ? null : Number(waitMinutes),
          reservationsStatus: reservationsStatus.trim() || null,
          ticketsStatus: ticketsStatus.trim() || null,
          submittedBy: managerName.trim() || "venue manager",
        }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string; expiresAt?: string };
      if (!response.ok) throw new Error(payload.error || "Could not submit the venue pulse");
      setMessage("Live venue pulse published.");
      setExpiresAt(payload.expiresAt || null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not submit the venue pulse");
    } finally {
      setWorking(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#111217] px-4 py-8 text-white sm:px-6">
      <div className="mx-auto max-w-xl">
        <header className="mb-7">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#ff8c70]">Buzz Venue Pulse</p>
          <h1 className="mt-2 text-4xl font-semibold tracking-[-0.05em]">Update {venueName}</h1>
          <p className="mt-3 text-sm leading-6 text-white/55">This update affects Buzz immediately and expires after 30 minutes. Submit what is happening now—not what you expect later.</p>
        </header>

        <form onSubmit={submit} className="space-y-5 rounded-[2rem] border border-white/10 bg-white/[0.055] p-5 shadow-2xl sm:p-7">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-2 text-xs font-semibold text-white/65">
              Venue ID
              <input value={venueId} onChange={event => setVenueId(event.target.value)} placeholder="Venue UUID" className="h-12 w-full rounded-xl border border-white/10 bg-black/25 px-4 text-sm text-white outline-none focus:border-[#ff8c70]" />
            </label>
            <label className="space-y-2 text-xs font-semibold text-white/65">
              Access key
              <input type="password" value={accessKey} onChange={event => setAccessKey(event.target.value)} autoComplete="current-password" placeholder="Partner access key" className="h-12 w-full rounded-xl border border-white/10 bg-black/25 px-4 text-sm text-white outline-none focus:border-[#ff8c70]" />
            </label>
          </div>

          <label className="block space-y-2 text-xs font-semibold text-white/65">
            Manager name or shift
            <input value={managerName} onChange={event => setManagerName(event.target.value)} placeholder="Example: Friday night manager" className="h-12 w-full rounded-xl border border-white/10 bg-black/25 px-4 text-sm text-white outline-none focus:border-[#ff8c70]" />
          </label>

          <fieldset>
            <legend className="mb-3 text-xs font-semibold text-white/65">How active is it?</legend>
            <div className="grid grid-cols-2 gap-3">
              {bands.map(option => (
                <button key={option.id} type="button" onClick={() => setBand(option.id)} className={`rounded-2xl border p-4 text-left transition ${band === option.id ? "border-[#ff6c4a] bg-[#ff6c4a] text-white" : "border-white/10 bg-black/20 text-white/75 hover:border-white/25"}`}>
                  <strong className="block text-base">{option.label}</strong>
                  <span className={`mt-1 block text-xs ${band === option.id ? "text-white/75" : "text-white/40"}`}>{option.detail}</span>
                </button>
              ))}
            </div>
          </fieldset>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-2 text-xs font-semibold text-white/65">
              Occupancy estimate (%)
              <input type="number" min="0" max="100" value={occupancyPct} onChange={event => setOccupancyPct(event.target.value)} placeholder="Optional" className="h-12 w-full rounded-xl border border-white/10 bg-black/25 px-4 text-sm text-white outline-none focus:border-[#ff8c70]" />
            </label>
            <label className="space-y-2 text-xs font-semibold text-white/65">
              Wait time (minutes)
              <input type="number" min="0" max="240" value={waitMinutes} onChange={event => setWaitMinutes(event.target.value)} placeholder="Optional" className="h-12 w-full rounded-xl border border-white/10 bg-black/25 px-4 text-sm text-white outline-none focus:border-[#ff8c70]" />
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-2 text-xs font-semibold text-white/65">
              Reservations
              <input value={reservationsStatus} onChange={event => setReservationsStatus(event.target.value)} placeholder="Open, limited, waitlist…" className="h-12 w-full rounded-xl border border-white/10 bg-black/25 px-4 text-sm text-white outline-none focus:border-[#ff8c70]" />
            </label>
            <label className="space-y-2 text-xs font-semibold text-white/65">
              Tickets / entry
              <input value={ticketsStatus} onChange={event => setTicketsStatus(event.target.value)} placeholder="Available, few left, sold out…" className="h-12 w-full rounded-xl border border-white/10 bg-black/25 px-4 text-sm text-white outline-none focus:border-[#ff8c70]" />
            </label>
          </div>

          <button type="submit" disabled={working} className="h-13 w-full rounded-full bg-[#ff6c4a] px-5 py-3.5 text-sm font-bold text-white transition hover:bg-[#ff8064] disabled:cursor-not-allowed disabled:opacity-50">
            {working ? "Publishing…" : "Publish 30-minute pulse"}
          </button>

          {message && <div className={`rounded-2xl border p-4 text-sm ${expiresAt ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-100" : "border-amber-300/20 bg-amber-300/10 text-amber-100"}`}><strong>{message}</strong>{expiresAt && <p className="mt-1 text-xs opacity-70">Expires {new Date(expiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</p>}</div>}
        </form>

        <p className="mt-5 text-center text-xs leading-5 text-white/35">Do not share the access key publicly. Buzz records the latest pulse and automatically removes its influence when it expires.</p>
      </div>
    </main>
  );
}
