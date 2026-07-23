import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Buzz — Real-time activity",
    short_name: "Buzz",
    description: "See what is active now, what is rising, and what a place should feel like when you arrive.",
    start_url: "/live",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f7f5ef",
    theme_color: "#ff5c35",
    categories: ["lifestyle", "travel", "navigation", "entertainment"],
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Best right now", short_name: "Best now", description: "Open the strongest nearby activity.", url: "/live?intent=best_now", icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }] },
      { name: "High energy", short_name: "Hot", description: "Find hot and rapidly rising places.", url: "/live?intent=high_energy", icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }] },
      { name: "Easy parking", short_name: "Parking", description: "Find active places with easier parking.", url: "/live?intent=easy_parking", icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }] },
    ],
  };
}
