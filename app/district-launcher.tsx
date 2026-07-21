"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createPortal } from "react-dom";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CalendarDays, CarFront, ChevronRight, MapPin, MapPinned, Radio, ShieldCheck, UsersRound } from "lucide-react";
import "./district-launcher.css";

type DistrictVenue = {
  id: string;
  name: string;
  score: number;
  distanceMiles: number;
};

type District = {
  id: string;
  name: string;
  shortName: string;
  city: string;
  score: number;
  label: string;
  mode: "live" | "forecast";
  confidence: "low" | "medium" | "high";
  arrivalLabel: string;
  arrivalPressure: number;
  eventCountNext24Hours: number;
  liveSignalCount: number;
  reason: string;
  accent: string;
  center: { lat: number; lng: number };
  topVenues: DistrictVenue[];
};

type DistrictPayload = {
  success?: boolean;
  summary?: { topDistrict?: District | null };
  districts?: District[];
};

const MAP_BOUNDS = { west: -76.72, east: -75.86, north: 37.17, south: 36.53 };

function mapPosition(district: District) {
  const left = ((district.center.lng - MAP_BOUNDS.west) / (MAP_BOUNDS.east - MAP_BOUNDS.west)) * 100;
  const top = ((MAP_BOUNDS.north - district.center.lat) / (MAP_BOUNDS.north - MAP_BOUNDS.south)) * 100;
  return {
    left: `${Math.max(9, Math.min(92, left))}%`,
    top: `${Math.max(13, Math.min(88, top))}%`,
  };
}

