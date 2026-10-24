import type { MetadataRoute } from "next";
import { urls } from "@/config/urls";

/**
 * Robots - allow all crawling of public entry points; disallow authenticated app routes, the API,
 * and token-authenticated public invoice/quote pages (unguessable tokens, no stable URL). The host
 * is derived from `urls.app` (env-configured, never hard-coded).
 */
export default function robots(): MetadataRoute.Robots {
  const base = urls.app.replace(/\/$/, "");
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: ["/api/", "/dashboard", "/i/", "/q/", "/invite/"] },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
