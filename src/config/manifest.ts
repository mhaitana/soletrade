import type { MetadataRoute } from "next";
import { brand } from "@/config/brand";
import { urls } from "@/config/urls";

/**
 * PWA web app manifest data. Sourced from central brand config so the product name
 * lives in one place. This object is served by `/manifest.webmanifest` and can also
 * be used in tests.
 *
 * `short_name` is the contextual in-app label (visible on the home-screen icon
 * where the mark is present); `name` is the full public product name.
 *
 * Colors intentionally match the light-mode public-page background so the splash
 * screen and home-screen icon background feel consistent. Adaptive theme-color
 * tinting in the browser chrome is handled by the viewport meta in `layout.tsx`.
 */
export function getManifest(): MetadataRoute.Manifest {
  return {
    name: brand.productName,
    short_name: brand.shortProductName,
    description: brand.tagline,
    start_url: urls.app,
    display: "standalone",
    scope: "/",
    orientation: "portrait",
    lang: "en",
    dir: "ltr",
    background_color: "#f8fafc",
    theme_color: "#f8fafc",
    categories: ["business", "finance", "productivity"],
    prefer_related_applications: false,
    icons: [
      {
        src: "/icons/icon-192x192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icons/icon-512x512.png",
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: "/icons/icon-512x512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      {
        name: "Dashboard",
        short_name: "Dashboard",
        description: "Open the workspace dashboard",
        url: "/dashboard",
        icons: [{ src: "/icons/icon-192x192.png", sizes: "192x192" }],
      },
      {
        name: "New invoice",
        short_name: "Invoice",
        description: "Create a new invoice",
        url: "/invoices/new",
        icons: [{ src: "/icons/icon-192x192.png", sizes: "192x192" }],
      },
      {
        name: "New quote",
        short_name: "Quote",
        description: "Create a new quote",
        url: "/quotes/new",
        icons: [{ src: "/icons/icon-192x192.png", sizes: "192x192" }],
      },
      {
        name: "Books",
        short_name: "Books",
        description: "Open bookkeeping",
        url: "/books",
        icons: [{ src: "/icons/icon-192x192.png", sizes: "192x192" }],
      },
    ],
  };
}
