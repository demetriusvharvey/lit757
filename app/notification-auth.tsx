"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { ChevronLeft, LockKeyhole, Mail, Sparkles, X } from "lucide-react";
import "./notification-auth.css";

type Providers = { google?: boolean; apple?: boolean; email?: boolean };

export default function NotificationAuth() {
  const clientRef = useRef<SupabaseClient | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const [providers, setProviders] = useState<Providers>({ email: true });

  useEffect(() => {
    let destroyed = false;
    let observer: MutationObserver | null = null;
    let unsubscribe: (() => void) | null = null;

    const installSignInButton = () => {
      const sheets = [...document.querySelectorAll<HTMLElement>(".utility-sheet")];
      const sheet = sheets.find(candidate => candidate.querySelector(".utility-head span")?.textContent?.includes("SMART ALERTS"));
      if (!sheet) return;
      let button = sheet.querySelector<HTMLButtonElement>(".notification-sign-in-button");

      if (session) {
        button?.remove();
        return;
      }

      if (!button) {
        button = document.createElement("button");
        button.type = "button";
        button.className = "notification-sign-in-button";
        button.innerHTML = "<span>Sign in to activate alerts</span><b>Continue →</b>";
        button.onclick = () => setOpen(true);
        const status = sheet.querySelector(".push-runtime-status");
        (status || sheet.querySelector(".alert-card"))?.insertAdjacentElement("afterend", button);
      }
    };

    const boot = async () => {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!url || !key) return;

      const { createClient } = await import("@supabase/supabase-js");
      const client = createClient(url, key, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      });
      clientRef.current = client;

      const [{ data }, providerResponse] = await Promise.all([
        client.auth.getSession(),
        fetch("/api/auth/providers", { cache: "no-store" }).catch(() => null),
      ]);
      if (destroyed) return;
      setSession(data.session);
      if (providerResponse?.ok) setProviders(await providerResponse.json() as Providers);

      const listener = client.auth.onAuthStateChange((_event, nextSession) => {
        if (destroyed) return;
        setSession(nextSession);
        if (nextSession) {
          setOpen(false);
          setMessage("");
        }
      });
      unsubscribe = () => listener.data.subscription.unsubscribe();
    };

    const openHandler = () => setOpen(true);
    window.addEventListener("lit757:open-notification-auth", openHandler);
    observer = new MutationObserver(installSignInButton);
    observer.observe(document.body, { childList: true, subtree: true });
    installSignInButton();
    void boot();

    return () => {
      destroyed = true;
      observer?.disconnect();
      unsubscribe?.();
      window.removeEventListener("lit757:open-notification-auth", openHandler);
    };
  }, [session]);

  async function submitEmail(event: FormEvent) {
    event.preventDefault();
    const client = clientRef.current;
    if (!client || !email.trim()) return;
    setWorking(true);
    setMessage("");
    const { error } = await client.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin },
    });
    setMessage(error ? error.message : "Check your email. Your private sign-in link is on the way.");
    setWorking(false);
  }

  async function oauth(provider: "google" | "apple") {
    const client = clientRef.current;
    if (!client) return;
    setWorking(true);
    setMessage("");
    const { error } = await client.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin },
    });
    if (error) {
      setMessage(error.message);
      setWorking(false);
    }
  }

  if (!open || session) return null;

  return (
    <div className="notification-auth-backdrop" onClick={() => setOpen(false)}>
      <section className="notification-auth-sheet" onClick={event => event.stopPropagation()}>
        <div className="notification-auth-handle" />
        <header>
          <button type="button" aria-label="Close sign in" onClick={() => setOpen(false)}><X /></button>
          <span><LockKeyhole /></span>
          <div><small>PRIVATE ACCOUNT</small><h2>Save it. We’ll watch it.</h2><p>Sign in so your saved places and Buzz alerts follow you across devices.</p></div>
        </header>

        {(providers.google || providers.apple) && (
          <div className="notification-auth-providers">
            {providers.google && <button type="button" disabled={working} onClick={() => void oauth("google")}><Sparkles /> Continue with Google</button>}
            {providers.apple && <button type="button" disabled={working} onClick={() => void oauth("apple")}>Continue with Apple</button>}
          </div>
        )}

        {providers.email !== false && (
          <form onSubmit={submitEmail}>
            <label><Mail /><input type="email" required autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="Email address" /></label>
            <button type="submit" disabled={working || !email.trim()}>{working ? "Sending…" : "Email me a sign-in link"}</button>
          </form>
        )}

        {message && <p className="notification-auth-message">{message}</p>}
        <div className="notification-auth-note"><ChevronLeft /><p>On iPhone, add LIT757 to your Home Screen after signing in to receive push alerts when Safari is closed.</p></div>
      </section>
    </div>
  );
}
