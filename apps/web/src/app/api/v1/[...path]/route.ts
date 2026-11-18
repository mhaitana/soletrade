export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The native assistant stream is served through this route; see app/api/assistant/route.ts.
export const maxDuration = 300;

export { GET, POST, PATCH, DELETE } from "@/server/application/http/api/v1/path/handler";
