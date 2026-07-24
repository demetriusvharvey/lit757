"use client";

import { useState } from "react";
import { Check, LoaderCircle, MapPin } from "lucide-react";

const OPTIONS = [
  { id: "quiet", label: "Quiet" },
  { id: "active", label: "Active" },
  { id: "packed", label: "Packed" },
  { id: "line_short", label: "Short line" },
  { id: "line_long", label: "Long line" },
  { id: "parking_easy", label: "Easy parking" },
  { id: "parking_hard", label: "Parking tough" },
];

export function ActivityReport({ venueId, accessToken, verifiedNearby = false }: { venueId: string; accessToken?: string | null; verifiedNearby?: boolean }) {
  const [working, setWorking] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  async function report(status: string) {
    if (!accessToken) {
      setMessage("Sign in to add a verified activity update.");
      return;
    }
    setWorking(status);
    setMessage("");
    try {
      const response = await fetch("/api/contributions/activity", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ venueId, status, verifiedNearby }),
      });
      const payload = await response.json().catch(() => ({}));
      setMessage(payload.message || payload.error || (response.ok ? "Update received." : "Could not submit this update."));
    } catch {
      setMessage("Could not submit this update.");
    } finally {
      setWorking(null);
    }
  }

  return (
    <section className="rounded-[1.45rem] border border-black/[0.08] bg-white/72 p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-black/[0.055] text-black/55"><MapPin size={15} /></span>
        <div>
          <p className="text-[14px] font-semibold tracking-[-0.025em] text-black/78">How is it right now?</p>
          <p className="mt-1 text-[11px] leading-5 text-black/42">Fresh reports expire quickly and help Buzz correct predictions.</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {OPTIONS.map(option => (
          <button key={option.id} type="button" disabled={Boolean(working)} onClick={() => void report(option.id)} className="inline-flex h-9 items-center gap-1.5 rounded-full border border-black/[0.08] bg-[#f7f5ef] px-3 text-[10px] font-semibold text-black/58 transition hover:border-black/20 hover:text-black/75 disabled:opacity-50">
            {working === option.id ? <LoaderCircle size={12} className="animate-spin" /> : message && working === null ? null : <Check size={11} className="opacity-35" />}{option.label}
          </button>
        ))}
      </div>
      {message && <p className="mt-3 text-[11px] leading-5 text-black/48">{message}</p>}
    </section>
  );
}
