import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { tryWorkspaceContext } from "@/platform/context";
import { getInstalledModules } from "@/platform/module-installations";
import {
  appendMessage,
  createConversation,
  getConversation,
  isMockProvider,
  streamAssistant,
  streamAssistantError,
  streamMockAssistant,
  getAIModel,
} from "@/platform/ai";
import { rateLimit } from "@/server/rate-limit";
import { buildAssistantTools, buildMockAssistantReply } from "@/app/(app)/assistant/tools";
import type { UIMessage } from "ai";
import { branded, type AiConversationId } from "@/shared/types/ids";
import { brand } from "@/config/brand";
import type { WorkspaceContext } from "@/platform/context";

/**
 * Streaming AI assistant endpoint (Phase 10). `POST` resolves the workspace
 * context (non-redirecting - 401 on no session), rate-limits per IP + per user,
 * validates the body, loads-or-creates the conversation, appends the user turn,
 * and streams back a UI-message stream. The new conversation id is sent on the
 * `X-Conversation-Id` response header so the client can update the URL.
 *
 * `force-dynamic` keeps it out of the static optimizer (it reads cookies + the DB).
 */
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  // `nullish` (not just `optional`) - the client seeds `conversationId` state to `null`
  // for a new conversation and sends `body: { conversationId }` on every request, so the
  // first send of a new chat carries `"conversationId": null`. `.optional()` only accepts
  // `undefined`, which would 400 the very first message. `null`/undefined both fall through
  // to the create-new-conversation branch below (`if (providedId)` is falsy for both).
  conversationId: z.string().uuid().nullish(),
  // The AI SDK `useChat` transport sends the full `messages` array; we only need the
  // latest user message's text (the route reconstructs full history from the persisted
  // conversation - the client transcript isn't trusted as the source of truth).
  messages: z
    .array(
      z.object({
        role: z.string(),
        parts: z.array(z.object({ type: z.string() }).passthrough()),
      }),
    )
    .min(1, "No messages."),
});

/** Derive the client IP for per-IP rate limiting (defense-in-depth). */
async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

const SYSTEM_DATE = new Date().toISOString().slice(0, 10);

/** Build the system prompt from the resolved context + installed modules + write toggle. */
function buildSystemPrompt(
  role: string,
  installedModules: readonly string[],
  writeEnabled: boolean,
): string {
  const lines = [
    `You are the ${brand.productName} assistant, an AI helper inside a small-business SaaS workspace.`,
    "You answer questions about the user's business by calling read-only tools - never invent numbers.",
    "Money is represented as integer cents. Use the currency returned by workspace tools and include its ISO code when the symbol could be ambiguous.",
    "Keep answers concise and grounded in tool output. If a tool returns null/empty, say so plainly.",
    `The user's role is "${role}". Installed modules: ${installedModules.length ? installedModules.join(", ") : "none"}.`,
    `Today is ${SYSTEM_DATE}.`,
  ];
  if (writeEnabled) {
    lines.push(
      "",
      "WRITE TOOLS ARE ENABLED for this conversation. You may create customers, invoices, quotes, and transactions.",
      "SAFETY RULE (must follow every time): before calling a write tool, state exactly what you will create - the entity type, customer (if any), line items or amount, and the total with its ISO currency code - then ask the user to confirm. Only call the write tool AFTER the user explicitly approves.",
      "If the user has not yet confirmed, do NOT call a write tool. Summarise the proposed action and wait. If the user asks to change something, restate the updated proposal and ask again.",
      "After a successful create, tell the user the new id/number and where to find it (e.g. /invoices).",
    );
  }
  return lines.join("\n");
}

/** Map persisted conversation messages to AI SDK `UIMessage`s for the model call. */
function toUIMessages(messages: { role: "user" | "assistant"; content: string }[]): UIMessage[] {
  return messages.map((m, i) => ({
    id: `msg-${i}`,
    role: m.role,
    parts: [{ type: "text", text: m.content }],
  })) as UIMessage[];
}

