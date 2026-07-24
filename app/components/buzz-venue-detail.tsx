"use client";

import {
  Bell,
  Copy,
  Download,
  Heart,
  MapPin,
  MessageCircle,
  Navigation,
  Phone,
  Share2,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useId, useRef, type MouseEvent } from "react";
import type { ContextualVibe } from "../../src/lib/adaptive-discovery";
import { getVenueLogo } from "../../src/lib/venue-logo";
import {
  formatEventTime,
  milesLabel,
  todayHours,
  venueScore,
  venueStatus,
  venueTruthLabel,
  type BuzzVenue,
  type CrowdLevel,
  type VenueDetail,
} from "../buzz-map-model";
import { RemoteVenueImage } from "./remote-venue-image";

const crowdOptions: Array<{
  level: CrowdLevel;
  label: string;
  emoji: string;
}> = [
  { level: "quiet", label: "Quiet", emoji: "😌" },
  { level: "steady", label: "Steady", emoji: "🙂" },
  { level: "busy", label: "Busy", emoji: "🔥" },
  { level: "packed", label: "Packed", emoji: "🚨" },
];

type BuzzVenueDetailProps = {
  venue: BuzzVenue;
  detail: VenueDetail | null;
  vibe: ContextualVibe;
  favorite: boolean;
  watching: boolean;
  voting: boolean;
  sharing: boolean;
  voteMessage: string;
  shareMessage: string;
  watchMessage: string;
  onClose: () => void;
  onToggleFavorite: (
    event: MouseEvent<HTMLButtonElement>,
    venue: BuzzVenue,
  ) => void;
  onSubmitVote: (level: CrowdLevel) => Promise<void>;
  onShareWithCrew: (venue: BuzzVenue) => Promise<void>;
  onCopyInviteLink: (venue: BuzzVenue) => Promise<void>;
  onTextCrew: (venue: BuzzVenue) => void;
  onDownloadStoryCard: (venue: BuzzVenue) => Promise<void>;
  onToggleWatch: () => void;
};

/**
 * One responsive venue-detail surface is shared by the desktop side panel and
 * mobile bottom sheet. Keeping its actions together prevents the two layouts
 * from drifting as sharing, alerts, and crowd verification evolve.
 */
