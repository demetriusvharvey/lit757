"use client";

import { useEffect } from "react";

const promptReplacements = new Map([
  ["Date night under $100", "Something fun in the next hour"],
  ["Live music tonight", "Family-friendly right now"],
  ["Something fun with kids", "Free outdoor things nearby"],
  ["Drinks then dancing", "Food or an event under $50"],
]);

export default function BuzzProductPositioning() {
  useEffect(() => {
    let scheduled = false;

    const apply = () => {
      scheduled = false;

      document.querySelectorAll<HTMLElement>(".buzz-mobile-brand span,.buzz-desktop-logo span")
        .forEach(node => { node.textContent = "THINGS TO DO NOW"; });

      const mobileHeadline = document.querySelector<HTMLElement>(".buzz-mobile-hero h1");
      if (mobileHeadline) mobileHeadline.innerHTML = "Find something worth doing <em>right now.</em>";

      const mobileDescription = document.querySelector<HTMLElement>(".buzz-mobile-hero>p");
      if (mobileDescription) {
        mobileDescription.textContent = "Events, food, activities, outdoors, shopping, family fun, and more—ranked for what you can do in this moment.";
      }

      const desktopDescription = document.querySelector<HTMLElement>(".buzz-desktop-hero>div>p");
      if (desktopDescription) {
        desktopDescription.textContent = "Buzz helps you discover events, food, activities, outdoors, shopping, family fun, and local experiences gaining momentum right now.";
      }

      const mapHint = document.querySelector<HTMLElement>(".buzz-map-explainer");
      if (mapHint) mapHint.lastChild && (mapHint.lastChild.textContent = " Tap a place · hotter colors mean more current activity");

      document.querySelectorAll<HTMLButtonElement>(".planner-prompts button").forEach(button => {
        const replacement = promptReplacements.get(button.textContent?.trim() || "");
        if (replacement) button.textContent = replacement;
      });
    };

    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      window.requestAnimationFrame(apply);
    };

    apply();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return null;
}
