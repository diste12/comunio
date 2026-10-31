import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Comunio — Portal do condómino",
    short_name: "Comunio",
    description: "Quotas, recibos, ocorrências e assembleias do seu condomínio.",
    start_url: "/portal",
    scope: "/",
    display: "standalone",
    background_color: "#fafaf9",
    theme_color: "#1f6f5c",
    lang: "pt-PT",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