export function BuzzVenueDetail({
  venue,
  detail,
  vibe,
  favorite,
  watching,
  voting,
  sharing,
  voteMessage,
  shareMessage,
  watchMessage,
  onClose,
  onToggleFavorite,
  onSubmitVote,
  onShareWithCrew,
  onCopyInviteLink,
  onTextCrew,
  onDownloadStoryCard,
  onToggleWatch,
}: BuzzVenueDetailProps) {
  const titleId = useId();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const website = detail?.website || venue.website || null;
  const address = detail?.address || venue.address || null;
  const hours = todayHours(detail?.hours);
  const truthLabel = venueTruthLabel(venue).toUpperCase();

  useEffect(() => {
    const returnTarget =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    closeButtonRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", closeOnEscape);

    // Return keyboard users to the venue or map control that opened details.
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      if (returnTarget?.isConnected) returnTarget.focus();
    };
  }, [onClose]);

  return (
    <aside
      className="buzz-venue-detail"
      role="dialog"
      aria-labelledby={titleId}
    >
      <button
        ref={closeButtonRef}
        type="button"
        className="buzz-detail-close"
        onClick={onClose}
        aria-label="Close venue"
      >
        <X />
      </button>
      <div className="buzz-detail-photo">
        <RemoteVenueImage
          src={getVenueLogo({ name: venue.name, website })}
          alt={`${venue.name} logo`}
          fallback={venue.name.slice(0, 1)}
          width={640}
          height={360}
          sizes="(max-width: 1023px) 100vw, 420px"
          priority
        />
        <div><b>{venueScore(venue)}</b><small>BUZZ</small></div>
      </div>
      <div className="buzz-detail-body">
        <div className="buzz-detail-title">
          <div>
            <small>{venueStatus(venue).toUpperCase()} · {truthLabel}</small>
            <h2 id={titleId}>{venue.name}</h2>
            <p>
              <MapPin /> {milesLabel(venue.distanceMiles) || venue.city || "Nearby"}
              {venue.area?.shortName ? ` · ${venue.area.shortName}` : ""}
            </p>
          </div>
          <button
            type="button"
            className={favorite ? "saved" : ""}
            onClick={(event) => onToggleFavorite(event, venue)}
            aria-label={favorite ? `Remove ${venue.name} from saved places` : `Save ${venue.name}`}
          >
            <Heart fill={favorite ? "currentColor" : "none"} />
          </button>
        </div>

        <div className={`buzz-detail-vibe ${vibe.truth}`}>
          <span>{vibe.label}</span>
          <b>{vibe.truth === "live" ? "LIVE" : "FORECAST"}</b>
        </div>
        <div className="buzz-detail-reason">
          <Sparkles />
          <div>
            <strong>Why Buzz thinks this</strong>
            <p>{venue.reason || "Buzz is combining current activity signals for this place."}</p>
          </div>
        </div>
        <div className="buzz-truth-note">
          <ShieldCheck />
          <div>
            <strong>What this score can prove</strong>
            <p>Buzz creates a useful forecast from hours, events, ticket demand, traffic patterns, provider data, and nearby phones. Exact physical occupancy still requires ticket scans, POS activity, door counters, or another direct venue feed.</p>
          </div>
        </div>

        <div className="buzz-detail-facts">
          <div><small>HOURS</small><strong>{hours}</strong></div>
          {venue.event?.name && (
            <div>
              <small>EVENT</small>
              <strong>{venue.event.name}</strong>
              <span>{formatEventTime(venue.event.startTime)}</span>
            </div>
          )}
          {address && <div><small>ADDRESS</small><strong>{address}</strong></div>}
        </div>

        <section className="buzz-vote-card">
          <header>
            <div>
              <small>OPTIONAL VERIFICATION</small>
              <strong>How crowded is it?</strong>
              <p>Buzz works without votes. Nearby votes verify and calibrate it faster.</p>
            </div>
            <em>+10 Buzz Points</em>
          </header>
          <div>
            {crowdOptions.map((option) => (
              <button
                type="button"
                key={option.level}
                disabled={voting}
                onClick={() => void onSubmitVote(option.level)}
              >
                <span>{option.emoji}</span>{option.label}
              </button>
            ))}
          </div>
          {voteMessage && (
            <p aria-live="polite">{voting && <i />}{voteMessage}</p>
          )}
        </section>

        <section className="buzz-invite-card">
          <header>
            <div>
              <small>FOMO MODE</small>
              <strong>Bring the crew</strong>
              <p>Share this venue’s surge—not your location—with one tap.</p>
            </div>
            <Share2 />
          </header>
          <button
            type="button"
            className="buzz-invite-primary"
            disabled={sharing}
            onClick={() => void onShareWithCrew(venue)}
          >
            <Share2 />{sharing ? "Building the Story card…" : "Invite the Crew"}
          </button>
          <div>
            <button type="button" onClick={() => void onCopyInviteLink(venue)}>
              <Copy />Copy link
            </button>
            <button type="button" onClick={() => onTextCrew(venue)}>
              <MessageCircle />Text crew
            </button>
            <button
              type="button"
              disabled={sharing}
              onClick={() => void onDownloadStoryCard(venue)}
            >
              <Download />Save Story
            </button>
          </div>
          {shareMessage && <p aria-live="polite">{shareMessage}</p>}
        </section>

        <div className="buzz-detail-actions">
          <button
            type="button"
            className={watching ? "watching" : ""}
            onClick={onToggleWatch}
          >
            <Bell />{watching ? "Watching" : "Watch this place"}
          </button>
          {address && (
            <a
              href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`}
              target="_blank"
              rel="noreferrer"
            >
              <Navigation />Directions
            </a>
          )}
          {detail?.phone && <a href={`tel:${detail.phone}`}><Phone />Call</a>}
          {website && (
            <a href={website} target="_blank" rel="noreferrer">
              <span>↗</span>Website
            </a>
          )}
        </div>
        {watchMessage && (
          <p className="buzz-watch-message" aria-live="polite">{watchMessage}</p>
        )}
      </div>
    </aside>
  );
}
