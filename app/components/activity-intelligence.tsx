"use client";

import { Bell, CheckCircle2, Clock3, Navigation, Radio, ShieldCheck, TrendingDown, TrendingUp } from "lucide-react";
import type { ArrivalPrediction, UnifiedActivity } from "../../src/lib/buzz/product-intelligence";

function activityTone(activity: UnifiedActivity) {
  if (activity.state === "hot") return "border-[#ff9c82] bg-[#fff0e9] text-[#b9381d]";
  if (activity.state === "active") return "border-[#f0c961] bg-[#fff8da] text-[#7c5a00]";
  if (activity.state === "quiet") return "border-[#95d8be] bg-[#ecfbf5] text-[#14664e]";
  return "border-black/10 bg-white/70 text-black/55";
}

function truthLabel(mode: UnifiedActivity["truthMode"]) {
  if (mode === "live") return "Live evidence";
  if (mode === "recently_confirmed") return "Recently confirmed";
  if (mode === "predicted") return "Pattern-based prediction";
  return "Insufficient recent data";
}

export function ActivityTruthCard({ activity }: { activity: UnifiedActivity }) {
  const TrendIcon = activity.trend === "falling" ? TrendingDown : TrendingUp;
  return (
    <section className={`rounded-[1.45rem] border p-4 ${activityTone(activity)}`} aria-label="Current activity intelligence">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/75 shadow-sm">
          {activity.truthMode === "live" ? <Radio size={17} /> : activity.truthMode === "insufficient" ? <ShieldCheck size={17} /> : <Clock3 size={17} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[15px] font-semibold tracking-[-0.025em]">{activity.headline}</p>
            {activity.state !== "unknown" && (
              <span className="inline-flex items-center gap-1 rounded-full bg-white/70 px-2 py-1 text-[9px] font-bold uppercase tracking-[0.12em]">
                <TrendIcon size={10} /> {activity.trend}
              </span>
            )}
          </div>
          <p className="mt-1 text-[11px] font-medium opacity-70">{truthLabel(activity.truthMode)} · {activity.freshnessLabel} · {activity.confidence} confidence</p>
          <p className="mt-3 text-[12px] leading-5 opacity-80">{activity.reason}</p>
          {activity.sources.length > 0 && (
            <p className="mt-3 text-[10px] uppercase tracking-[0.12em] opacity-55">Signals: {activity.sources.slice(0, 4).join(" · ")}</p>
          )}
        </div>
      </div>
    </section>
  );
}

export function ArrivalCard({ arrival }: { arrival: ArrivalPrediction }) {
  return (
    <section className="rounded-[1.45rem] border border-black/[0.08] bg-[#171716] p-4 text-white shadow-[0_18px_45px_rgba(0,0,0,.15)]" aria-label="Expected activity when you arrive">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10"><Navigation size={17} /></span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#ff8c70]">When you arrive</p>
          <p className="mt-1 text-[16px] font-semibold tracking-[-0.03em]">{arrival.label}</p>
          <p className="mt-2 text-[11px] leading-5 text-white/58">{arrival.detail}</p>
        </div>
        {arrival.travelMinutes != null && <span className="rounded-full bg-white/10 px-3 py-1.5 text-[11px] font-semibold">{arrival.travelMinutes} min</span>}
      </div>
    </section>
  );
}

export function WatchButton({ active, onClick, label = "Watch this place" }: { active: boolean; onClick: () => void; label?: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className={`inline-flex h-11 items-center justify-center gap-2 rounded-full px-4 text-[12px] font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ff5c35] ${active ? "bg-[#171716] text-white" : "border border-black/10 bg-white/75 text-black/68 hover:border-black/25"}`}>
      {active ? <CheckCircle2 size={15} /> : <Bell size={15} />}{active ? "Watching" : label}
    </button>
  );
}
