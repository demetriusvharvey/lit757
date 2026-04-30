"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../src/lib/supabase";

type SuggestedEvent = {
  id: string;
  venue_id: string | null;
  venue_name: string;
  event_title: string;
  event_date: string | null;
  start_time: string | null;
  genre: string | null;
  dj: string | null;
  cover_price: string | null;
  age_limit: string | null;
  description: string | null;
  created_at: string | null;
};

export default function AdminPage() {
  const [authorized, setAuthorized] = useState(false);
  const [checkedAuth, setCheckedAuth] = useState(false);
  const [events, setEvents] = useState<SuggestedEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string>("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const key = params.get("key");
    setAuthorized(key === "lit757admin");
    setCheckedAuth(true);
  }, []);

  useEffect(() => {
    if (!checkedAuth || !authorized) return;

    async function load() {
      setLoading(true);
      const { data, error } = await supabase
        .from("suggested_events")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Failed to fetch suggested events", error);
        setEvents([]);
      } else {
        setEvents(data || []);
      }
      setLoading(false);
    }

    load();
  }, [checkedAuth, authorized]);

  async function approveEvent(eventItem: SuggestedEvent) {
    setActionLoading(eventItem.id);
    setFeedback("");

    const { error: insertError } = await supabase.from("events").insert({
      venue_id: eventItem.venue_id,
      title: eventItem.event_title,
      event_date: eventItem.event_date,
      start_time: eventItem.start_time,
      genre: eventItem.genre,
      dj: eventItem.dj,
      cover_price: eventItem.cover_price,
      description: eventItem.description,
    });

    if (insertError) {
      console.error("Approve insert error", insertError);
      setFeedback("Could not approve event. Try again.");
      setActionLoading(null);
      return;
    }

    const { error: deleteError } = await supabase
      .from("suggested_events")
      .delete()
      .eq("id", eventItem.id);

    if (deleteError) {
      console.error("Approve delete error", deleteError);
      setFeedback("Event approved, but cleanup failed. Refresh to confirm.");
      setActionLoading(null);
      return;
    }

    setFeedback(`Approved ${eventItem.event_title}`);
    setEvents((prev) => prev.filter((item) => item.id !== eventItem.id));
    setActionLoading(null);
  }

  async function rejectEvent(eventItem: SuggestedEvent) {
    setActionLoading(eventItem.id);
    setFeedback("");

    const { error } = await supabase
      .from("suggested_events")
      .delete()
      .eq("id", eventItem.id);

    if (error) {
      console.error("Reject delete error", error);
      setFeedback("Could not reject event. Try again.");
      setActionLoading(null);
      return;
    }

    setFeedback(`Rejected ${eventItem.event_title}`);
    setEvents((prev) => prev.filter((item) => item.id !== eventItem.id));
    setActionLoading(null);
  }

  if (!checkedAuth) {
    return (
      <main className="min-h-screen bg-slate-950 text-white">
        <div className="mx-auto max-w-2xl px-4 py-20 text-center sm:px-6">
          <p className="text-sm uppercase tracking-[0.3em] text-white/50">Loading admin guard…</p>
        </div>
      </main>
    );
  }

  if (!authorized) {
    return (
      <main className="min-h-screen bg-slate-950 text-white">
        <div className="mx-auto max-w-2xl px-4 py-20 text-center sm:px-6">
          <h1 className="text-3xl font-black">Unauthorized</h1>
          <p className="mt-3 text-sm text-white/60">
            Add <code className="rounded bg-white/10 px-2 py-1 text-xs">?key=lit757admin</code> to the URL.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8 flex flex-col gap-4 rounded-3xl border border-white/10 bg-white/5 p-6 shadow-2xl shadow-black/20 backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.3em] text-emerald-300/70">Admin Review</p>
            <h1 className="mt-2 text-3xl font-black">Suggested Events</h1>
            <p className="mt-2 max-w-2xl text-sm text-white/60">
              Review the latest user-submitted events and approve them into the real events table.
            </p>
          </div>
          <div className="rounded-3xl bg-slate-900/80 px-4 py-3 text-sm text-white/70 ring-1 ring-white/10">
            Review key: <span className="font-semibold text-white">lit757admin</span>
          </div>
        </div>

        {feedback && (
          <div className="mb-6 rounded-3xl border border-white/10 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
            {feedback}
          </div>
        )}

        {loading ? (
          <div className="rounded-3xl border border-white/10 bg-white/5 p-8 text-center text-sm text-white/60">
            Loading submissions…
          </div>
        ) : events.length === 0 ? (
          <div className="rounded-3xl border border-white/10 bg-white/5 p-8 text-center text-sm text-white/60">
            No suggested events available.
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-2">
            {events.map((eventItem) => (
              <article
                key={eventItem.id}
                className="overflow-hidden rounded-3xl border border-white/10 bg-white/5 p-5 shadow-xl shadow-black/10"
              >
                <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold uppercase tracking-[0.24em] text-white/60">
                      {eventItem.venue_name}
                    </p>
                    <h2 className="mt-2 text-xl font-black text-white">
                      {eventItem.event_title}
                    </h2>
                  </div>
                  <div className="text-right text-sm text-white/50">
                    <p>{eventItem.event_date || "No date"}</p>
                    <p>{eventItem.start_time || "No time"}</p>
                  </div>
                </div>

                <div className="mb-5 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-3xl bg-slate-900/80 p-4 text-sm text-white/70">
                    <p className="font-semibold text-white">Genre</p>
                    <p className="mt-1">{eventItem.genre || "Unknown"}</p>
                  </div>
                  <div className="rounded-3xl bg-slate-900/80 p-4 text-sm text-white/70">
                    <p className="font-semibold text-white">DJ</p>
                    <p className="mt-1">{eventItem.dj || "Unknown"}</p>
                  </div>
                  <div className="rounded-3xl bg-slate-900/80 p-4 text-sm text-white/70">
                    <p className="font-semibold text-white">Cover</p>
                    <p className="mt-1">{eventItem.cover_price || "Unknown"}</p>
                  </div>
                  <div className="rounded-3xl bg-slate-900/80 p-4 text-sm text-white/70">
                    <p className="font-semibold text-white">Age limit</p>
                    <p className="mt-1">{eventItem.age_limit || "Unknown"}</p>
                  </div>
                </div>

                <div className="mb-6 rounded-3xl bg-slate-900/80 p-4 text-sm leading-6 text-white/75">
                  <p className="font-semibold text-white">Description</p>
                  <p className="mt-2">{eventItem.description || "No description provided."}</p>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row">
                  <button
                    onClick={() => approveEvent(eventItem)}
                    disabled={actionLoading === eventItem.id}
                    className="inline-flex min-w-[120px] items-center justify-center rounded-3xl bg-emerald-400 px-4 py-3 text-sm font-bold text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {actionLoading === eventItem.id ? "Approving…" : "Approve"}
                  </button>
                  <button
                    onClick={() => rejectEvent(eventItem)}
                    disabled={actionLoading === eventItem.id}
                    className="inline-flex min-w-[120px] items-center justify-center rounded-3xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-bold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {actionLoading === eventItem.id ? "Rejecting…" : "Reject"}
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
