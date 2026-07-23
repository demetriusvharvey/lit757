import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  const url = request.nextUrl;

  if (url.pathname === "/api/discover" && url.searchParams.get("__ml_bypass") !== "1") {
    const enhanced = url.clone();
    enhanced.pathname = "/api/discover-ml";
    return NextResponse.rewrite(enhanced);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/discover"],
};
