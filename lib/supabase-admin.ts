import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { readSupabaseServerEnvironment } from "@/src/lib/server/env";

let adminClient: SupabaseClient | null = null;

/**
 * Returns one service-role client per server runtime. Centralizing creation
 * keeps auth settings consistent and makes the service key impossible to
 * accidentally copy into browser code.
 */
export function getSupabaseAdmin() {
  if (adminClient) return adminClient;

  const { url, serviceRoleKey } = readSupabaseServerEnvironment();
  adminClient = createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  return adminClient;
}

export function getSupabaseAdminIfConfigured() {
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  ) {
    return null;
  }
  return getSupabaseAdmin();
}

export async function requireAuthenticatedUser(request: Request): Promise<User> {
  const authorization = request.headers.get("authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";

  if (!token) {
    throw new Response("Unauthorized", { status: 401 });
  }

  const admin = getSupabaseAdmin();
  const { data, error } = await admin.auth.getUser(token);

  if (error || !data.user) {
    throw new Response("Unauthorized", { status: 401 });
  }

  return data.user;
}

export function jsonError(error: unknown, fallback = "Request failed") {
  if (error instanceof Response) return error;
  const message = error instanceof Error ? error.message : fallback;
  return Response.json({ error: message }, { status: 500 });
}
