import { NextResponse } from "next/server";
import { z } from "zod";
import { tryWorkspaceContext } from "@/platform/context";
import { searchWorkspace } from "./search";

/**
 * Global search endpoint (Wave 3). The ⌘K command palette debounces GET requests here as
 * the user types; the response is a grouped list of hits the palette renders as cmdk groups.
 *
 * Auth: resolved workspace context (401 if none) - any signed-in member can search (search
 * is read-only + module-gated, not role-gated; see `search.ts`). The session workspace id is
 * resolved server-side - the client never supplies it. Zod validates the query (Route Handlers
 * are a server boundary, so every boundary gets Zod per the project rules).
 */
export const dynamic = "force-dynamic";

const querySchema = z.object({
  q: z.string().trim().min(1).max(100),
  limit: z.coerce.number().int().min(1).max(20).optional(),
});

export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    q: url.searchParams.get("q") ?? "",
    limit: url.searchParams.get("limit") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ groups: [] });
  }

  const ctx = await tryWorkspaceContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const groups = await searchWorkspace(ctx.workspaceId, parsed.data.q, {
    limitPerModule: parsed.data.limit,
  });
  return NextResponse.json({ groups });
}
