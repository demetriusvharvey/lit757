"use client";

import { FormEvent, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  ArrowLeft,
  Bell,
  ChevronRight,
  Heart,
  LoaderCircle,
  LocateFixed,
  LogOut,
  Mail,
  Phone,
  ShieldCheck,
} from "lucide-react";

export type AuthProviders = {
  google: boolean;
  facebook: boolean;
  apple: boolean;
  phone: boolean;
  email: boolean;
};

type OAuthProvider = "google" | "facebook" | "apple";

function GoogleMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-[18px] w-[18px]">
      <path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.4-.18-2.07H12v3.91h5.38a4.6 4.6 0 0 1-2 3.02v2.54h3.24c1.9-1.75 2.98-4.32 2.98-7.4Z" />
      <path fill="#34A853" d="M12 22c2.7 0 4.97-.9 6.62-2.37l-3.24-2.54c-.9.6-2.05.96-3.38.96-2.61 0-4.82-1.76-5.61-4.13H3.04v2.62A10 10 0 0 0 12 22Z" />
      <path fill="#FBBC05" d="M6.39 13.92A6.02 6.02 0 0 1 6.08 12c0-.67.11-1.32.31-1.92V7.46H3.04A10 10 0 0 0 2 12c0 1.61.39 3.14 1.04 4.54l3.35-2.62Z" />
      <path fill="#EA4335" d="M12 5.95c1.47 0 2.79.5 3.83 1.5l2.87-2.88A9.64 9.64 0 0 0 12 2a10 10 0 0 0-8.96 5.46l3.35 2.62C7.18 7.71 9.39 5.95 12 5.95Z" />
    </svg>
  );
}

function FacebookMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-[19px] w-[19px]">
      <circle cx="12" cy="12" r="11" fill="#1877F2" />
      <path fill="#fff" d="M13.55 20v-7h2.34l.35-2.73h-2.69V8.53c0-.79.22-1.33 1.35-1.33h1.44V4.76a19.4 19.4 0 0 0-2.1-.11c-2.08 0-3.5 1.27-3.5 3.6v2.02H8.4V13h2.34v7h2.81Z" />
    </svg>
  );
}

function AppleMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-current">
      <path d="M17.05 12.54c-.02-2.26 1.84-3.36 1.93-3.41a4.14 4.14 0 0 0-3.26-1.76c-1.37-.14-2.7.82-3.4.82-.71 0-1.78-.8-2.94-.77a4.33 4.33 0 0 0-3.65 2.23c-1.58 2.74-.4 6.77 1.11 8.98.76 1.08 1.65 2.29 2.8 2.25 1.13-.05 1.55-.72 2.92-.72 1.35 0 1.75.72 2.93.69 1.21-.02 1.97-1.09 2.7-2.18a8.9 8.9 0 0 0 1.24-2.53 3.9 3.9 0 0 1-2.38-3.6Zm-2.22-6.62a4 4 0 0 0 .92-2.86 4.06 4.06 0 0 0-2.64 1.36 3.82 3.82 0 0 0-.95 2.75 3.35 3.35 0 0 0 2.67-1.25Z" />
    </svg>
  );
}

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
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-black/[0.055] text-black/58">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-semibold text-black/78">{label}</span>
        <span className="mt-1 block text-[11px] leading-[1.45] text-black/42">{detail}</span>
      </span>
      <span
        className={`mt-1 flex h-6 w-10 shrink-0 items-center rounded-full p-0.5 transition ${
          enabled ? "bg-[#ff5c35]" : "bg-black/12"
        }`}
      >
        <span
          className={`h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
            enabled ? "translate-x-4" : "translate-x-0"
          }`}
        />
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
  onPhoneSignIn,
  onPhoneVerify,
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
  onOAuth: (provider: OAuthProvider) => Promise<void>;
  onEmailSignIn: (email: string) => Promise<void>;
  onPhoneSignIn: (phone: string) => Promise<boolean>;
  onPhoneVerify: (phone: string, code: string) => Promise<boolean>;
  onSignOut: () => Promise<void>;
  onSelectSaved: (place: SavedPlace) => void;
  onAlertsChange: (enabled: boolean) => Promise<void>;
  onPresenceChange: (enabled: boolean) => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [authMode, setAuthMode] = useState<"email" | "phone">(providers.email ? "email" : "phone");
  const [emailWorking, setEmailWorking] = useState(false);
  const [phoneWorking, setPhoneWorking] = useState(false);
  const [oauthWorking, setOAuthWorking] = useState<OAuthProvider | null>(null);
  const [phoneSent, setPhoneSent] = useState(false);

  const socialAvailable = providers.google || providers.facebook || providers.apple;
  const directAvailable = providers.email || providers.phone;
  const activeMode = authMode === "phone" && providers.phone
    ? "phone"
    : providers.email
      ? "email"
      : "phone";

  async function submitEmail(event: FormEvent) {
    event.preventDefault();
    if (!email.trim()) return;
    setEmailWorking(true);
    try {
      await onEmailSignIn(email.trim());
    } finally {
      setEmailWorking(false);
    }
  }

  async function submitPhone(event: FormEvent) {
    event.preventDefault();
    if (!phone.trim()) return;
    setPhoneWorking(true);
    try {
      setPhoneSent(await onPhoneSignIn(phone.trim()));
    } finally {
      setPhoneWorking(false);
    }
  }

  async function submitCode(event: FormEvent) {
    event.preventDefault();
    if (!code.trim()) return;
    setPhoneWorking(true);
    try {
      await onPhoneVerify(phone.trim(), code.trim());
    } finally {
      setPhoneWorking(false);
    }
  }

  async function beginOAuth(provider: OAuthProvider) {
    setOAuthWorking(provider);
    try {
      await onOAuth(provider);
    } finally {
      setOAuthWorking(null);
    }
  }

  const metadata = session?.user.user_metadata || {};
  const identity = session?.user.email || session?.user.phone || "Private member";
  const phoneName = session?.user.phone ? `Member ${session.user.phone.slice(-4)}` : null;
  const displayName = metadata.full_name || metadata.name || session?.user.email?.split("@")[0] || phoneName || "Your account";
  const initial = String(displayName).trim().slice(0, 1).toUpperCase() || "Y";

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#f7f5ef]">
      <div className="flex h-[72px] shrink-0 items-center border-b border-black/[0.07] px-5 sm:px-6">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-10 items-center gap-2 rounded-full px-2.5 text-[13px] font-semibold text-black/62 transition hover:bg-black/[0.05] hover:text-black focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ff5c35]"
        >
          <ArrowLeft size={17} />
          Back to picks
        </button>
      </div>

      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-5 pb-8 pt-6 sm:px-6">
        {!session ? (
          <>
            <div className="flex h-12 w-12 items-center justify-center rounded-[16px] bg-[#171716] text-white">
              <Heart size={19} />
            </div>
            <h2 className="mt-5 text-[34px] font-semibold leading-[0.98] tracking-[-0.055em]">
              Make it yours.
            </h2>
            <p className="mt-3 max-w-[350px] text-[13px] leading-5 text-black/48">
              Save places, shape your picks, and get a quiet alert when something you like starts moving.
            </p>

            {socialAvailable && (
              <div className="mt-7 space-y-2">
                {providers.google && (
                  <button
                    type="button"
                    disabled={oauthWorking !== null}
                    onClick={() => void beginOAuth("google")}
                    className="relative flex h-12 w-full items-center justify-center rounded-full border border-black/[0.1] bg-white text-[13px] font-semibold text-black/76 transition hover:border-black/22 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ff5c35]"
                  >
                    <span className="absolute left-4"><GoogleMark /></span>
                    {oauthWorking === "google" && <LoaderCircle size={15} className="mr-2 animate-spin" />}
                    Continue with Google
                  </button>
                )}
                {providers.facebook && (
                  <button
                    type="button"
                    disabled={oauthWorking !== null}
                    onClick={() => void beginOAuth("facebook")}
                    className="relative flex h-12 w-full items-center justify-center rounded-full border border-black/[0.1] bg-white text-[13px] font-semibold text-black/76 transition hover:border-black/22 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ff5c35]"
                  >
                    <span className="absolute left-4"><FacebookMark /></span>
                    {oauthWorking === "facebook" && <LoaderCircle size={15} className="mr-2 animate-spin" />}
                    Continue with Facebook
                  </button>
                )}
                {providers.apple && (
                  <button
                    type="button"
                    disabled={oauthWorking !== null}
                    onClick={() => void beginOAuth("apple")}
                    className="relative flex h-12 w-full items-center justify-center rounded-full bg-[#171716] text-[13px] font-semibold text-white transition hover:bg-black disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ff5c35]"
                  >
                    <span className="absolute left-4"><AppleMark /></span>
                    {oauthWorking === "apple" && <LoaderCircle size={15} className="mr-2 animate-spin" />}
                    Continue with Apple
                  </button>
                )}
              </div>
            )}

            {socialAvailable && directAvailable && (
              <div className="my-5 flex items-center gap-3" aria-hidden="true">
                <span className="h-px flex-1 bg-black/[0.08]" />
                <span className="text-[9px] font-bold uppercase tracking-[0.16em] text-black/28">or continue with</span>
                <span className="h-px flex-1 bg-black/[0.08]" />
              </div>
            )}

            {providers.email && providers.phone && (
              <div className={`${socialAvailable ? "" : "mt-7"} grid grid-cols-2 rounded-full bg-black/[0.055] p-1`} role="tablist" aria-label="Sign-in method">
                {(["email", "phone"] as const).map((method) => (
                  <button
                    key={method}
                    type="button"
                    role="tab"
                    aria-selected={activeMode === method}
                    onClick={() => setAuthMode(method)}
                    className={`h-9 rounded-full text-[11px] font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ff5c35] ${activeMode === method ? "bg-white text-black shadow-sm" : "text-black/42 hover:text-black/66"}`}
                  >
                    {method === "email" ? "Email" : "Phone"}
                  </button>
                ))}
              </div>
            )}

            {activeMode === "email" && providers.email && (
              <form onSubmit={submitEmail} className={`${socialAvailable || providers.phone ? "mt-3" : "mt-7"} space-y-2`}>
                <label className="relative block">
                  <span className="sr-only">Email address</span>
                  <Mail size={15} className="pointer-events-none absolute left-4 top-[17px] text-black/32" />
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="Email address"
                    autoComplete="email"
                    required
                    className="h-12 w-full rounded-full border border-black/[0.09] bg-white/76 pl-10 pr-4 text-[13px] outline-none placeholder:text-black/30 focus:border-black/20 focus:ring-2 focus:ring-[#ff5c35]"
                  />
                </label>
                <button
                  type="submit"
                  disabled={emailWorking}
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-[#ff5c35] text-[13px] font-semibold text-white transition hover:bg-[#eb4f2b] disabled:opacity-45 focus:outline-none focus-visible:ring-2 focus-visible:ring-black"
                >
                  {emailWorking && <LoaderCircle size={15} className="animate-spin" />}
                  Send a sign-in link
                </button>
              </form>
            )}

            {activeMode === "phone" && providers.phone && !phoneSent && (
              <form onSubmit={submitPhone} className={`${socialAvailable || providers.email ? "mt-3" : "mt-7"} space-y-2`}>
                <label className="relative block">
                  <span className="sr-only">Mobile phone number</span>
                  <Phone size={15} className="pointer-events-none absolute left-4 top-[17px] text-black/32" />
                  <input
                    type="tel"
                    value={phone}
                    onChange={(event) => setPhone(event.target.value)}
                    placeholder="Mobile number"
                    autoComplete="tel"
                    required
                    className="h-12 w-full rounded-full border border-black/[0.09] bg-white/76 pl-10 pr-4 text-[13px] outline-none placeholder:text-black/30 focus:border-black/20 focus:ring-2 focus:ring-[#ff5c35]"
                  />
                </label>
                <button
                  type="submit"
                  disabled={phoneWorking}
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-[#ff5c35] text-[13px] font-semibold text-white transition hover:bg-[#eb4f2b] disabled:opacity-45 focus:outline-none focus-visible:ring-2 focus-visible:ring-black"
                >
                  {phoneWorking && <LoaderCircle size={15} className="animate-spin" />}
                  Text me a code
                </button>
              </form>
            )}

            {activeMode === "phone" && providers.phone && phoneSent && (
              <form onSubmit={submitCode} className="mt-3 space-y-2">
                <p className="px-2 text-center text-[11px] leading-5 text-black/46">Enter the six-digit code sent to {phone}.</p>
                <input
                  type="text"
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="000000"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  required
                  aria-label="Six-digit verification code"
                  className="h-12 w-full rounded-full border border-black/[0.09] bg-white/76 px-4 text-center text-[18px] font-semibold tracking-[0.28em] outline-none placeholder:text-black/20 focus:border-black/20 focus:ring-2 focus:ring-[#ff5c35]"
                />
                <button
                  type="submit"
                  disabled={phoneWorking || code.length !== 6}
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-[#ff5c35] text-[13px] font-semibold text-white transition hover:bg-[#eb4f2b] disabled:opacity-45 focus:outline-none focus-visible:ring-2 focus-visible:ring-black"
                >
                  {phoneWorking && <LoaderCircle size={15} className="animate-spin" />}
                  Verify and continue
                </button>
                <button
                  type="button"
                  onClick={() => { setPhoneSent(false); setCode(""); }}
                  className="h-9 w-full text-[11px] font-semibold text-black/42 transition hover:text-black/68 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ff5c35]"
                >
                  Use a different number
                </button>
              </form>
            )}

            {message && <p className="mt-3 text-center text-[11px] leading-5 text-black/48">{message}</p>}

            <div className="mt-7 flex items-start gap-3 rounded-[1.35rem] bg-black/[0.045] p-4">
              <ShieldCheck size={17} className="mt-0.5 shrink-0 text-black/42" />
              <p className="text-[11px] leading-[1.5] text-black/42">
                No public profile. Your saves personalize your decisions; they do not count as live crowd activity.
              </p>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#171716] text-[17px] font-semibold text-white">
                {initial}
              </div>
              <div className="min-w-0">
                <p className="truncate text-[18px] font-semibold tracking-[-0.035em] text-black/82">{displayName}</p>
                <p className="mt-0.5 truncate text-[11px] text-black/38">{identity}</p>
              </div>
            </div>

            <div className="mt-7">
              <div className="flex items-end justify-between">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.17em] text-[#d44b2b]">Your taste</p>
                  <h3 className="mt-1 text-[22px] font-semibold tracking-[-0.045em]">Saved places</h3>
                </div>
                <span className="text-[11px] font-medium text-black/34">{savedPlaces.length}</span>
              </div>

              <div className="mt-3 space-y-2">
                {savedPlaces.length ? savedPlaces.map((place) => (
                  <button
                    key={place.id}
                    type="button"
                    onClick={() => onSelectSaved(place)}
                    className="flex w-full items-center gap-3 rounded-[1.25rem] border border-black/[0.07] bg-white/72 p-3 text-left transition hover:border-black/16 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ff5c35]"
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] bg-black/[0.055] text-[13px] font-semibold text-black/42">
                      {place.name.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold text-black/76">{place.name}</span>
                      <span className="mt-0.5 block truncate text-[10px] text-black/38">{place.city} · {place.type}</span>
                    </span>
                    <ChevronRight size={15} className="text-black/28" />
                  </button>
                )) : (
                  <div className="rounded-[1.25rem] border border-dashed border-black/[0.1] px-5 py-6 text-center">
                    <p className="text-[12px] font-medium text-black/48">Open a place and tap the heart.</p>
                    <p className="mt-1 text-[10px] text-black/32">Your future picks will learn from it.</p>
                  </div>
                )}
              </div>
            </div>

            <div className="mt-7">
              <p className="text-[10px] font-bold uppercase tracking-[0.17em] text-black/36">Smart signals</p>
              <div className="mt-3 space-y-2">
                <PreferenceToggle
                  enabled={preferences.alerts}
                  onChange={(enabled) => void onAlertsChange(enabled)}
                  label="Saved-place alerts"
                  detail="Alert me when a saved place heats up or an event is starting—even when the app is closed."
                  icon={<Bell size={16} />}
                />
                <PreferenceToggle
                  enabled={preferences.presence}
                  onChange={(enabled) => void onPresenceChange(enabled)}
                  label="Verify nearby activity"
                  detail="When the app is open, privately verify a venue within 200m. Exact coordinates are never stored."
                  icon={<LocateFixed size={16} />}
                />
              </div>
              {message && <p className="mt-3 text-[11px] leading-5 text-black/44">{message}</p>}
            </div>

            <button
              type="button"
              onClick={() => void onSignOut()}
              className="mt-7 inline-flex h-10 items-center gap-2 rounded-full px-3 text-[12px] font-semibold text-black/46 transition hover:bg-black/[0.05] hover:text-black/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ff5c35]"
            >
              <LogOut size={15} /> Sign out
            </button>
          </>
        )}
      </div>
    </div>
  );
}
