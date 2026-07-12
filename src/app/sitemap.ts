import type { MetadataRoute } from "next";
import { urls } from "@/config/urls";

/**
 * Sitemap - public entry points only. Authenticated (app) routes and token-authenticated public
 * invoice/quote pages (`/i/*`, `/q/*`) are excluded: they aren't indexable and have no stable URL.
 * The host is derived from `urls.app` (env-configured, never hard-coded).
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = urls.app.replace(/\/$/, "");
  const lastModified = new Date("2026-07-11");
  return [
    { url: `${base}/`, lastModified, changeFrequency: "monthly", priority: 1 },
    { url: `${base}/login`, lastModified, changeFrequency: "yearly", priority: 0.3 },
    { url: `${base}/signup`, lastModified, changeFrequency: "yearly", priority: 0.5 },
    { url: `${base}/pricing`, lastModified, changeFrequency: "monthly", priority: 0.7 },
  ];
}
