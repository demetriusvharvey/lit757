import { NextResponse } from "next/server";

/**
 * Retired compatibility endpoint.
 *
 * Keeping a 410 response is safer than silently accepting legacy anonymous
 * signals into the activity model. It also gives old clients an explicit
 * migration path instead of turning a removed route into an unexplained 404.
 */
export async function POST() {
  return NextResponse.json(
    {
      success: false,
      error: "This signal endpoint has been retired.",
      replacement: "/api/contributions/activity",
    },
    { status: 410 },
  );
}
