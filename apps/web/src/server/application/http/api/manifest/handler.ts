import "server-only";
import { NextResponse } from "next/server";
import { getManifest } from "@/config/manifest";

/**
 * PWA manifest endpoint.
 *
 * The Next.js convention file (`src/app/manifest.ts`) and root-level route handlers
 * were being intercepted by an auth redirect in this app, so the manifest is served
 * from `/api/manifest` and linked explicitly in `src/app/layout.tsx`.
 */
export async function GET() {
  const m = getManifest();
  return NextResponse.json(m, {
    headers: {
      "content-type": "application/manifest+json",
    },
  });
}
