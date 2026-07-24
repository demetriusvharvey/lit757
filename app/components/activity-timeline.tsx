"use client";

export type TimelineValue = "now" | "30m" | "60m" | "later" | "typical";

const OPTIONS: Array<{ id: TimelineValue; label: string }> = [
  { id: "now", label: "Now" },
  { id: "30m", label: "+30 min" },
  { id: "60m", label: "+1 hour" },
  { id: "later", label: "Later tonight" },
  { id: "typical", label: "Typical" },
];

export function ActivityTimeline({ value, onChange }: { value: TimelineValue; onChange: (value: TimelineValue) => void }) {
  return (
    <div className="rounded-[1.1rem] border border-black/[0.08] bg-white/82 p-1 shadow-sm backdrop-blur-xl" aria-label="Activity time horizon">
      <div className="no-scrollbar flex overflow-x-auto">
        {OPTIONS.map(option => (
          <button key={option.id} type="button" onClick={() => onChange(option.id)} aria-pressed={value === option.id} className={`shrink-0 rounded-[.8rem] px-3 py-2 text-[10px] font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ff5c35] ${value === option.id ? "bg-[#171716] text-white" : "text-black/48 hover:bg-black/[0.04] hover:text-black/72"}`}>
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
