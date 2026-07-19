"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Flame } from "lucide-react";

const FILTERS = [
  { label: "All", query: "" },
  { label: "Nightlife", query: "nightlife clubs lounges" },
  { label: "Events", query: "events concerts shows" },
  { label: "Food", query: "food restaurants" },
  { label: "Drinks", query: "bars cocktails breweries wine" },
  { label: "Live Music", query: "live music concerts bands" },
  { label: "Activities", query: "activities fun entertainment" },
  { label: "Date Night", query: "date night romantic" },
  { label: "Family", query: "family kids all ages" },
  { label: "Outdoors", query: "outdoors beach parks trails" },
  { label: "Coffee", query: "coffee cafes bakeries" },
  { label: "Shopping", query: "shopping markets malls" },
] as const;

function setReactInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value"
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

export default function DiscoveryEnhancer() {
  const [mount, setMount] = useState<HTMLElement | null>(null);
  const [active, setActive] = useState("All");

  useEffect(() => {
    let cancelled = false;

    const attach = () => {
      if (cancelled) return;
      const original = document.querySelector<HTMLElement>(
        '[role="tablist"][aria-label="Discovery categories"]'
      );
      if (!original) {
        window.setTimeout(attach, 100);
        return;
      }

      original.style.display = "none";
      let host = document.getElementById("lit-category-rail");
      if (!host) {
        host = document.createElement("div");
        host.id = "lit-category-rail";
        original.insertAdjacentElement("beforebegin", host);
      }
      setMount(host);
    };

    attach();
    return () => {
      cancelled = true;
      document.getElementById("lit-category-rail")?.remove();
      const original = document.querySelector<HTMLElement>(
        '[role="tablist"][aria-label="Discovery categories"]'
      );
      if (original) original.style.display = "";
    };
  }, []);

  const applyFilter = (label: string, query: string) => {
    setActive(label);
    const originalAll = document.querySelector<HTMLButtonElement>(
      '[role="tablist"][aria-label="Discovery categories"] button'
    );
    originalAll?.click();

    const input = document.querySelector<HTMLInputElement>(
      'input[placeholder^="Try"]'
    );
    if (input) setReactInputValue(input, query);
  };

  if (!mount) return null;

  return createPortal(
    <div className="mt-2.5">
      <div className="mb-2 flex items-center justify-between px-0.5">
        <span className="inline-flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.16em] text-black/38">
          <Flame size={11} className="text-[#ff5c35]" fill="currentColor" />
          Ranked by activity
        </span>
        <span className="text-[9px] font-medium text-black/30">Swipe categories</span>
      </div>
      <div
        className="no-scrollbar flex gap-2 overflow-x-auto pb-1"
        role="tablist"
        aria-label="Business and event categories"
      >
        {FILTERS.map((filter) => {
          const selected = active === filter.label;
          return (
            <button
              key={filter.label}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => applyFilter(filter.label, filter.query)}
              className={`h-9 shrink-0 rounded-full px-4 text-[10px] font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ff5c35] ${
                selected
                  ? "bg-[#171716] text-white shadow-sm"
                  : "border border-black/[0.07] bg-white/70 text-black/55 hover:border-black/15 hover:text-black/75"
              }`}
            >
              {filter.label}
            </button>
          );
        })}
      </div>
    </div>,
    mount
  );
}
