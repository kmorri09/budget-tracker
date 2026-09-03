import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Budget",
    short_name: "Budget",
    description: "A private rolling budget dashboard.",
    start_url: "/",
    display: "standalone",
    background_color: "#f7f8f6",
    theme_color: "#f7f8f6",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
