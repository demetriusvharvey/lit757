"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export default function AuthChoiceEnhancer() {
  const [mount, setMount] = useState<HTMLElement | null>(null);
  const [mode, setMode] = useState<"signup" | "signin">("signup");

  useEffect(() => {
    const sync = () => {
      const emailInput = document.querySelector<HTMLInputElement>('input[type="email"][placeholder="Email address"]');
      const form = emailInput?.closest("form") as HTMLFormElement | null;
      if (!form) {
        setMount(null);
        return;
      }

      let host = form.parentElement?.querySelector<HTMLElement>("#lit-auth-choice");
      if (!host) {
        host = document.createElement("div");
        host.id = "lit-auth-choice";
        form.parentElement?.insertBefore(host, form);
      }
      setMount(host);

      const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
      if (submit && !submit.dataset.working) {
        submit.childNodes.forEach((node) => {
          if (node.nodeType === Node.TEXT_NODE) node.textContent = mode === "signin" ? " Sign in with email" : " Create account with email";
        });
      }
    };

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    const timer = window.setInterval(sync, 400);
    return () => {
      observer.disconnect();
      window.clearInterval(timer);
      document.getElementById("lit-auth-choice")?.remove();
    };
  }, [mode]);

  if (!mount) return null;

  return createPortal(
    <div className="mt-7">
      <div className="grid grid-cols-2 rounded-full bg-black/[0.055] p-1" role="tablist" aria-label="Account action">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "signup"}
          onClick={() => setMode("signup")}
          className={`h-10 rounded-full text-[12px] font-semibold transition ${mode === "signup" ? "bg-white text-black shadow-sm" : "text-black/45"}`}
        >
          Create account
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "signin"}
          onClick={() => setMode("signin")}
          className={`h-10 rounded-full text-[12px] font-semibold transition ${mode === "signin" ? "bg-white text-black shadow-sm" : "text-black/45"}`}
        >
          Sign in
        </button>
      </div>
      <p className="mt-3 text-center text-[11px] leading-5 text-black/42">
        {mode === "signin"
          ? "Welcome back. Enter the email attached to your account."
          : "Join free and get 25 Points after your first sign-in."}
      </p>
    </div>,
    mount
  );
}
