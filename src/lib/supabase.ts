import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function createBrowserSupabase(): SupabaseClient {
  if (!url || !anonKey) {
    throw new Error("Missing Supabase public environment variables");
  }

  return createClient(url, anonKey);
}

// Client components are still evaluated during Next.js prerendering. Creating the
// Supabase browser client at module scope can touch browser-only APIs, so expose a
// harmless server placeholder and create the real client only in the browser.
export const supabase: SupabaseClient =
  typeof window === "undefined"
    ? (new Proxy(
        {},
        {
          get() {
            throw new Error("Supabase browser client cannot be used during server rendering");
          },
        },
      ) as SupabaseClient)
    : createBrowserSupabase();
