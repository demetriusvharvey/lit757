"use client";

import { useEffect } from "react";
import { supabase } from "../src/lib/supabase";

export default function AuthLifecycle() {
  useEffect(() => {
    const notify = async (accessToken?: string) => {
      if (!accessToken) return;
      try {
        await fetch("/api/auth/signup-notify", {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}` },
        });
      } catch {
        // Signup email retries the next time the member opens the app.
      }
    };

    void supabase.auth.getSession().then(({ data }) => notify(data.session?.access_token));
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      void notify(session?.access_token);
    });

    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    let stopped = false;

    const enhanceAccountEntry = () => {
      if (stopped) return;
      const emailInput = document.querySelector<HTMLInputElement>('input[placeholder="Email address"]');
      if (!emailInput) {
        window.setTimeout(enhanceAccountEntry, 250);
        return;
      }

      const form = emailInput.closest("form");
      const submit = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
      if (submit) submit.childNodes.forEach((node) => {
        if (node.nodeType === Node.TEXT_NODE) node.textContent = " Sign in with email";
      });

      if (document.getElementById("existing-member-signin")) return;
      const signIn = document.createElement("button");
      signIn.id = "existing-member-signin";
      signIn.type = "button";
      signIn.textContent = "Already have an account? Sign in";
      signIn.className = "mt-3 flex h-11 w-full items-center justify-center rounded-full border border-black/10 bg-white text-[12px] font-semibold text-black/65";
      signIn.onclick = () => {
        emailInput.focus();
        emailInput.scrollIntoView({ behavior: "smooth", block: "center" });
      };
      form?.insertAdjacentElement("afterend", signIn);
    };

    enhanceAccountEntry();
    const observer = new MutationObserver(enhanceAccountEntry);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      stopped = true;
      observer.disconnect();
      document.getElementById("existing-member-signin")?.remove();
    };
  }, []);

  return null;
}
