export const dynamic = "force-dynamic";
// One run handles at most 200 members and stops claiming after 40 seconds.
export const maxDuration = 60;

export { GET } from "@/server/application/http/api/cron/assistant-digest/handler";
