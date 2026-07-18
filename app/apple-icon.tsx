import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#171716",
          color: "#ffffff",
          fontFamily: "Arial, sans-serif",
          fontSize: 60,
          fontWeight: 700,
          letterSpacing: "-4px",
        }}
      >
        757
        <span
          style={{
            width: 19,
            height: 19,
            marginLeft: 8,
            marginTop: 31,
            borderRadius: 99,
            background: "#ff5c35",
          }}
        />
      </div>
    ),
    size
  );
}
