"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { supabase } from "../../src/lib/supabase";

const OWNER_EMAIL = "demetriusvharvey@gmail.com";

export default function AdminLayout({ children }: { children: ReactNode }) {
  const [state, setState] = useState<"checking" | "allowed" | "denied">("checking");

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      const email = data.session?.user.email?.toLowerCase();
      setState(email === OWNER_EMAIL ? "allowed" : "denied");
    });
  }, []);

  if (state === "checking") {
    return <main className="min-h-screen bg-slate-950 p-8 text-white">Checking owner access…</main>;
  }

  if (state === "denied") {
    return (
      <main className="min-h-screen bg-slate-950 px-6 py-20 text-center text-white">
        <h1 className="text-3xl font-bold">Owner sign-in required</h1>
        <p className="mt-3 text-white/60">Sign in with {OWNER_EMAIL}. URL keys no longer grant access.</p>
        <Link href="/" className="mt-6 inline-flex rounded-full bg-white px-5 py-3 font-semibold text-black">Return to LIT757</Link>
      </main>
    );
  }

  return children;
}
