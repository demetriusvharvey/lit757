import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Things To Do 757",
    short_name: "757 Buzz",
    description: "Know what is happening around you in real time.",
    start_url: "/",
    display: "standalone",
    background_color: "#020304",
    theme_color: "#020304",
    orientation: "portrait",
    categories: ["lifestyle", "entertainment", "travel"],
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}
