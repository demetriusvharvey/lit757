import { ImageResponse } from "next/og";
import { safeCardText, shareMode, shareStatus } from "../../../../src/lib/invite-the-crew";

export const runtime = "edge";

function numeric(value: string | null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function roadRotation(seed: number, index: number) {
  return ((Math.abs(seed * 997 + index * 47) % 110) - 55).toFixed(2);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const venueId = safeCardText(url.searchParams.get("venue"), "venue", 80);
  const name = safeCardText(url.searchParams.get("name"), "A Buzz spot", 52);
  const city = safeCardText(url.searchParams.get("city"), "Hampton Roads", 34);
  const status = shareStatus(url.searchParams.get("status"));
  const trend = safeCardText(url.searchParams.get("trend"), "Rising now", 32);
  const mode = shareMode(url.searchParams.get("mode"));
  const latitude = numeric(url.searchParams.get("lat"));
  const longitude = numeric(url.searchParams.get("lng"));
  const seed = Math.abs((latitude || 36.88) * 1000 + (longitude || -76.17) * 1000 + venueId.length);
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]?.toUpperCase()).join("") || "B";
  const truthLabel = mode === "live" ? "VERIFIED LIVE ACTIVITY" : "BUZZ FORECAST";
  const truthCopy = mode === "live"
    ? "Backed by current direct or verified activity signals."
    : "Based on events, hours, movement, weather, transit, and local activity patterns.";

  return new ImageResponse(
    (
      <div style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        position: "relative",
        overflow: "hidden",
        background: "#080b10",
        color: "white",
        fontFamily: "Arial, sans-serif",
      }}>
        <div style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          background: "radial-gradient(circle at 74% 24%, rgba(249,115,22,.34), transparent 30%), radial-gradient(circle at 18% 76%, rgba(139,92,246,.28), transparent 34%), linear-gradient(160deg,#080b10 0%,#111827 58%,#090c12 100%)",
        }} />

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "74px 72px 0", zIndex: 2 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 20 }}>
            <div style={{ fontSize: 72, fontWeight: 900, letterSpacing: "-5px" }}>BUZZ</div>
            <div style={{ fontSize: 19, fontWeight: 800, letterSpacing: "5px", color: "#a7b0bc" }}>THINGS TO DO NOW</div>
          </div>
          <div style={{ display: "flex", padding: "13px 20px", border: "2px solid rgba(255,255,255,.2)", borderRadius: 999, fontSize: 19, fontWeight: 800, letterSpacing: "2px", background: "rgba(8,11,16,.7)" }}>{truthLabel}</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", padding: "120px 72px 0", zIndex: 2 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 26 }}>
            <div style={{
              width: 128,
              height: 128,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 34,
              border: "4px solid rgba(255,255,255,.88)",
              background: "linear-gradient(145deg,#5b21b6,#ea580c)",
              boxShadow: "0 0 54px rgba(249,115,22,.42)",
              fontSize: 48,
              fontWeight: 900,
            }}>{initials}</div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ fontSize: 28, fontWeight: 800, color: "#fb923c", letterSpacing: "4px" }}>{status.toUpperCase()}</div>
              <div style={{ marginTop: 10, fontSize: 67, lineHeight: 1.02, fontWeight: 900, letterSpacing: "-3px", maxWidth: 770 }}>{name}</div>
              <div style={{ display: "flex", marginTop: 16, fontSize: 28, color: "#cbd5e1" }}>{city} · {trend}</div>
            </div>
          </div>
        </div>

        <div style={{
          position: "relative",
          height: 760,
          margin: "94px 58px 0",
          display: "flex",
          overflow: "hidden",
          border: "3px solid rgba(255,255,255,.16)",
          borderRadius: 48,
          background: "#111820",
          boxShadow: "0 36px 90px rgba(0,0,0,.48)",
          zIndex: 2,
        }}>
          <div style={{ position: "absolute", inset: 0, display: "flex", background: "linear-gradient(145deg,#17202b,#0c1219)" }} />
          {Array.from({ length: 15 }, (_, index) => (
            <div key={`road-${index}`} style={{
              position: "absolute",
              width: index % 3 === 0 ? 980 : 720,
              height: index % 4 === 0 ? 15 : 8,
              left: `${-180 + (index % 5) * 230}px`,
              top: `${35 + Math.floor(index / 3) * 150}px`,
              borderRadius: 999,
              background: index % 4 === 0 ? "rgba(148,163,184,.24)" : "rgba(100,116,139,.18)",
              transform: `rotate(${roadRotation(seed, index)}deg)`,
            }} />
          ))}
          {Array.from({ length: 24 }, (_, index) => (
            <div key={`block-${index}`} style={{
              position: "absolute",
              width: 72 + (index % 4) * 24,
              height: 42 + (index % 3) * 28,
              left: `${30 + (index % 6) * 172}px`,
              top: `${40 + Math.floor(index / 6) * 164}px`,
              borderRadius: 18,
              border: "2px solid rgba(148,163,184,.08)",
              background: "rgba(30,41,59,.46)",
            }} />
          ))}
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ position: "absolute", width: 480, height: 480, borderRadius: 999, background: "radial-gradient(circle,rgba(239,68,68,.62) 0%,rgba(249,115,22,.36) 31%,rgba(250,204,21,.14) 54%,transparent 72%)" }} />
            <div style={{ position: "absolute", width: 258, height: 258, border: "8px solid rgba(251,146,60,.7)", borderRadius: 999, boxShadow: "0 0 80px rgba(249,115,22,.65)" }} />
            <div style={{ width: 128, height: 128, display: "flex", alignItems: "center", justifyContent: "center", border: "10px solid white", borderRadius: 999, background: "#ef4444", boxShadow: "0 0 0 20px rgba(239,68,68,.22),0 18px 50px rgba(0,0,0,.5)", fontSize: 46, fontWeight: 900 }}>{initials}</div>
          </div>
          <div style={{ position: "absolute", left: 34, bottom: 30, display: "flex", padding: "14px 18px", borderRadius: 999, background: "rgba(8,11,16,.78)", fontSize: 20, fontWeight: 800, color: "#f8fafc" }}>VENUE SURGE · NOT A PERSON’S LOCATION</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", padding: "74px 72px 0", zIndex: 2 }}>
          <div style={{ fontSize: 58, lineHeight: 1.04, fontWeight: 900, letterSpacing: "-2px" }}>The crew needs to see this.</div>
          <div style={{ marginTop: 24, maxWidth: 880, fontSize: 27, lineHeight: 1.4, color: "#c5ced8" }}>{truthCopy}</div>
          <div style={{ marginTop: 48, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "30px 34px", border: "2px solid rgba(255,255,255,.18)", borderRadius: 28, background: "rgba(17,24,39,.82)" }}>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ fontSize: 19, color: "#9ca3af", letterSpacing: "3px", fontWeight: 800 }}>OPEN THE LIVE MAP</div>
              <div style={{ marginTop: 8, fontSize: 32, fontWeight: 900 }}>lit757.vercel.app</div>
            </div>
            <div style={{ display: "flex", padding: "22px 30px", borderRadius: 20, background: "#ffffff", color: "#0b1016", fontSize: 24, fontWeight: 900 }}>INVITE THE CREW →</div>
          </div>
        </div>
      </div>
    ),
    {
      width: 1080,
      height: 1920,
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=1800",
        "Content-Disposition": `inline; filename="buzz-${venueId.replace(/[^a-zA-Z0-9_-]/g, "-")}.png"`,
      },
    },
  );
}
