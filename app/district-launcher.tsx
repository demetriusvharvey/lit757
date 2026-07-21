"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronRight, MapPinned, Radio } from "lucide-react";
import "./district-launcher.css";

type TopDistrict = {
  id: string;
  shortName: string;
  score: number;
  label: string;
  mode: "live" | "forecast";
  arrivalLabel: string;
  accent: string;
};

export default function DistrictLauncher() {
  const pathname = usePathname();
  const [district, setDistrict] = useState<TopDistrict | null>(null);

  useEffect(() => {
    if (pathname !== "/") return;
    let active = true;
    const load = async () => {
      try {
        const response = await fetch("/api/districts", { cache: "no-store" });
        const payload = await response.json() as { summary?: { topDistrict?: TopDistrict | null } };
        if (active) setDistrict(payload.summary?.topDistrict || null);
      } catch {
        if (active) setDistrict(null);
      }
    };
    void load();
    const interval = window.setInterval(load, 5 * 60 * 1000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [pathname]);

  if (pathname !== "/") return null;

  return (
    <Link
      href={district ? `/districts?district=${encodeURIComponent(district.id)}` : "/districts"}
      className="district-launcher"
      style={{ "--district-launcher-accent": district?.accent || "#ff6738" } as React.CSSProperties}
      aria-label="Open Hampton Roads district activity"
    >
      <span className="district-launcher-icon"><MapPinned /></span>
      <span className="district-launcher-copy">
        <small><Radio /> AREAS RIGHT NOW</small>
        <strong>{district?.shortName || "Explore districts"}</strong>
        <em>{district ? `${district.arrivalLabel} · ${district.mode}` : "See which part of the 757 is moving"}</em>
      </span>
      {district && <span className="district-launcher-score"><b>{district.score}</b><small>{district.label}</small></span>}
      <ChevronRight className="district-launcher-arrow" />
    </Link>
  );
}
