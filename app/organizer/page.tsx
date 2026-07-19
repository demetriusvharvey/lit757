"use client";

import { useEffect, useState, type ComponentType } from "react";
import Link from "next/link";
import { Building2, CalendarPlus, TicketCheck } from "lucide-react";
import { supabase } from "../../src/lib/supabase";

type ActionCard = {
  icon: ComponentType<{ size?: number }>;
  title: string;
  detail: string;
};

const ACTIONS: ActionCard[] = [
  { icon: Building2, title: "Claim a venue", detail: "Request ownership verification." },
  { icon: CalendarPlus, title: "Create events", detail: "Publish dates, times and ticket links." },
  { icon: TicketCheck, title: "Update sales", detail: "Share verified capacity and tickets sold." },
];

export default function OrganizerPage() {
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setEmail(data.session?.user.email || null));
  }, []);

  return (
    <main className="min-h-screen bg-[#f7f5ef] px-5 py-10 text-[#171716]">
      <div className="mx-auto max-w-3xl">
        <Link href="/" className="text-sm font-semibold text-black/55">← Back to LIT757</Link>
        <p className="mt-10 text-[10px] font-bold uppercase tracking-[0.18em] text-[#d44b2b]">Organizer portal</p>
        <h1 className="mt-2 text-4xl font-semibold tracking-[-0.05em]">Manage your venue and events</h1>
        <p className="mt-3 text-sm leading-6 text-black/50">Claim a venue, publish events, update ticket momentum and keep guests informed.</p>

        {!email ? (
          <div className="mt-8 rounded-[1.5rem] border border-black/[0.08] bg-white/75 p-6">
            <h2 className="text-xl font-semibold">Sign in first</h2>
            <p className="mt-2 text-sm text-black/45">Use the account button on the main app, then return here.</p>
          </div>
        ) : (
          <div className="mt-8 grid gap-3 sm:grid-cols-3">
            {ACTIONS.map(({ icon: Icon, title, detail }) => (
              <article key={title} className="rounded-[1.5rem] border border-black/[0.08] bg-white/75 p-5">
                <Icon size={20} />
                <h2 className="mt-5 font-semibold">{title}</h2>
                <p className="mt-2 text-xs leading-5 text-black/45">{detail}</p>
                <button type="button" className="mt-5 rounded-full bg-[#171716] px-4 py-2.5 text-xs font-semibold text-white">Coming next</button>
              </article>
            ))}
          </div>
        )}

        <div className="mt-8 rounded-[1.5rem] bg-[#171716] p-6 text-white">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/50">Signed in as</p>
          <p className="mt-2 text-sm">{email || "Not signed in"}</p>
        </div>
      </div>
    </main>
  );
}
