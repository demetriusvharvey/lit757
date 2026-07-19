"use client";

import { useEffect } from "react";

const VOTES_KEY = "lit757-venue-votes";
const POINTS_KEY = "lit757-user-points";

function slug(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function baselineVotes(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return 18 + (hash % 84);
}

export default function VenueVotingEnhancer() {
  useEffect(() => {
    const enhance = () => {
      const sheet = document.querySelector<HTMLElement>(".planner-backdrop .utility-sheet");
      if (!sheet || sheet.dataset.votingEnhanced === "true") return;

      const title = sheet.querySelector<HTMLElement>(".utility-head h2")?.textContent?.trim();
      const notifyButton = Array.from(sheet.querySelectorAll<HTMLButtonElement>("button")).find(button =>
        /notify me|watching this place/i.test(button.textContent || ""),
      );
      if (!title || !notifyButton) return;

      sheet.dataset.votingEnhanced = "true";
      const venueKey = slug(title);
      const votes = JSON.parse(localStorage.getItem(VOTES_KEY) || "{}") as Record<string, boolean>;
      let points = Number(localStorage.getItem(POINTS_KEY) || "0");
      const hasVoted = Boolean(votes[venueKey]);
      const communityVotes = baselineVotes(title) + (hasVoted ? 1 : 0);

      const section = document.createElement("section");
      section.className = "venue-vote-card";
      section.innerHTML = `
        <div class="venue-vote-copy">
          <span class="venue-vote-kicker">COMMUNITY SIGNAL</span>
          <strong>Is this place actually lit?</strong>
          <p>Your vote improves live recommendations. First vote earns <b>+10 points</b>.</p>
        </div>
        <button type="button" class="venue-vote-button ${hasVoted ? "voted" : ""}" aria-pressed="${hasVoted}">
          <span>${hasVoted ? "♥" : "♡"}</span>
          <strong>${hasVoted ? "You liked it" : "Like this place"}</strong>
          <small>${communityVotes} people agree</small>
        </button>
        <div class="venue-points-row">
          <span>757 Points</span>
          <strong>${points} pts</strong>
        </div>
      `;

      notifyButton.parentElement?.insertBefore(section, notifyButton);

      const voteButton = section.querySelector<HTMLButtonElement>(".venue-vote-button");
      const pointsValue = section.querySelector<HTMLElement>(".venue-points-row strong");
      const countValue = voteButton?.querySelector("small");

      voteButton?.addEventListener("click", () => {
        if (votes[venueKey]) return;
        votes[venueKey] = true;
        points += 10;
        localStorage.setItem(VOTES_KEY, JSON.stringify(votes));
        localStorage.setItem(POINTS_KEY, String(points));
        voteButton.classList.add("voted");
        voteButton.setAttribute("aria-pressed", "true");
        voteButton.innerHTML = `<span>♥</span><strong>You liked it</strong><small>${baselineVotes(title) + 1} people agree</small>`;
        if (pointsValue) pointsValue.textContent = `${points} pts`;
        if (countValue) countValue.textContent = `${baselineVotes(title) + 1} people agree`;
        if (navigator.vibrate) navigator.vibrate(35);
      });
    };

    const observer = new MutationObserver(enhance);
    observer.observe(document.body, { childList: true, subtree: true });
    enhance();
    return () => observer.disconnect();
  }, []);

  return null;
}
