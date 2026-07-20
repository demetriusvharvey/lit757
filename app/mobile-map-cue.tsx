"use client";

import { useEffect } from "react";

export default function MobileMapCue() {
  useEffect(() => {
    let destroyed = false;
    let cue: HTMLButtonElement | null = null;

    const install = () => {
      if (destroyed) return;
      const mapSection = document.querySelector<HTMLElement>(".mobile-native-map");
      const feed = document.querySelector<HTMLElement>(".mobile-native-feed");
      if (!mapSection || !feed) return void window.setTimeout(install, 120);

      cue = mapSection.querySelector<HTMLButtonElement>(".mobile-live-updates-cue");
      if (!cue) {
        cue = document.createElement("button");
        cue.type = "button";
        cue.className = "mobile-live-updates-cue";
        cue.innerHTML = "🔥 Live updates below <span aria-hidden=\"true\">↓</span>";
        cue.setAttribute("aria-label", "Scroll to live updates");
        cue.style.cssText = "position:absolute;left:50%;bottom:14px;z-index:9;transform:translateX(-50%);display:flex;align-items:center;gap:7px;height:38px;padding:0 14px;border:1px solid rgba(255,255,255,.16);border-radius:999px;background:rgba(7,10,14,.92);color:#fff;font:800 12px/1 Inter,Arial,sans-serif;box-shadow:0 10px 28px rgba(0,0,0,.42);backdrop-filter:blur(16px);white-space:nowrap;";
        mapSection.appendChild(cue);
      }

      cue.onclick = () => feed.scrollIntoView({ behavior: "smooth", block: "start" });
    };

    install();
    return () => {
      destroyed = true;
      cue?.remove();
    };
  }, []);

  return null;
}
