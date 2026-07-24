import { NextResponse } from "next/server";

/**
 * Retired compatibility endpoint.
 *
 * The original implementation performed anonymous service-role writes with no
 * proximity proof. Current clients use /api/contributions/activity (signed-in
 * reports) or /api/presence (server-verified proximity) instead.
 */
export async function POST() {
  return NextResponse.json(
    {
      error: "This reporting endpoint has been retired.",
      replacement: "/api/contributions/activity",
    },
    { status: 410 },
  );
}
