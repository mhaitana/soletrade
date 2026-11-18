export const dynamic = "force-dynamic";
// A turn can run several model steps with tool calls in between; give it room rather than
// relying on the platform default (same ceiling as the mobile cron route).
export const maxDuration = 300;

export { POST } from "@/server/application/http/api/assistant/handler";
