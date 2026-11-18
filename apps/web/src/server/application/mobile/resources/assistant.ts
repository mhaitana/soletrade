import "server-only";
import { z } from "zod";
import { branded } from "@/types/ids";
import * as conversations from "@/server/foundation/conversations/conversations";
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
} from "@/server/application/mobile/resources/common";
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
  if (p.length === 3 && (p[2] === "messages" || p[2] === "approvals") && method === "POST") {
    const input =
      p[2] === "messages"
        ? {
            kind: "message" as const,
            text: parse(z.object({ message: z.string().trim().min(1).max(4000) }).strict(), data)
              .message,
          }
        : {
            kind: "approvals" as const,
            decisions: parse(
              z
                .object({
                  approvals: z
                    .array(
                      z
                        .object({
                          approvalId: z.string().min(1).max(200),
                          approved: z.boolean(),
                        })
                        .strict(),
                    )
                    .min(1)
                    .max(20),
                })
                .strict(),
              data,
            ).approvals,
          };
    const { rateLimit } = await import("@/server/infrastructure/rate-limit/index");
    const { MobileApiError } = await import("@/server/application/mobile/http");
    if (!(await rateLimit(`ai:user:${ctx.user.id}`, { max: 30, windowMs: 60_000 })))
      throw new MobileApiError(
        "rate_limited",
        "Too many assistant requests. Try again shortly.",
        429,
      );
    const turn = await import("@/server/application/assistant/turn");
    try {
      // `row` was loaded above with its history, so the conversation is read once per turn.
      return await turn.runAssistantTurn({
        ctx,
        surface: "mobile",
        conversation: row,
        input,
        // Builds that cannot show approval cards have changes refused with a reason.
        approvalsSupported: ctx.capabilities?.includes("approvals") ?? false,
        abortSignal: ctx.signal,
      });
    } catch (err) {
      if (err instanceof turn.AssistantTurnError)
        throw new MobileApiError(err.code, err.message, err.status);
      throw err;
    }
  }
  missing();
}
