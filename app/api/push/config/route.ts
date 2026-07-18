import { NextResponse } from "next/server";
import { getPushConfiguration } from "../../../../src/lib/push-server";

export const dynamic = "force-dynamic";

export async function GET() {
  const configuration = getPushConfiguration();

  return NextResponse.json(
    {
      configured: configuration.configured,
      publicKey: configuration.configured ? configuration.publicKey : null,
    },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
