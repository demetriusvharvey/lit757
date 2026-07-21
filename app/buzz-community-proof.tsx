"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clock3, UsersRound } from "lucide-react";
import { useMapController } from "./map-controller";
import "./buzz-community-proof.css";

type Venue = { id: string; name: string };
type DiscoveryPayload = { venues?: Venue[]; picks?: Venue[] };
type CommunityPayload = {
  success?: boolean;
  community?: {
    verifiedReportCount: number;
    uniqueReporterCount: number;
    crowdLevel: string | null;
    crowdValue: number | null;
    consensus: number | null;
    latestObservedAt: string | null;
  };
  partner?: {
    occupancyBand?: string | null;
    occupancyPct?: number | null;
    waitMinutes?: number | null;
    reservationsStatus?: string | null;
    ticketsStatus?: string | null;
    verified?: boolean;
    observedAt?: string | null;
  } | null;
};

function timeAgo(value: string | null | undefined) {
  if (!value) return "No recent verification";
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 1) return "Updated just now";
  if (minutes === 1) return "Updated 1 minute ago";
  return `Updated ${minutes} minutes ago`;
}

export default function BuzzCommunityProof() {
  const { selectedVenueId } = useMapController();
  const [venues, setVenues] = useState<Venue[]>([]);
  const [payload, setPayload] = useState<CommunityPayload | null>(null);
  const [loading, setLoading] = useState(false);

  const selected = useMemo(
    () => venues.find(venue => String(venue.id) === String(selectedVenueId)) || null,
    [venues, selectedVenueId],
  );

  useEffect(() => {
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<DiscoveryPayload>).detail;
      if (detail) setVenues(detail.venues || detail.picks || []);
    };
    window.addEventListener("activity757:discovery", receive);
    void fetch("/api/nearby?limit=400", { cache: "no-store" })
      .then(response => response.ok ? response.json() : null)
      .then((detail: DiscoveryPayload | null) => detail && setVenues(detail.venues || detail.picks || []))
      .catch(() => undefined);
    return () => window.removeEventListener("activity757:discovery", receive);
  }, []);

  useEffect(() => {
    if (!selectedVenueId) {
      setPayload(null);
      return;
    }
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/buzz/community?venueId=${encodeURIComponent(selectedVenueId)}`, { cache: "no-store" });
        const next = await response.json() as CommunityPayload;
        if (!cancelled && response.ok) setPayload(next);
      } catch {
        if (!cancelled) setPayload(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    const refresh = (event: Event) => {
      const venueId = (event as CustomEvent<{ venueId?: string }>).detail?.venueId;
      if (!venueId || String(venueId) === String(selectedVenueId)) void load();
    };
    window.addEventListener("lit757:buzz-report-saved", refresh);
    const timer = window.setInterval(load, 60_000);
    return () => {
      cancelled = true;
      window.removeEventListener("lit757:buzz-report-saved", refresh);
      window.clearInterval(timer);
    };
  }, [selectedVenueId]);

  if (!selected || (!loading && !payload?.community && !payload?.partner)) return null;

  const community = payload?.community;
  const partner = payload?.partner;
  const hasReports = Boolean(community?.verifiedReportCount);
  const consensus = community?.consensus == null ? null : Math.round(community.consensus * 100);
  const liveLabel = partner?.occupancyBand || community?.crowdLevel || "Waiting for live reports";

  return (
    <aside className="buzz-community-proof" aria-live="polite">
      <header>
        <div><small>COMMUNITY PULSE</small><strong>{selected.name}</strong></div>
        {loading && <i aria-label="Refreshing community pulse" />}
      </header>
      <div className="buzz-community-main">
        <span><UsersRound /></span>
        <div><b>{liveLabel}</b><p>{hasReports ? `${community?.uniqueReporterCount} verified ${community?.uniqueReporterCount === 1 ? "person" : "people"} nearby` : "Be the first nearby person to verify it"}</p></div>
      </div>
      <div className="buzz-community-stats">
        <span><CheckCircle2 /> {hasReports ? `${community?.verifiedReportCount} recent report${community?.verifiedReportCount === 1 ? "" : "s"}` : "No verified reports yet"}</span>
        {consensus != null && community!.verifiedReportCount >= 2 && <span>{consensus}% agreement</span>}
        {partner?.verified && <span>Venue verified</span>}
      </div>
      <footer><Clock3 /> {timeAgo(community?.latestObservedAt || partner?.observedAt)}</footer>
    </aside>
  );
}
