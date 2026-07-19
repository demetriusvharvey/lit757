"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Activity, ArrowLeft, CalendarCheck, Users } from "lucide-react";
import { supabase } from "../../src/lib/supabase";

type Metrics = {
  users: { total: number; today: number; thisWeek: number };
  contributions: { thisWeek: number; uniqueContributors: number };
  events: { interested: number; going: number };
  topVenueIds: Array<{ venueId: string; reports: number }>;
};

export default function OwnerPage() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [message, setMessage] = useState("Loading owner dashboard…");

  useEffect(() => {
    void supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) {
        setMessage("Sign in with demetriusvharvey@gmail.com, then reopen this page.");
        return;
      }
      const response = await fetch("/api/admin/metrics", {
        cache: "no-store",
        headers: { Authorization: `Bearer ${data.session.access_token}` },
      });
      const payload = await response.json();
      if (!response.ok) {
        setMessage(payload.error || "Owner access required.");
        return;
      }
      setMetrics(payload);
      setMessage("");
    });
  }, []);

  const cards = metrics ? [
    ["Total members", metrics.users.total, `${metrics.users.today} joined today`, <Users key="u" size={18} />],
    ["New this week", metrics.users.thisWeek, "Verified account signups", <Activity key="n" size={18} />],
    ["Reports this week", metrics.contributions.thisWeek, `${metrics.contributions.uniqueContributors} contributors`, <Activity key="r" size={18} />],
    ["Going to events", metrics.events.going, `${metrics.events.interested} interested`, <CalendarCheck key="e" size={18} />],
  ] as const : [];

  return (
    <main className="min-h-screen bg-[#f7f5ef] px-5 py-8 text-[#171716] sm:px-8">
      <div className="mx-auto max-w-5xl">
        <Link href="/" className="inline-flex items-center gap-2 text-[13px] font-semibold text-black/55"><ArrowLeft size={16} /> Back to the map</Link>
        <p className="mt-10 text-[10px] font-bold uppercase tracking-[0.18em] text-[#d44b2b]">Private owner view</p>
        <h1 className="mt-2 text-[42px] font-semibold tracking-[-0.055em]">LIT757 growth</h1>
        <p className="mt-3 text-[14px] text-black/48">Members, contributions and event demand in one place.</p>
        {message && <div className="mt-8 rounded-[1.4rem] border border-black/[0.08] bg-white/70 p-5 text-[13px] text-black/55">{message}</div>}
        {metrics && <>
          <section className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {cards.map(([label, value, detail, icon]) => <article key={label} className="rounded-[1.5rem] border border-black/[0.07] bg-white/76 p-5">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black/[0.055] text-black/58">{icon}</span>
              <p className="mt-5 text-[10px] font-bold uppercase tracking-[0.14em] text-black/36">{label}</p>
              <p className="mt-1 text-[34px] font-semibold tracking-[-0.05em]">{value}</p>
              <p className="mt-2 text-[11px] text-black/42">{detail}</p>
            </article>)}
          </section>
          <section className="mt-6 rounded-[1.5rem] border border-black/[0.07] bg-white/76 p-5">
            <h2 className="text-[20px] font-semibold tracking-[-0.035em]">Most reported venues</h2>
            <div className="mt-4 space-y-2">
              {metrics.topVenueIds.length ? metrics.topVenueIds.map((item, index) => <div key={item.venueId} className="flex items-center justify-between rounded-[1rem] bg-black/[0.04] px-4 py-3 text-[12px]">
                <span className="font-medium text-black/65">#{index + 1} · {item.venueId}</span>
                <span className="font-semibold text-[#d44b2b]">{item.reports} reports</span>
              </div>) : <p className="text-[12px] text-black/40">No activity reports yet.</p>}
            </div>
          </section>
        </>}
      </div>
    </main>
  );
}
