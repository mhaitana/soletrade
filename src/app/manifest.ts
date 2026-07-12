import type { MetadataRoute } from "next";
import { brand } from "@/config/brand";
import { urls } from "@/config/urls";

/**
 * PWA web app manifest. Sourced from central brand config so the product name lives in one place.
 * `short_name` is the contextual in-app label (visible on the home-screen icon where the mark is
 * present); `name` is the full public product name.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: brand.productName,
    short_name: brand.shortProductName,
    description: brand.tagline,
    start_url: urls.app,
    display: "standalone",
    background_color: "#f8fafc",
    theme_color: "#0b1220",
  };
}
