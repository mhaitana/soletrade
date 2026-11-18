// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { tool, type UIMessage } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";

vi.mock("server-only", () => ({}));

import { streamAssistantTurn, type AssistantTurnEnd } from "@/server/infrastructure/ai/stream";
import type { AiCallUsage } from "@/server/infrastructure/ai/usage";

/**
 * What a turn reports as used when it runs to the end and when it is stopped part-way,
 * through the real `streamText` loop with a model that can be made to hang.
 */

type Part = Record<string, unknown>;

const usage = (input: number, output: number) => ({
  inputTokens: { total: input, noCache: input, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: output, text: output, reasoning: 0 },
});

const toolCallStep: Part[] = [
  { type: "stream-start", warnings: [] },
  { type: "tool-call", toolCallId: "call-1", toolName: "lookup", input: "{}" },
  {
    type: "finish",
    usage: usage(100, 10),
    finishReason: { unified: "tool-calls", raw: undefined },
  },
];
const textStep: Part[] = [
  { type: "stream-start", warnings: [] },
  { type: "text-start", id: "t1" },
  { type: "text-delta", id: "t1", delta: "All done." },
  { type: "text-end", id: "t1" },
  { type: "finish", usage: usage(150, 20), finishReason: { unified: "stop", raw: undefined } },
];
/** A request that starts answering and then never finishes, until it is aborted. */
const hangingStep: Part[] = [
  { type: "stream-start", warnings: [] },
  { type: "text-start", id: "t1" },
  { type: "text-delta", id: "t1", delta: "Working on it" },
];

/** A model that plays `steps` in order; a step without a finish part hangs until aborted. */
function scriptedModel(steps: Part[][]) {
  let call = 0;
  return new MockLanguageModelV4({
    provider: "anthropic.messages",
    modelId: "stream-test",
    doStream: async ({ abortSignal }) => {
      const parts = steps[call++] ?? textStep;
      const finishes = parts.some((part) => part.type === "finish");
      return {
        stream: new ReadableStream({
          start(controller) {
            for (const part of parts) controller.enqueue(part);
            if (finishes) return controller.close();
            // Like a provider request that is cut off: the read fails when aborted.
            abortSignal?.addEventListener("abort", () => {
              try {
                controller.error(new DOMException("The request was aborted.", "AbortError"));
              } catch {
                // Already closed by the reader.
              }
            });
          },
        }) as never,
      };
    },
  });
}

function run(steps: Part[][], abortSignal?: AbortSignal) {
  const reported: AiCallUsage[] = [];
  const ended: AssistantTurnEnd[] = [];
  const messages: UIMessage[] = [{ id: "u1", role: "user", parts: [{ type: "text", text: "Go" }] }];
  const response = streamAssistantTurn({
    model: scriptedModel(steps),
    system: "You are a test.",
    messages,
    modelMessages: [{ role: "user", content: [{ type: "text", text: "Go" }] }],
    tools: {
      lookup: tool({
        description: "Look something up.",
        inputSchema: z.object({}),
        execute: async () => ({ found: 1 }),
      }),
    },
    toolApproval: async () => "not-applicable",
    conversationId: "conversation-1",
    onUsage: (callUsage) => reported.push(callUsage),
    onEnd: (end) => {
      ended.push(end);
    },
    abortSignal,
  });
  return { response, reported, ended };
}

/** Read the response until `text` has gone past, then call `then`, then read to the end. */
async function readUntil(response: Response, text: string, then: () => void): Promise<string> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let seen = "";
  let acted = false;
  for (;;) {
    const { done, value } = await reader.read().catch(() => ({ done: true, value: undefined }));
    if (value) seen += decoder.decode(value, { stream: true });
    if (!acted && seen.includes(text)) {
      acted = true;
      then();
    }
    if (done) return seen;
  }
}

describe("streamAssistantTurn: what a call reports as used", () => {
  it("reports a finished turn once, with its steps added up", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const { response, reported, ended } = run([toolCallStep, textStep]);
    await response.text();
    expect(reported).toEqual([
      {
        provider: "anthropic",
        model: "stream-test",
        inputTokens: 250,
        outputTokens: 30,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        steps: 2,
      },
    ]);
    expect(ended).toHaveLength(1);
    expect(ended[0]!.isAborted).toBe(false);
  });

  it("reports the finished steps of a stopped turn once, and not the step that was cut off", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const stop = new AbortController();
    // The first request finishes (a lookup); the second is stopped while it is answering.
    const { response, reported, ended } = run([toolCallStep, hangingStep], stop.signal);
    const seen = await readUntil(response, "Working on it", () => stop.abort());
    // Give anything the stop set off a moment to arrive.
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(seen).toContain("Working on it");
    // One report: the 100 in and 10 out of the request that finished. What the request in
    // flight had used is not known to the SDK, so it is not in the ledger.
    expect(reported).toEqual([
      expect.objectContaining({ inputTokens: 100, outputTokens: 10, steps: 1 }),
    ]);
    expect(ended).toHaveLength(1);
    expect(ended[0]!.isAborted).toBe(true);
  });

  it("reports nothing for a turn stopped before its first request finished", async () => {
    const stop = new AbortController();
    const { response, reported, ended } = run([hangingStep], stop.signal);
    await readUntil(response, "Working on it", () => stop.abort());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(reported).toEqual([]);
    expect(ended).toHaveLength(1);
  });
});
