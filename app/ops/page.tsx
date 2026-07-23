"use client";

import { useEffect, useState } from "react";
import { Activity, AlertTriangle, CheckCircle2, Clock3, Radio, RefreshCw, ShieldCheck } from "lucide-react";

type Payload = {
  success: boolean;
  generatedAt: string;
  metrics: { coveragePct: number; livePct: number; highConfidencePct: number; arrivalCoveragePct: number; unknownCount: number; manipulationRiskCount: number };
  pulse: { headline: string; changes: string[]; risingAreas: string[]; coolingAreas: string[] };
  venues: Array<{ id: string; name: string; city: string; activity: { state: string; trend: string; truthMode: string; confidence: string; freshnessLabel: string }; trust: { signalCount: number; directCount: number; verifiedCount: number; manipulationRisk: string } }>;
};

export default function OpsPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  async function load() {
    setLoading(true);
    const response = await fetch("/api/live?intent=best_now&horizon=now", { cache: "no-store" });
    const payload = await response.json().catch(() => null) as Payload | null;
    if (!response.ok || !payload?.success) setError("Could not load truth operations.");
    else { setData(payload); setError(""); }
    setLoading(false);
  }
  useEffect(() => { void load(); const interval = window.setInterval(() => void load(), 120000); return () => window.clearInterval(interval); }, []);
  const metricCards = data ? [
    { label: "Known coverage", value: `${data.metrics.coveragePct}%`, icon: CheckCircle2 },
    { label: "Fresh live evidence", value: `${data.metrics.livePct}%`, icon: Radio },
    { label: "High confidence", value: `${data.metrics.highConfidencePct}%`, icon: ShieldCheck },
    { label: "Arrival coverage", value: `${data.metrics.arrivalCoveragePct}%`, icon: Clock3 },
    { label: "Unknown venues", value: data.metrics.unknownCount, icon: AlertTriangle },
    { label: "Risk flags", value: data.metrics.manipulationRiskCount, icon: Activity },
  ] : [];
  return <main className="min-h-screen bg-[#0b0d11] px-4 py-8 text-white">
    <div className="mx-auto max-w-7xl">
      <header className="flex flex-wrap items-center justify-between gap-4"><div><p className="text-[10px] font-bold uppercase tracking-[.18em] text-[#ff8061]">Internal operations</p><h1 className="mt-2 text-3xl font-semibold tracking-[-.05em]">Buzz Truth Control</h1><p className="mt-2 text-sm text-white/45">Coverage, freshness, confidence, arrival intelligence, and manipulation risk.</p></div><button type="button" onClick={() => void load()} className="flex h-11 items-center gap-2 rounded-full bg-white/10 px-4 text-xs font-semibold"><RefreshCw size={14} className={loading ? "animate-spin" : ""} />Refresh</button></header>
      {error && <p className="mt-5 rounded-2xl bg-red-500/10 p-4 text-sm text-red-200">{error}</p>}
      <section className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{metricCards.map(card => <div key={card.label} className="rounded-[1.4rem] border border-white/8 bg-white/[.045] p-5"><card.icon size={17} className="text-[#ff8061]" /><p className="mt-5 text-3xl font-semibold">{card.value}</p><p className="mt-1 text-[10px] uppercase tracking-[.14em] text-white/38">{card.label}</p></div>)}</section>
      <section className="mt-6 rounded-[1.6rem] border border-white/8 bg-white/[.045] p-5"><p className="text-[10px] font-bold uppercase tracking-[.15em] text-[#ff8061]">City pulse</p><h2 className="mt-2 text-xl font-semibold">{data?.pulse.headline || "Loading…"}</h2><div className="mt-4 grid gap-2 text-xs text-white/48 sm:grid-cols-2">{data?.pulse.changes.map(change => <p key={change}>• {change}</p>)}</div></section>
      <section className="mt-6 overflow-hidden rounded-[1.6rem] border border-white/8 bg-white/[.045]"><div className="border-b border-white/8 p-5"><h2 className="text-lg font-semibold">Venue truth queue</h2><p className="mt-1 text-xs text-white/38">Unknown, low-confidence, stale, and suspicious venues rise to the top.</p></div><div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-xs"><thead className="text-white/35"><tr>{["Venue","State","Truth","Freshness","Confidence","Signals","Direct","Verified","Risk"].map(label => <th key={label} className="px-4 py-3 font-medium">{label}</th>)}</tr></thead><tbody>{[...(data?.venues || [])].sort((a,b) => Number(b.trust.manipulationRisk !== "low") - Number(a.trust.manipulationRisk !== "low") || Number(a.activity.truthMode === "insufficient") - Number(b.activity.truthMode === "insufficient")).map(venue => <tr key={venue.id} className="border-t border-white/6"><td className="px-4 py-3"><p className="font-semibold">{venue.name}</p><p className="text-[10px] text-white/30">{venue.city}</p></td><td className="px-4 py-3">{venue.activity.state} · {venue.activity.trend}</td><td className="px-4 py-3">{venue.activity.truthMode}</td><td className="px-4 py-3 text-white/50">{venue.activity.freshnessLabel}</td><td className="px-4 py-3">{venue.activity.confidence}</td><td className="px-4 py-3">{venue.trust.signalCount}</td><td className="px-4 py-3">{venue.trust.directCount}</td><td className="px-4 py-3">{venue.trust.verifiedCount}</td><td className={`px-4 py-3 font-semibold ${venue.trust.manipulationRisk === "low" ? "text-emerald-300" : "text-orange-300"}`}>{venue.trust.manipulationRisk}</td></tr>)}</tbody></table></div></section>
    </div>
  </main>;
}
