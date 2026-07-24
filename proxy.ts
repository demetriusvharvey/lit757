import { NextRequest, NextResponse } from "next/server";
import { INTERNAL_DISCOVERY_HEADER, mlDiscoveryEnabled } from "./src/lib/ml/discovery-routing";

// Next.js 16 renamed Middleware to Proxy. Proxy runs on the Node runtime, so
// server environment variables are read normally at request time and the flag
// below can be flipped without a redeploy.
export function proxy(request: NextRequest) {
  // Off by default. ML-enhanced discovery only re-ranks results; it must never
  // become a hard dependency of the canonical discovery path.
  if (!mlDiscoveryEnabled()) return NextResponse.next();

  // The ML route calls /api/discover itself. Do not rewrite that hop.
  if (request.headers.get(INTERNAL_DISCOVERY_HEADER)) return NextResponse.next();

  const url = request.nextUrl;
  if (url.pathname === "/api/discover") {
    const enhanced = url.clone();
    enhanced.pathname = "/api/discover-ml";
    return NextResponse.rewrite(enhanced);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/discover"],
};
