import { createHash } from "node:crypto";
import type { ToolExecutionOptions, ToolSet } from "ai";
import { runMobileMutation, type MobileWorkspaceContext } from "@/server/application/mobile/http";

export function assistantToolOperationId(turnId: string, toolCallId: string, name: string) {
  const bytes = createHash("sha256")
    .update(`${turnId}:${toolCallId}:${name}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export function durableAssistantTools(ctx: MobileWorkspaceContext, tools: ToolSet): ToolSet {
  if (!ctx.operationId) return tools;
  return Object.fromEntries(
    Object.entries(tools).map(([name, tool]) => {
      if (!tool.execute || !/^(create|update|delete|extract|send|void|mark|convert)/.test(name))
        return [name, tool];
      const original = tool.execute;
      return [
        name,
        {
          ...tool,
          execute: async (input: unknown, options: ToolExecutionOptions<unknown>) => {
            const operationId = assistantToolOperationId(
              ctx.operationId!,
              options.toolCallId,
              name,
            );
            const request = new Request("https://internal.invalid/assistant-tool", {
              method: "POST",
              headers: { "idempotency-key": operationId },
            });
            return runMobileMutation(request, ctx, `assistant-tools/${name}`, input, async () =>
              original(input, options),
            );
          },
        },
      ];
    }),
  );
}
