import "server-only";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { tryWorkspaceContext } from "@/server/application/auth/workspace-context";
import { clientCapabilities, requireMobileContext } from "@/server/application/mobile/http";
import { getConversation } from "@/server/foundation/conversations/conversations";
import { rateLimit } from "@/server/infrastructure/rate-limit/index";
import {
  AssistantTurnError,
  runAssistantTurn,
  type AssistantTurnInput,
} from "@/server/application/assistant/turn";
import { branded } from "@/types/ids";

/**
 * Streaming AI assistant endpoint. `POST` resolves the workspace context (non-redirecting -
 * 401 on no session), rate-limits per IP + per user, validates the body and runs one turn:
 *
 * - `kind: "message"` (the default): the user's new message, as `message` or as the last
 *   user message in `messages` (older clients send the whole transcript; only that last
 *   message's text is read - the stored conversation is the source of truth);
 * - `kind: "approvals"`: `{ approvalId, approved }` for each change hAI proposed in its last
 *   reply. Only the decision comes from the client; what runs is the server's stored copy;
 * - `kind: "regenerate"`: answer the last message again;
 * - `kind: "retry"`: the last request failed; `message` is the text that was sent. The
 *   server answers its stored copy if it has one, or takes it as a new message if not.
 *
 * A new conversation's id is sent on the `X-Conversation-Id` response header.
 */

const bodySchema = z.object({
  // `nullish`: the client sends `"conversationId": null` for a new conversation.
  conversationId: z.string().uuid().nullish(),
  kind: z.enum(["message", "approvals", "regenerate", "retry"]).default("message"),
  message: z.string().max(20_000).optional(),
  messages: z
    .array(
      z.object({
        role: z.string(),
        parts: z.array(z.object({ type: z.string() }).passthrough()),
      }),
    )
    .max(2_000)
    .optional(),
  approvals: z
    .array(z.object({ approvalId: z.string().min(1).max(200), approved: z.boolean() }).strict())
    .max(20)
    .optional(),
  messageId: z.string().max(100).optional(),
  // UI context improves relevance but is never trusted for authorization or
  // workspace scoping. The server still resolves both from the authenticated session.
  pageContext: z
    .object({
      pathname: z.string().startsWith("/").max(300),
      search: z.string().max(500).optional(),
    })
    .strict()
    .optional(),
});

type Body = z.infer<typeof bodySchema>;

/** Derive the client IP for per-IP rate limiting (defense-in-depth). */
async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

/** The text of the newest user message in a client transcript. */
function latestUserText(messages: NonNullable<Body["messages"]>): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role !== "user") continue;
    for (const part of m.parts) {
      if (part.type === "text" && typeof part.text === "string") return part.text;
    }
  }
  return "";
}

function turnInput(body: Body): AssistantTurnInput | { error: string } {
  if (body.kind === "approvals") {
    return { kind: "approvals", decisions: body.approvals ?? [] };
  }
  if (body.kind === "regenerate") {
    return { kind: "regenerate", ...(body.messageId ? { messageId: body.messageId } : {}) };
  }
  const text = (body.message ?? latestUserText(body.messages ?? [])).trim();
  if (!text) return { error: "Empty message." };
  if (text.length > 4000) return { error: "Message too long." };
  return {
    kind: body.kind === "retry" ? "retry" : "message",
    text,
    ...(body.pageContext ? { pageContext: body.pageContext } : {}),
  };
}

export async function POST(request: Request): Promise<Response> {
  // 1. Resolve context without redirecting (route handlers can't redirect). A bearer token
  //    means a mobile app build; the web chat uses the session cookie.
  const fromApp = request.headers.has("authorization");
  const ctx = fromApp
    ? await requireMobileContext(request, request.headers.get("x-workspace-id") ?? "")
    : await tryWorkspaceContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  // 2. Rate-limit per IP and per user (Upstash when configured, else in-memory).
  const ip = await clientIp();
  const [ipAllowed, userAllowed] = await Promise.all([
    rateLimit(`ai:${ip}`, { max: 20, windowMs: 60_000 }),
    rateLimit(`ai:user:${ctx.user.id}`, { max: 30, windowMs: 60_000 }),
  ]);
  if (!ipAllowed || !userAllowed) {
    return NextResponse.json({ error: "Too many requests. Slow down." }, { status: 429 });
  }

  // 3. Validate the body.
  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const input = turnInput(parsed.data);
  if ("error" in input) {
    return NextResponse.json({ error: input.error }, { status: 400 });
  }

  // 4. Load the conversation (scoped to this user in this workspace).
  let conversation = null;
  if (parsed.data.conversationId) {
    conversation = await getConversation(
      ctx.workspaceId,
      ctx.user.id,
      branded<"AiConversationId">(parsed.data.conversationId),
    );
    if (!conversation) {
      return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
    }
  }

  // 5. Run the turn. The web chat always shows approval cards; an app build says so.
  try {
    return await runAssistantTurn({
      ctx,
      surface: fromApp ? "mobile" : "web",
      conversation,
      input,
      approvalsSupported: !fromApp || clientCapabilities(request).includes("approvals"),
      // Tear down the upstream model call if the client disconnects mid-stream.
      abortSignal: request.signal,
    });
  } catch (err) {
    if (err instanceof AssistantTurnError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    throw err;
  }
}
