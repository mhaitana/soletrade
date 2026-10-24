import { z } from "zod";
import { branded } from "@/shared/types/ids";
import * as conversations from "@/platform/ai/conversations";
import { durableAssistantTools } from "../assistant-tools";
import {
  checkVersion,
  createOnce,
  found,
  gate,
  id,
  missing,
  parse,
  splitBody,
  type Context,
  type Method,
} from "./common";
export async function writeAssistant(
  ctx: Context,
  p: string[],
  method: Method,
  body: unknown,
): Promise<unknown | Response> {
  await gate(ctx, "view:workspace");
  if (p[0] !== "conversations") return missing();
  const { data, expectedVersion } = splitBody(body);
  if (p.length === 1 && method === "POST") {
    const input = parse(
      z.object({ title: z.string().trim().min(1).max(200).optional() }).strict(),
      data,
    );
    return createOnce(
      ctx,
      (v) =>
        conversations.getConversation(ctx.workspaceId, ctx.user.id, branded<"AiConversationId">(v)),
      (v) =>
        conversations.createConversation(
          ctx.workspaceId,
          ctx.user.id,
          input.title,
          v ? branded<"AiConversationId">(v) : undefined,
        ),
    );
  }
  const key = branded<"AiConversationId">(id(p[1]));
  const row = found(await conversations.getConversation(ctx.workspaceId, ctx.user.id, key));
  checkVersion(row, expectedVersion);
  if (p.length === 2 && method === "DELETE") {
    parse(z.object({}).strict(), data);
    await conversations.deleteConversation(ctx.workspaceId, ctx.user.id, key);
    return { deleted: true };
  }
  if (p.length === 2 && method === "PATCH") {
    const input = parse(
      z
        .object({
          title: z.string().trim().min(1).max(200).optional(),
          writeEnabled: z.boolean().optional(),
        })
        .strict(),
      data,
    );
    if (input.title !== undefined)
      await conversations.renameConversation(ctx.workspaceId, ctx.user.id, key, input.title);
    if (input.writeEnabled !== undefined)
      await conversations.setConversationWriteEnabled(
        ctx.workspaceId,
        ctx.user.id,
        key,
        input.writeEnabled,
      );
    return found(await conversations.getConversation(ctx.workspaceId, ctx.user.id, key));
  }
  if (p.length === 3 && p[2] === "messages" && method === "POST") {
    const input = parse(z.object({ message: z.string().trim().min(1).max(4000) }).strict(), data);
    const { rateLimit } = await import("@/server/rate-limit");
    if (!(await rateLimit(`ai:user:${ctx.user.id}`, { max: 30, windowMs: 60_000 })))
      throw new (await import("@/platform/mobile/http")).MobileApiError(
        "rate_limited",
        "Too many assistant requests. Try again shortly.",
        429,
      );
    await conversations.appendMessage(ctx.workspaceId, ctx.user.id, key, {
      role: "user",
      content: input.message,
    });
    const conversation = found(
      await conversations.getConversation(ctx.workspaceId, ctx.user.id, key),
    );
    const ai = await import("@/platform/ai");
    const { getInstalledModules } = await import("@/platform/module-installations");
    const modules = await getInstalledModules(ctx.workspaceId);
    const tools = await import("@/app/(app)/assistant/tools");
    if (ai.isMockProvider()) {
      const action = tools.buildMockHaiSafeAction(ctx, modules, input.message);
      const text = action?.text ?? (await tools.buildMockAssistantReply(ctx, modules));
      await conversations.appendMessage(ctx.workspaceId, ctx.user.id, key, {
        role: "assistant",
        content: text,
      });
      return ai.streamMockAssistant({ text, conversationId: key, tool: action?.tool });
    }
    return ai.streamAssistant({
      model: ai.getAIModel(),
      system: [
        "You are hAI, the workspace's business assistant. Use tools for business facts; never invent numbers. Money is integer cents; include the currency.",
        `Role: ${ctx.role}. Modules: ${modules.join(", ")}. Today: ${new Date().toISOString().slice(0, 10)}.`,
        "The native client supports workspace navigation. Do not send messages or mutate records unless the user explicitly confirms the exact proposed action, amounts and currency.",
        conversation.writeEnabled
          ? "Write tools are enabled. Summarise each proposed mutation and ask for explicit confirmation before executing it."
          : "Write tools are disabled. Help the user inspect data and navigate forms.",
      ].join("\n"),
      messages: conversation.messages.map((m, i) => ({
        id: `message-${i}`,
        role: m.role,
        parts: [{ type: "text" as const, text: m.content }],
      })),
      tools: durableAssistantTools(
        ctx,
        tools.buildAssistantTools(ctx, modules, { writeEnabled: conversation.writeEnabled }),
      ),
      abortSignal: ctx.signal,
      conversationId: key,
      onFinish: async (text) => {
        if (text)
          await conversations.appendMessage(ctx.workspaceId, ctx.user.id, key, {
            role: "assistant",
            content: text,
          });
      },
    });
  }
  missing();
}