export default function DistrictLauncher() {
  const pathname = usePathname();
  const [districts, setDistricts] = useState<District[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [portalTarget, setPortalTarget] = useState<Element | null>(null);

  useEffect(() => {
    if (pathname !== "/") return;
    let active = true;
    const load = async () => {
      try {
        const response = await fetch("/api/districts", { cache: "no-store" });
        const payload = await response.json() as DistrictPayload;
        if (!active) return;
        const next = payload.districts || [];
        setDistricts(next);
        setSelectedId(current => current || payload.summary?.topDistrict?.id || next[0]?.id || null);
      } catch {
        if (active) setDistricts([]);
      }
    };
    void load();
    const interval = window.setInterval(load, 5 * 60 * 1000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [pathname]);

  useEffect(() => {
    if (pathname !== "/") return;
    const findTarget = () => setPortalTarget(document.querySelector(".buzz-desktop-map-wrap"));
    findTarget();
    const observer = new MutationObserver(findTarget);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [pathname]);

  useEffect(() => {
    const target = portalTarget as HTMLElement | null;
    if (!target) return;
    target.classList.toggle("district-overlay-open", open);
    return () => target.classList.remove("district-overlay-open");
  }, [open, portalTarget]);

  useEffect(() => {
    const showAreas = (event: Event) => {
      const districtId = (event as CustomEvent<{ districtId?: string }>).detail?.districtId;
      if (districtId) setSelectedId(districtId);
      setOpen(true);
      portalTarget?.scrollIntoView({ behavior: "smooth", block: "center" });
    };
    window.addEventListener("buzz:show-districts", showAreas);
    return () => window.removeEventListener("buzz:show-districts", showAreas);
  }, [portalTarget]);

  const topDistrict = districts[0] || null;
  const selected = useMemo(
    () => districts.find(district => district.id === selectedId) || topDistrict,
    [districts, selectedId, topDistrict],
  );

  if (pathname !== "/") return null;

  function openAreas() {
    if (!window.matchMedia("(min-width:1024px)").matches || !portalTarget) {
      window.location.assign(topDistrict ? `/districts?district=${encodeURIComponent(topDistrict.id)}` : "/districts");
      return;
    }
    setSelectedId(current => current || topDistrict?.id || null);
    setOpen(true);
    portalTarget.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  const overlay = portalTarget && open && selected ? createPortal(
    <section className="integrated-area-layer" aria-label="Hampton Roads district activity">
      <div className="integrated-area-toolbar">
        <button type="button" onClick={() => setOpen(false)}><ArrowLeft /> Places</button>
        <span><Radio /> AREAS MODE</span>
        <small>Traffic + events + verified crowd evidence</small>
      </div>

      <div className="integrated-area-rankings">
        <div className="integrated-area-heading">
          <div><span>RIGHT NOW</span><strong>Activity by area</strong></div>
          <small>{districts.length} districts</small>
        </div>
        <div className="integrated-area-scroll">
          {districts.map((district, index) => (
            <button
              type="button"
              key={district.id}
              className={district.id === selected.id ? "selected" : ""}
              onClick={() => setSelectedId(district.id)}
              style={{ borderLeftColor: district.accent }}
            >
              <em>{String(index + 1).padStart(2, "0")}</em>
              <span><strong>{district.shortName}</strong><small>{district.arrivalLabel} · {district.eventCountNext24Hours} events</small></span>
              <b>{district.score}<small>{district.label}</small></b>
            </button>
          ))}
        </div>
      </div>

      <div className="integrated-area-map-copy"><MapPinned /> Click an area to inspect it</div>
      {districts.map(district => {
        const position = mapPosition(district);
        return (
          <button
            type="button"
            key={district.id}
            className={`integrated-area-marker ${district.id === selected.id ? "selected" : ""}`}
            style={{ left: position.left, top: position.top, "--area-accent": district.accent } as React.CSSProperties}
            onClick={() => setSelectedId(district.id)}
            aria-label={`Inspect ${district.name}`}
          >
            <i /><b>{district.score}</b><span>{district.shortName}</span>
          </button>
        );
      })}

      <aside className="integrated-area-detail" style={{ "--area-accent": selected.accent } as React.CSSProperties}>
        <div className="integrated-area-detail-head">
          <div><span>{selected.mode} · {selected.confidence} confidence</span><h3>{selected.shortName}</h3><p>{selected.reason}</p></div>
          <b>{selected.score}<small>AREA SCORE</small></b>
        </div>
        <div className="integrated-area-metrics">
          <span><CarFront /><b>{selected.arrivalPressure}</b><small>Arrivals</small></span>
          <span><CalendarDays /><b>{selected.eventCountNext24Hours}</b><small>Events</small></span>
          <span><UsersRound /><b>{selected.liveSignalCount}</b><small>Live signals</small></span>
        </div>
        <div className="integrated-area-venues">
          <strong>TOP PLACES</strong>
          {selected.topVenues.slice(0, 3).map(venue => <span key={venue.id}><i>{venue.name.slice(0, 1)}</i><b>{venue.name}</b><small>{venue.score}</small></span>)}
        </div>
        <div className="integrated-area-actions">
          <a href={`https://www.google.com/maps/dir/?api=1&destination=${selected.center.lat},${selected.center.lng}`} target="_blank" rel="noreferrer"><MapPin /> Directions</a>
          <Link href={`/districts?district=${encodeURIComponent(selected.id)}`}>Full analysis <ChevronRight /></Link>
        </div>
        <div className="integrated-area-truth"><ShieldCheck /> Road traffic supports the forecast; it does not prove a crowd is physically present.</div>
      </aside>
    </section>,
    portalTarget,
  ) : null;

  return (
    <>
      <button
        type="button"
        className="district-launcher"
        style={{ "--district-launcher-accent": topDistrict?.accent || "#ff6738" } as React.CSSProperties}
        aria-label="Show Hampton Roads district activity on the map"
        onClick={openAreas}
      >
        <span className="district-launcher-icon"><MapPinned /></span>
        <span className="district-launcher-copy">
          <small><Radio /> AREAS RIGHT NOW</small>
          <strong>{topDistrict?.shortName || "Explore districts"}</strong>
          <em>{topDistrict ? `${topDistrict.arrivalLabel} · ${topDistrict.mode}` : "See which part of the 757 is moving"}</em>
        </span>
        {topDistrict && <span className="district-launcher-score"><b>{topDistrict.score}</b><small>{topDistrict.label}</small></span>}
        <ChevronRight className="district-launcher-arrow" />
      </button>
      {overlay}
    </>
  );
}
