import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Things To Do 757",
    short_name: "Things To Do 757",
    description: "Find something worth doing in Hampton Roads right now.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f5f2ec",
    theme_color: "#171716",
    orientation: "any",
    categories: ["lifestyle", "travel", "entertainment", "food"],
    icons: [
      {
        src: "/icon",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/favicon.ico",
        sizes: "any",
        type: "image/x-icon",
      },
    ],
  };
}