export async function POST(request: Request): Promise<Response> {
  // 1. Resolve context without redirecting (route handlers can't redirect).
  const ctx = await tryWorkspaceContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  // 2. Rate-limit per IP and per user (Upstash when configured, else in-memory).
  const ip = await clientIp();
  if (!(await rateLimit(`ai:${ip}`, { max: 20, windowMs: 60_000 }))) {
    return NextResponse.json({ error: "Too many requests. Slow down." }, { status: 429 });
  }
  if (!(await rateLimit(`ai:user:${ctx.user.id}`, { max: 30, windowMs: 60_000 }))) {
    return NextResponse.json({ error: "Too many requests. Slow down." }, { status: 429 });
  }

  // 3. Validate the body + extract the latest user message text.
  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const { messages: clientMessages, conversationId: providedId } = parsed.data;
  let rawText = "";
  for (let i = clientMessages.length - 1; i >= 0; i--) {
    const m = clientMessages[i]!;
    if (m.role !== "user") continue;
    for (const part of m.parts) {
      if (part.type !== "text") continue;
      const text = part.text; // passthrough schema → unknown
      if (typeof text === "string") {
        rawText = text;
        break;
      }
    }
    if (rawText) break;
  }
  const message = rawText.trim();
  if (!message) {
    return NextResponse.json({ error: "Empty message." }, { status: 400 });
  }
  if (message.length > 4000) {
    return NextResponse.json({ error: "Message too long." }, { status: 400 });
  }

  // 4. Load or create the conversation (IDOR-safe ownership checks).
  let conversationId: AiConversationId;
  if (providedId) {
    const existing = await getConversation(
      ctx.workspaceId,
      ctx.user.id,
      branded<"AiConversationId">(providedId),
    );
    if (!existing) {
      return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
    }
    conversationId = existing.id;
  } else {
    const title = message.length > 40 ? `${message.slice(0, 40)}…` : message;
    conversationId = await createConversation(ctx.workspaceId, ctx.user.id, title);
  }

  // 5. Append the user turn.
  await appendMessage(ctx.workspaceId, ctx.user.id, conversationId, {
    role: "user",
    content: message,
  });

  // 6. Reload the conversation to get the full history (incl. the new user turn).
  const conversation = await getConversation(ctx.workspaceId, ctx.user.id, conversationId);
  if (!conversation) {
    return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  }

  // 7. Installed modules + system prompt + tools.
  const installedModules = await getInstalledModules(ctx.workspaceId);
  const writeEnabled = conversation.writeEnabled;
  const system = buildSystemPrompt(ctx.role, installedModules, writeEnabled);
  const conversationIdStr = conversationId as string;

  // 8. Mock provider - canned reply from real workspace data (no model/key).
  if (isMockProvider()) {
    const text = await buildMockAssistantReply(ctx, installedModules);
    await appendMessage(ctx.workspaceId, ctx.user.id, conversationId, {
      role: "assistant",
      content: text,
    });
    return streamMockAssistant({ text, conversationId: conversationIdStr });
  }

  // 9. Real provider - streamText tool-calling loop; persist the assistant turn on finish.
  const tools = buildAssistantTools(ctx, installedModules, { writeEnabled });
  const persistCtx: WorkspaceContext = ctx;
  try {
    return await streamAssistant({
      model: getAIModel(),
      system,
      messages: toUIMessages(conversation.messages),
      tools,
      conversationId: conversationIdStr,
      // Tear down the upstream model call if the client disconnects mid-stream.
      abortSignal: request.signal,
      onFinish: async (text) => {
        if (text) {
          await appendMessage(persistCtx.workspaceId, persistCtx.user.id, conversationId, {
            role: "assistant",
            content: text,
          });
        }
      },
    });
  } catch (err) {
    // Synchronous failure before streaming starts - most commonly `getAIModel()`
    // throwing because the provider API key is unset. Surface the real cause as a
    // UI-message stream error part so the chat shows the message (a plain JSON 500
    // would surface as an opaque transport error). Mid-stream provider errors are
    // handled by `streamAssistant`'s `onError`, not this catch.
    console.error("[assistant] failed to start stream:", err);
    return streamAssistantError(err, conversationIdStr);
  }
}
