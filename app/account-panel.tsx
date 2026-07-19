"use client";

import { FormEvent, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  ArrowLeft,
  Award,
  Bell,
  ChevronRight,
  Heart,
  LoaderCircle,
  LocateFixed,
  LogOut,
  Mail,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

export type AuthProviders = {
  google: boolean;
  apple: boolean;
  email: boolean;
};

export type SavedPlace = {
  id: string;
  name: string;
  city: string;
  type: string;
  photoUrl: string | null;
};

export type MemberPreferences = {
  alerts: boolean;
  presence: boolean;
};

type PointsSummary = {
  points: number;
  level: string;
  rewardsMessage: string;
};

const ACTIVITY_OPTIONS = [
  { id: "active", label: "It’s active" },
  { id: "packed", label: "It’s packed" },
  { id: "quiet", label: "It’s quiet" },
  { id: "line_short", label: "Short line" },
  { id: "line_long", label: "Long line" },
  { id: "parking_easy", label: "Easy parking" },
  { id: "parking_hard", label: "Parking is tough" },
];

function PreferenceToggle({
  enabled,
  onChange,
  label,
  detail,
  icon,
}: {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  label: string;
  detail: string;
  icon: ReactNode;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      onClick={() => onChange(!enabled)}
      className="flex w-full items-start gap-3 rounded-[1.35rem] border border-black/[0.07] bg-white/72 p-4 text-left transition hover:border-black/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ff5c35]"
    >
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-black/[0.055] text-black/58">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-semibold text-black/78">{label}</span>
        <span className="mt-1 block text-[11px] leading-[1.45] text-black/42">{detail}</span>
      </span>
      <span className={`mt-1 flex h-6 w-10 shrink-0 items-center rounded-full p-0.5 transition ${enabled ? "bg-[#ff5c35]" : "bg-black/12"}`}>
        <span className={`h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${enabled ? "translate-x-4" : "translate-x-0"}`} />
      </span>
    </button>
  );
}

export default function AccountPanel({
  session,
  providers,
  savedPlaces,
  preferences,
  message,
  onClose,
  onOAuth,
  onEmailSignIn,
  onSignOut,
  onSelectSaved,
  onAlertsChange,
  onPresenceChange,
}: {
  session: Session | null;
  providers: AuthProviders;
  savedPlaces: SavedPlace[];
  preferences: MemberPreferences;
  message: string;
  onClose: () => void;
  onOAuth: (provider: "google" | "apple") => Promise<void>;
  onEmailSignIn: (email: string) => Promise<void>;
  onSignOut: () => Promise<void>;
  onSelectSaved: (place: SavedPlace) => void;
  onAlertsChange: (enabled: boolean) => Promise<void>;
  onPresenceChange: (enabled: boolean) => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [working, setWorking] = useState(false);
  const [points, setPoints] = useState<PointsSummary | null>(null);
  const [reportingVenue, setReportingVenue] = useState<string | null>(null);
  const [reportMessage, setReportMessage] = useState("");

  useEffect(() => {
    if (!session) {
      setPoints(null);
      return;
    }
    void fetch("/api/me/points", {
      cache: "no-store",
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((payload: PointsSummary) => setPoints(payload))
      .catch(() => undefined);
  }, [session]);

  async function submitEmail(event: FormEvent) {
    event.preventDefault();
    if (!email.trim()) return;
    setWorking(true);
    try {
      await onEmailSignIn(email.trim());
    } finally {
      setWorking(false);
    }
  }

  async function reportActivity(venue: SavedPlace, status: string) {
    if (!session) return;
    setReportingVenue(venue.id);
    setReportMessage("");
    try {
      const response = await fetch("/api/contributions/activity", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          venueId: venue.id,
          status,
          verifiedNearby: preferences.presence,
        }),
      });
      const payload = await response.json();
      setReportMessage(payload.message || payload.error || "Update received.");
      if (response.ok) {
        const pointsResponse = await fetch("/api/me/points", {
          cache: "no-store",
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (pointsResponse.ok) setPoints(await pointsResponse.json());
      }
    } finally {
      setReportingVenue(null);
    }
  }

  const metadata = session?.user.user_metadata || {};
  const displayName = metadata.full_name || metadata.name || session?.user.email?.split("@")[0] || "Your account";
  const initial = String(displayName).trim().slice(0, 1).toUpperCase() || "Y";

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#f7f5ef]">
      <div className="flex h-[72px] shrink-0 items-center border-b border-black/[0.07] px-5 sm:px-6">
        <button type="button" onClick={onClose} className="inline-flex h-10 items-center gap-2 rounded-full px-2.5 text-[13px] font-semibold text-black/62 transition hover:bg-black/[0.05] hover:text-black focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ff5c35]">
          <ArrowLeft size={17} /> Back to picks
        </button>
      </div>

      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-5 pb-8 pt-6 sm:px-6">
        {!session ? (
          <>
            <div className="flex h-12 w-12 items-center justify-center rounded-[16px] bg-[#171716] text-white"><Heart size={19} /></div>
            <h2 className="mt-5 text-[34px] font-semibold leading-[0.98] tracking-[-0.055em]">Make it yours.</h2>
            <p className="mt-3 max-w-[350px] text-[13px] leading-5 text-black/48">Save places, report activity, earn Points, and get a quiet alert when something you like starts moving.</p>

            {(providers.google || providers.apple) && (
              <div className="mt-7 space-y-2">
                {providers.google && <button type="button" onClick={() => void onOAuth("google")} className="flex h-12 w-full items-center justify-center rounded-full border border-black/[0.1] bg-white text-[13px] font-semibold text-black/76 transition hover:border-black/22">Continue with Google</button>}
                {providers.apple && <button type="button" onClick={() => void onOAuth("apple")} className="flex h-12 w-full items-center justify-center rounded-full bg-[#171716] text-[13px] font-semibold text-white transition hover:bg-black">Continue with Apple</button>}
              </div>
            )}

            {providers.email && (
              <form onSubmit={submitEmail} className="mt-3 space-y-2">
                <label className="relative block">
                  <span className="sr-only">Email address</span>
                  <Mail size={15} className="pointer-events-none absolute left-4 top-[17px] text-black/32" />
                  <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email address" autoComplete="email" required className="h-12 w-full rounded-full border border-black/[0.09] bg-white/76 pl-10 pr-4 text-[13px] outline-none placeholder:text-black/30 focus:ring-2 focus:ring-[#ff5c35]" />
                </label>
                <button type="submit" disabled={working} className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-[#ff5c35] text-[13px] font-semibold text-white disabled:opacity-45">
                  {working && <LoaderCircle size={15} className="animate-spin" />} Continue with email
                </button>
              </form>
            )}

            {message && <p className="mt-3 text-center text-[11px] leading-5 text-black/48">{message}</p>}
            <div className="mt-7 flex items-start gap-3 rounded-[1.35rem] bg-black/[0.045] p-4">
              <ShieldCheck size={17} className="mt-0.5 shrink-0 text-black/42" />
              <p className="text-[11px] leading-[1.5] text-black/42">No public profile by default. Location-verified reports earn more Points and expire quickly.</p>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#171716] text-[17px] font-semibold text-white">{initial}</div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[18px] font-semibold tracking-[-0.035em] text-black/82">{displayName}</p>
                <p className="mt-0.5 truncate text-[11px] text-black/38">{session.user.email}</p>
              </div>
            </div>

            <div className="mt-6 rounded-[1.6rem] bg-[#171716] p-5 text-white shadow-[0_20px_55px_rgba(0,0,0,0.16)]">
              <div className="flex items-center justify-between">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10"><Award size={18} /></span>
                <span className="rounded-full bg-white/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-white/68">{points?.level || "New Member"}</span>
              </div>
              <p className="mt-5 text-[10px] font-bold uppercase tracking-[0.17em] text-[#ff8c70]">Your Points</p>
              <p className="mt-1 text-[38px] font-semibold leading-none tracking-[-0.055em]">{points?.points ?? 25}</p>
              <p className="mt-3 text-[11px] leading-5 text-white/52">{points?.rewardsMessage || "Earn Points now. Member rewards are coming."}</p>
            </div>

            <div className="mt-7">
              <div className="flex items-end justify-between">
                <div><p className="text-[10px] font-bold uppercase tracking-[0.17em] text-[#d44b2b]">Contribute</p><h3 className="mt-1 text-[22px] font-semibold tracking-[-0.045em]">Report what you see</h3></div>
                <span className="text-[11px] font-medium text-black/34">+3 to +10</span>
              </div>
              <p className="mt-2 text-[11px] leading-5 text-black/42">Choose a saved place and add a fresh activity update. Reports expire so the map stays current.</p>
              <div className="mt-3 space-y-3">
                {savedPlaces.length ? savedPlaces.slice(0, 4).map((place) => (
                  <div key={place.id} className="rounded-[1.35rem] border border-black/[0.07] bg-white/72 p-3">
                    <button type="button" onClick={() => onSelectSaved(place)} className="flex w-full items-center gap-3 text-left">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] bg-black/[0.055] text-[13px] font-semibold text-black/42">{place.name.slice(0, 1).toUpperCase()}</span>
                      <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-semibold text-black/76">{place.name}</span><span className="mt-0.5 block truncate text-[10px] text-black/38">{place.city} · {place.type}</span></span>
                      <ChevronRight size={15} className="text-black/28" />
                    </button>
                    <div className="no-scrollbar mt-3 flex gap-1.5 overflow-x-auto pb-0.5">
                      {ACTIVITY_OPTIONS.map((option) => (
                        <button key={option.id} type="button" disabled={reportingVenue === place.id} onClick={() => void reportActivity(place, option.id)} className="shrink-0 rounded-full bg-black/[0.055] px-3 py-2 text-[10px] font-semibold text-black/58 transition hover:bg-black/[0.1] disabled:opacity-40">{option.label}</button>
                      ))}
                    </div>
                  </div>
                )) : (
                  <div className="rounded-[1.25rem] border border-dashed border-black/[0.1] px-5 py-6 text-center"><p className="text-[12px] font-medium text-black/48">Save a place first.</p><p className="mt-1 text-[10px] text-black/32">Then you can report activity and earn Points.</p></div>
                )}
              </div>
              {reportMessage && <p className="mt-3 rounded-full bg-[#fff0e9] px-4 py-2 text-center text-[11px] font-semibold text-[#b43c22]">{reportMessage}</p>}
            </div>

            <div className="mt-7">
              <p className="text-[10px] font-bold uppercase tracking-[0.17em] text-black/36">Smart signals</p>
              <div className="mt-3 space-y-2">
                <PreferenceToggle enabled={preferences.alerts} onChange={(enabled) => void onAlertsChange(enabled)} label="Saved-place alerts" detail="Notify me when a saved place has verified activity or an event starting soon." icon={<Bell size={16} />} />
                <PreferenceToggle enabled={preferences.presence} onChange={(enabled) => void onPresenceChange(enabled)} label="Verify nearby activity" detail="When the app is open, privately verify a venue within 200m. Verified reports earn 10 Points." icon={<LocateFixed size={16} />} />
              </div>
              {message && <p className="mt-3 text-[11px] leading-5 text-black/44">{message}</p>}
            </div>

            <div className="mt-7 flex items-start gap-3 rounded-[1.35rem] bg-[#fff0e9] p-4">
              <Sparkles size={17} className="mt-0.5 shrink-0 text-[#d44b2b]" />
              <p className="text-[11px] leading-[1.5] text-black/48">Points reward useful, current information. Repeated or misleading reports can be removed and Points reversed.</p>
            </div>

            <button type="button" onClick={() => void onSignOut()} className="mt-7 inline-flex h-10 items-center gap-2 rounded-full px-3 text-[12px] font-semibold text-black/46 transition hover:bg-black/[0.05] hover:text-black/70"><LogOut size={15} /> Sign out</button>
          </>
        )}
      </div>
    </div>
  );
}
