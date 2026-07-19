"use client";

import { useEffect } from "react";

const replacements: Array<[RegExp, string]> = [
  [/\bVery lit\b/gi, "On Fire"],
  [/\bLive Score\b/gi, "Buzz Score"],
  [/\bActivity Score\b/gi, "Buzz Score"],
  [/\b757 Points\b/gi, "Buzz Points"],
  [/\bSMART ALERTS\b/gi, "BUZZ ALERTS"],
  [/\bLIVE NOW\b/gi, "BUZZ NOW"],
  [/\bBest places right now\b/gi, "Trending by Buzz"],
  [/\bIs this place actually lit\?\b/gi, "How’s the Buzz here?"],
];

function replaceText(root: ParentNode) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    nodes.push(current as Text);
    current = walker.nextNode();
  }

  for (const node of nodes) {
    const parent = node.parentElement;
    if (!parent || parent.closest("script, style, textarea, input")) continue;
    let next = node.textContent || "";
    for (const [pattern, replacement] of replacements) next = next.replace(pattern, replacement);
    if (next !== node.textContent) node.textContent = next;
  }
}

function addBuzzLabels() {
  document.querySelectorAll<HTMLElement>(".feed-score").forEach(score => {
    if (score.dataset.buzzLabeled === "true") return;
    score.dataset.buzzLabeled = "true";
    score.setAttribute("aria-label", `Buzz Score ${score.textContent?.trim() || ""}`);
    const label = document.createElement("small");
    label.textContent = "BUZZ";
    label.style.display = "block";
    label.style.fontSize = "8px";
    label.style.lineHeight = "1";
    label.style.letterSpacing = ".08em";
    label.style.opacity = ".78";
    label.style.marginBottom = "2px";
    score.prepend(label);
  });

  document.querySelectorAll<HTMLElement>(".mobile-native-pulse").forEach(section => {
    if (section.querySelector("[data-buzz-brand]")) return;
    const badge = document.createElement("div");
    badge.dataset.buzzBrand = "true";
    badge.textContent = "WHAT’S THE BUZZ?";
    badge.style.marginTop = "10px";
    badge.style.fontSize = "11px";
    badge.style.fontWeight = "900";
    badge.style.letterSpacing = ".16em";
    badge.style.color = "#b78cff";
    section.appendChild(badge);
  });
}

export default function BuzzBrandEnhancer() {
  useEffect(() => {
    const apply = () => {
      replaceText(document.body);
      addBuzzLabels();
    };

    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, []);

  return null;
}
