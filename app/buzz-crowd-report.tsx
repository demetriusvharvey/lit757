"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { X } from "lucide-react";
import { useMapController } from "./map-controller";
import "./buzz-crowd-report.css";

type Venue = { id: string; name: string };
type DiscoveryPayload = { venues?: Venue[]; picks?: Venue[] };
type CrowdLevel = "quiet" | "steady" | "busy" | "packed";

const options: Array<{ level: CrowdLevel; label: string }> = [
  { level: "quiet", label: "Quiet" },
  { level: "steady", label: "Steady" },
  { level: "busy", label: "Busy" },
  { level: "packed", label: "Packed" },
];

export default function BuzzCrowdReport() {
  const { selectedVenueId } = useMapController();
  const clientRef = useRef<SupabaseClient | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [dismissedId, setDismissedId] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const [tone, setTone] = useState<"" | "success" | "error">("");

  const selected = useMemo(
    () => venues.find(venue => String(venue.id) === String(selectedVenueId)) || null,
    [venues, selectedVenueId],
  );

  useEffect(() => {
    let destroyed = false;
    let unsubscribe: (() => void) | null = null;
    const boot = async () => {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!url || !key) return;
      const { createClient } = await import("@supabase/supabase-js");
      const client = createClient(url, key, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      });
      clientRef.current = client;
      const { data } = await client.auth.getSession();
      if (!destroyed) setSession(data.session);
      const listener = client.auth.onAuthStateChange((_event, nextSession) => {
        if (!destroyed) setSession(nextSession);
      });
      unsubscribe = () => listener.data.subscription.unsubscribe();
    };
    void boot();
    return () => {
      destroyed = true;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    const receive = (event: Event) => {
      const payload = (event as CustomEvent<DiscoveryPayload>).detail;
      if (payload) setVenues(payload.venues || payload.picks || []);
    };
    window.addEventListener("activity757:discovery", receive);
    void fetch("/api/nearby?limit=400", { cache: "no-store" })
      .then(response => response.ok ? response.json() : null)
      .then((payload: DiscoveryPayload | null) => payload && setVenues(payload.venues || payload.picks || []))
      .catch(() => undefined);
    return () => window.removeEventListener("activity757:discovery", receive);
  }, []);

  useEffect(() => {
    setMessage("");
    setTone("");
  }, [selectedVenueId]);

  async function report(level: CrowdLevel) {
    if (!selected) return;
    if (!session) {
      window.dispatchEvent(new Event("lit757:open-notification-auth"));
      setMessage("Sign in first so reports stay trustworthy.");
      setTone("error");
      return;
    }
    if (!navigator.geolocation) {
      setMessage("Location verification is not available in this browser.");
      setTone("error");
      return;
    }

    setWorking(true);
    setMessage("Verifying that you’re nearby…");
    setTone("");
    navigator.geolocation.getCurrentPosition(async position => {
      try {
        const response = await fetch("/api/buzz/report", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            venueId: selected.id,
            crowdLevel: level,
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            gpsAccuracyMeters: position.coords.accuracy,
          }),
        });
        const payload = await response.json() as {
          error?: string;
          verifiedNearby?: boolean;
          reportCount?: number;
          buzz?: { score?: number; mode?: string; confidence?: string };
          message?: string;
        };
        if (!response.ok) throw new Error(payload.error || "Could not submit that report");
        if (!payload.verifiedNearby) {
          setMessage(payload.message || "Saved, but your location was not close enough to affect Buzz.");
          setTone("error");
        } else {
          const scoreText = payload.buzz?.score != null ? ` Buzz is now ${payload.buzz.score}.` : "";
          setMessage(`Verified. Thanks for making Buzz more accurate.${scoreText}`);
          setTone("success");
          window.setTimeout(() => setDismissedId(selected.id), 2600);
        }
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Could not submit that report");
        setTone("error");
      } finally {
        setWorking(false);
      }
    }, error => {
      setWorking(false);
      setTone("error");
      setMessage(error.code === error.PERMISSION_DENIED ? "Location permission is needed to verify a live report." : "We could not verify your location. Try again closer to the place.");
    }, { enableHighAccuracy: true, timeout: 15_000, maximumAge: 15_000 });
  }

  if (!selected || dismissedId === selected.id) return null;

  return (
    <aside className="buzz-crowd-report" aria-live="polite">
      <header>
        <div><small>VERIFY LIVE ACTIVITY</small><strong>How busy is {selected.name}?</strong><p>Only nearby reports affect the Buzz Score.</p></div>
        <button type="button" className="buzz-crowd-report-close" onClick={() => setDismissedId(selected.id)} aria-label="Dismiss crowd report"><X /></button>
      </header>
      <div className="buzz-crowd-options">
        {options.map(option => <button type="button" key={option.level} data-level={option.level} disabled={working} onClick={() => void report(option.level)}>{option.label}</button>)}
      </div>
      {message && <div className={`buzz-crowd-status ${tone}`}>{working && <i />}{message}</div>}
    </aside>
  );
}
