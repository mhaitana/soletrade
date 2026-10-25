import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.resolve(__dirname, "../.."),
  experimental: {
    // Each E2E run owns a short-lived server; avoid accumulating a large disk cache.
    turbopackFileSystemCacheForDev: process.env.E2E_ENV_FILE ? false : undefined,
  },
};

export default nextConfig;
