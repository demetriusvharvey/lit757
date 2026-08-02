"use client";

import { useEffect } from "react";
import { supabase } from "../src/lib/supabase";

const PUSH_STATUS_KEY = "lit757-push-status";

export default function NotificationTestButton() {
  useEffect(() => {
    let destroyed = false;
    let observer: MutationObserver | null = null;

    const install = () => {
      if (destroyed) return;
      const sheets = [...document.querySelectorAll<HTMLElement>(".utility-sheet")];
      const sheet = sheets.find(candidate => candidate.querySelector(".utility-head span")?.textContent?.includes("SMART ALERTS"));
      if (!sheet) return;

      let button = sheet.querySelector<HTMLButtonElement>(".notification-test-button");
      const ready = localStorage.getItem(PUSH_STATUS_KEY) === "ready";
      if (!ready) {
        button?.remove();
        return;
      }

      if (!button) {
        button = document.createElement("button");
        button.type = "button";
        button.className = "notification-test-button";
        button.textContent = "Send me a test alert";
        button.style.cssText = "width:100%;height:44px;margin-top:10px;border:1px solid rgba(255,255,255,.14);border-radius:14px;background:#151b24;color:#fff;font:800 11px/1 Inter,Arial,sans-serif;";
        button.onclick = async () => {
          const original = "Send me a test alert";
          button!.disabled = true;
          button!.textContent = "Sending test…";
          try {
            const { data } = await supabase.auth.getSession();
            if (!data.session) {
              window.dispatchEvent(new Event("lit757:open-notification-auth"));
              throw new Error("Sign in first.");
            }
            const response = await fetch("/api/notifications/test", {
              method: "POST",
              headers: { authorization: `Bearer ${data.session.access_token}` },
            });
            const payload = await response.json() as { sent?: number; error?: string };
            if (!response.ok || !payload.sent) throw new Error(payload.error || "No connected device was found.");
            button!.textContent = "✓ Test alert sent";
            window.setTimeout(() => {
              if (button) button.textContent = original;
            }, 3000);
          } catch (error) {
            button!.textContent = error instanceof Error ? error.message : "Could not send test";
            window.setTimeout(() => {
              if (button) button.textContent = original;
            }, 3000);
          } finally {
            button!.disabled = false;
          }
        };
        const signInButton = sheet.querySelector(".notification-sign-in-button");
        const status = sheet.querySelector(".push-runtime-status");
        (signInButton || status || sheet.querySelector(".alert-card"))?.insertAdjacentElement("afterend", button);
      }
    };

    observer = new MutationObserver(install);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("lit757:push-status", install);
    install();

    return () => {
      destroyed = true;
      observer?.disconnect();
      window.removeEventListener("lit757:push-status", install);
      document.querySelectorAll(".notification-test-button").forEach(node => node.remove());
    };
  }, []);

  return null;
}
