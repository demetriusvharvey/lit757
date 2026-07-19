import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "Find the most active places in the 757";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          overflow: "hidden",
          background: "#f7f5ef",
          color: "#171716",
          fontFamily: "Arial, Helvetica, sans-serif",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "radial-gradient(circle at 82% 18%, rgba(255,92,53,.24), transparent 30%), radial-gradient(circle at 88% 78%, rgba(23,23,22,.12), transparent 34%)",
          }}
        />

        <div
          style={{
            width: "58%",
            padding: "68px 0 62px 72px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            zIndex: 2,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <div
              style={{
                width: 54,
                height: 54,
                borderRadius: 18,
                background: "#171716",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <div style={{ width: 16, height: 16, borderRadius: 999, background: "#ff5c35" }} />
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-1.2px" }}>Things To Do 757</div>
              <div style={{ marginTop: 6, fontSize: 14, fontWeight: 700, letterSpacing: "3px", color: "rgba(23,23,22,.42)" }}>
                LIVE ACTIVITY · HAMPTON ROADS
              </div>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 70, lineHeight: .94, fontWeight: 750, letterSpacing: "-4.5px", maxWidth: 650 }}>
              Find the most active places in the 757.
            </div>
            <div style={{ marginTop: 26, fontSize: 25, lineHeight: 1.35, color: "rgba(23,23,22,.58)", maxWidth: 610 }}>
              Live-ranked restaurants, nightlife, events and things to do.
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 18, fontWeight: 700 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "12px 18px", borderRadius: 999, background: "#171716", color: "white" }}>
              <span style={{ color: "#ff6b48" }}>●</span> Ranked by activity
            </div>
            <div style={{ padding: "12px 18px", borderRadius: 999, border: "1px solid rgba(23,23,22,.12)", background: "rgba(255,255,255,.72)" }}>
              Updated automatically
            </div>
          </div>
        </div>

        <div style={{ width: "42%", padding: "55px 58px 55px 24px", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2 }}>
          <div
            style={{
              width: "100%",
              height: "100%",
              borderRadius: 44,
              background: "#171716",
              padding: 28,
              display: "flex",
              flexDirection: "column",
              boxShadow: "0 35px 80px rgba(23,23,22,.22)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", color: "white" }}>
              <div style={{ fontSize: 19, fontWeight: 700 }}>Most active right now</div>
              <div style={{ fontSize: 13, color: "rgba(255,255,255,.48)" }}>ALL 757</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 24 }}>
              {[
                ["01", "Oceanfront nightlife", "Heating up", "#ff5c35"],
                ["02", "Live events nearby", "Active", "#ff8a6f"],
                ["03", "Restaurants open now", "Trending", "#ffb29f"],
              ].map(([rank, name, state, accent]) => (
                <div key={rank} style={{ display: "flex", alignItems: "center", gap: 16, borderRadius: 24, padding: "18px 18px", background: "rgba(255,255,255,.08)", border: "1px solid rgba(255,255,255,.09)" }}>
                  <div style={{ width: 44, height: 44, borderRadius: 16, display: "flex", alignItems: "center", justifyContent: "center", background: accent, color: "white", fontWeight: 800, fontSize: 17 }}>
                    {rank}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
                    <div style={{ color: "white", fontSize: 18, fontWeight: 700 }}>{name}</div>
                    <div style={{ marginTop: 4, color: "rgba(255,255,255,.46)", fontSize: 14 }}>{state}</div>
                  </div>
                  <div style={{ color: accent, fontSize: 24 }}>●</div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: "auto", height: 118, borderRadius: 26, background: "radial-gradient(circle at 70% 35%, #ff7655 0 3%, transparent 4%), radial-gradient(circle at 35% 62%, #ff5c35 0 3%, transparent 4%), linear-gradient(135deg,#2a2927,#111110)", border: "1px solid rgba(255,255,255,.08)" }} />
          </div>
        </div>
      </div>
    ),
    size
  );
}
