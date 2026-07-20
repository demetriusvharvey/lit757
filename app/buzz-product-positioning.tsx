"use client";

import { useEffect } from "react";

const BRAND_COPY = "THINGS TO DO NOW";
const MOBILE_HEADLINE = "Find something worth doing <em>right now.</em>";
const MOBILE_DESCRIPTION = "Events, food, activities, outdoors, shopping, family fun, and more—ranked for what you can do in this moment.";
const DESKTOP_DESCRIPTION = "Buzz helps you discover events, food, activities, outdoors, shopping, family fun, and local experiences gaining momentum right now.";
const MAP_HINT = " Tap a place · hotter colors mean more current activity";
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
        .forEach(node => {
          if (node.textContent !== BRAND_COPY) node.textContent = BRAND_COPY;
        });

      const mobileHeadline = document.querySelector<HTMLElement>(".buzz-mobile-hero h1");
      if (mobileHeadline && mobileHeadline.innerHTML !== MOBILE_HEADLINE) mobileHeadline.innerHTML = MOBILE_HEADLINE;

      const mobileDescription = document.querySelector<HTMLElement>(".buzz-mobile-hero>p");
      if (mobileDescription && mobileDescription.textContent !== MOBILE_DESCRIPTION) mobileDescription.textContent = MOBILE_DESCRIPTION;

      const desktopDescription = document.querySelector<HTMLElement>(".buzz-desktop-hero>div>p");
      if (desktopDescription && desktopDescription.textContent !== DESKTOP_DESCRIPTION) desktopDescription.textContent = DESKTOP_DESCRIPTION;

      const mapHint = document.querySelector<HTMLElement>(".buzz-map-explainer");
      if (mapHint?.lastChild && mapHint.lastChild.textContent !== MAP_HINT) mapHint.lastChild.textContent = MAP_HINT;

      document.querySelectorAll<HTMLButtonElement>(".planner-prompts button").forEach(button => {
        const replacement = promptReplacements.get(button.textContent?.trim() || "");
        if (replacement && button.textContent !== replacement) button.textContent = replacement;
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
