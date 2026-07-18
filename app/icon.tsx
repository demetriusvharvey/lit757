import { ImageResponse } from "next/og";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
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
          fontSize: 172,
          fontWeight: 700,
          letterSpacing: "-11px",
        }}
      >
        757
        <span
          style={{
            width: 54,
            height: 54,
            marginLeft: 23,
            marginTop: 89,
            borderRadius: 999,
            background: "#ff5c35",
          }}
        />
      </div>
    ),
    size
  );
}
