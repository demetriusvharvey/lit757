"use client";

import { DISCOVERY_INTENTS, type IntentId } from "../../src/lib/buzz/product-intelligence";

export function IntentStrip({ value, onChange }: { value: IntentId; onChange: (value: IntentId) => void }) {
  return (
    <div className="no-scrollbar flex gap-2 overflow-x-auto py-1" aria-label="Discovery intent">
      {DISCOVERY_INTENTS.map(intent => (
        <button
          key={intent.id}
          type="button"
          onClick={() => onChange(intent.id)}
          title={intent.description}
          aria-pressed={value === intent.id}
          className={`shrink-0 rounded-full px-3.5 py-2 text-[11px] font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ff5c35] ${value === intent.id ? "bg-[#171716] text-white shadow-sm" : "border border-black/[0.08] bg-white/78 text-black/58 hover:border-black/20 hover:text-black/75"}`}
        >
          {intent.label}
        </button>
      ))}
    </div>
  );
}
