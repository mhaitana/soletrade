// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { tool, type ModelMessage } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";

vi.mock("server-only", () => ({}));

import {
  cachedConversationTail,
  cachedSystemPrompt,
  cachedToolDefinitions,
  stableToolOrder,
  stableToolPayloads,
  usesCacheBreakpoints,
} from "@/server/infrastructure/ai/prompt-cache";
import {
  createUsageReporter,
  modelProviderName,
  summariseCallUsage,
} from "@/server/infrastructure/ai/usage";

const MARK = { anthropic: { cacheControl: { type: "ephemeral" } } };
const model = (provider: string) => new MockLanguageModelV4({ provider, modelId: "configured" });

const tools = () => ({
  sendInvoice: tool({ description: "Send", inputSchema: z.object({}) }),
  createCustomer: tool({ description: "Create", inputSchema: z.object({}) }),
  listInvoices: tool({ description: "List", inputSchema: z.object({}) }),
});

describe("which models take cache marks", () => {
  it("marks requests to Anthropic only", () => {
    expect(usesCacheBreakpoints(model("anthropic.messages"))).toBe(true);
    expect(usesCacheBreakpoints(model("openai.responses"))).toBe(false);
    expect(usesCacheBreakpoints(model("mock-provider"))).toBe(false);
  });

  it("reads the provider's short name from the model", () => {
    expect(modelProviderName(model("anthropic.messages"))).toBe("anthropic");
    expect(modelProviderName(model("openai.responses"))).toBe("openai");
    expect(modelProviderName("openai/some-model")).toBe("openai");
    expect(modelProviderName(model(""))).toBe("unknown");
  });
});

describe("stable tool order", () => {
  it("sorts by name, however the tool set was built", () => {
    expect(stableToolOrder(tools())).toEqual(["createCustomer", "listInvoices", "sendInvoice"]);
    const { listInvoices, createCustomer, sendInvoice } = tools();
    expect(stableToolOrder({ listInvoices, sendInvoice, createCustomer })).toEqual([
      "createCustomer",
      "listInvoices",
      "sendInvoice",
    ]);
  });

  it("marks the tool that is sent last, and no other", () => {
    const original = tools();
    const marked = cachedToolDefinitions(original);
    expect(marked.sendInvoice!.providerOptions).toEqual(MARK);
    expect(marked.createCustomer!.providerOptions).toBeUndefined();
    expect(marked.listInvoices!.providerOptions).toBeUndefined();
    // The caller's tool set is not changed.
    expect(original.sendInvoice.providerOptions).toBeUndefined();
    expect(cachedToolDefinitions({})).toEqual({});
  });
});

describe("cache marks on the prompt", () => {
  it("turns the system prompt into one marked system message", () => {
    expect(cachedSystemPrompt("You are hAI.")).toEqual({
      role: "system",
      content: "You are hAI.",
      providerOptions: MARK,
    });
  });

  /** Where the marks are: `message` for one on a message, or the index of the marked part. */
  const marksOf = (messages: ModelMessage[]) =>
    messages.flatMap((message, index) => {
      const found: [number, "message" | number][] = [];
      if (message.providerOptions?.anthropic?.cacheControl) found.push([index, "message"]);
      if (Array.isArray(message.content)) {
        message.content.forEach((part, partIndex) => {
          const options = (part as { providerOptions?: typeof MARK }).providerOptions;
          if (options?.anthropic?.cacheControl) found.push([index, partIndex]);
        });
      }
      return found;
    });

  const toolCall = {
    role: "assistant" as const,
    content: [
      { type: "tool-call" as const, toolCallId: "c1", toolName: "listInvoices", input: {} },
    ],
  };
  const toolResult = {
    role: "tool" as const,
    content: [
      {
        type: "tool-result" as const,
        toolCallId: "c1",
        toolName: "listInvoices",
        output: { type: "json" as const, value: { items: [] } },
      },
    ],
  };

  it("marks the last part of the last message, leaving what it was given untouched", () => {
    const question: ModelMessage = {
      role: "user",
      content: [
        { type: "text", text: "[Sent on Wednesday 2026-11-18]" },
        { type: "text", text: "Which invoices are overdue?" },
      ],
    };
    const [marked] = cachedConversationTail([question]);
    expect(marksOf([marked!])).toEqual([[0, 1]]);
    expect((marked!.content as { providerOptions?: unknown }[])[1]!.providerOptions).toEqual(MARK);
    expect(marksOf([question])).toEqual([]);
  });

  it("marks a message that is plain text on the message itself", () => {
    const [marked] = cachedConversationTail([{ role: "user", content: "Hi" }]);
    expect(marked!.providerOptions).toEqual(MARK);
  });

  it("moves the mark to the new end on the next step and removes the earlier one", () => {
    const question: ModelMessage = {
      role: "user",
      content: [{ type: "text", text: "Which invoices are overdue?" }],
    };
    const stepOne = cachedConversationTail([question]);
    // The next step starts from the marked messages plus what the model and tools added.
    const stepTwo = cachedConversationTail([...stepOne, toolCall, toolResult]);
    expect(marksOf(stepTwo)).toEqual([[2, 0]]);
    // Without its mark the first message is exactly what it was.
    expect(stepTwo[0]).toEqual(question);
  });

  it("marks the tool result when an approval answer comes before it", () => {
    // After an approval the SDK appends the result as a second tool message and then joins
    // the two, keeping only the first one's options. A mark on the result's own part
    // survives that; a mark on the second message would not.
    const approvalAnswer: ModelMessage = {
      role: "tool",
      content: [{ type: "tool-approval-response", approvalId: "a1", approved: true }],
    };
    const messages = cachedConversationTail([
      { role: "user", content: [{ type: "text", text: "Add Acme" }] },
      toolCall,
      approvalAnswer,
      toolResult,
    ]);
    expect(marksOf(messages)).toEqual([[3, 0]]);
  });

  it("passes the mark to the message before when the last one has nothing to send", () => {
    const messages = cachedConversationTail([
      { role: "user", content: [{ type: "text", text: "Add Acme" }] },
      toolCall,
      {
        role: "tool",
        content: [{ type: "tool-approval-response", approvalId: "a1", approved: false }],
      },
    ]);
    expect(marksOf(messages)).toEqual([[1, 0]]);
  });

  it("leaves exactly one mark however many steps a turn takes", () => {
    let messages = cachedConversationTail([
      { role: "user", content: [{ type: "text", text: "Go" }] },
    ]);
    for (let step = 0; step < 5; step++) {
      messages = cachedConversationTail([...messages, toolCall, toolResult]);
      expect(marksOf(messages)).toHaveLength(1);
    }
    expect(marksOf(messages)).toEqual([[messages.length - 1, 0]]);
  });

  it("keeps other provider options when it adds or removes a mark", () => {
    const withOptions: ModelMessage = {
      role: "user",
      content: "Hi",
      providerOptions: { anthropic: { other: true }, openai: { store: false } },
    };
    const [marked] = cachedConversationTail([withOptions]);
    expect(marked!.providerOptions).toEqual({
      anthropic: { other: true, cacheControl: { type: "ephemeral" } },
      openai: { store: false },
    });
    const [unmarked] = cachedConversationTail([marked!, { role: "user", content: "More" }]);
    expect(unmarked!.providerOptions).toEqual({
      anthropic: { other: true },
      openai: { store: false },
    });
  });
});

describe("stableToolPayloads", () => {
  /** What Postgres jsonb does to an object: keys shortest first, then bytewise. */
  const jsonb = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(jsonb);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .sort(([a], [b]) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, item]) => [key, jsonb(item)]),
      );
    }
    return value;
  };
  const call = (input: unknown): ModelMessage => ({
    role: "assistant",
    content: [
      { type: "text", text: "Looking." },
      { type: "tool-call", toolCallId: "c1", toolName: "listInvoices", input },
    ],
  });
  const result = (output: unknown): ModelMessage =>
    ({
      role: "tool",
      content: [{ type: "tool-result", toolCallId: "c1", toolName: "listInvoices", output }],
    }) as ModelMessage;

  it("sends a tool call and its result in the same bytes in flight and from the store", () => {
    const input = { status: "overdue", search: "acme", limit: 5 };
    const value = {
      items: [{ number: "INV-1", status: "overdue", note: "n", totals: { tax: 1, net: 10 } }],
      returned: 1,
      hasMore: false,
    };
    const inFlight = [call(input), result({ type: "json", value })];
    const replayed = [call(jsonb(input)), result({ type: "json", value: jsonb(value) })];
    // The two really do differ before, and not after.
    expect(JSON.stringify(replayed)).not.toBe(JSON.stringify(inFlight));
    expect(JSON.stringify(stableToolPayloads(replayed))).toBe(
      JSON.stringify(stableToolPayloads(inFlight)),
    );
    // Keys in name order at every depth; arrays keep their order.
    expect(JSON.stringify(stableToolPayloads(inFlight)[0])).toContain(
      '"input":{"limit":5,"search":"acme","status":"overdue"}',
    );
    expect(JSON.stringify(stableToolPayloads(inFlight)[1])).toContain(
      '"value":{"hasMore":false,"items":[{"note":"n","number":"INV-1","status":"overdue","totals":{"net":10,"tax":1}}],"returned":1}',
    );
  });

  it("writes values the way the store hands them back", () => {
    // In flight a result can still hold a Date or an undefined; stored, it cannot.
    const inFlight = result({
      type: "json",
      value: { paidAt: new Date("2026-11-18T03:00:00Z"), note: undefined, count: 2 },
    });
    const replayed = result({
      type: "json",
      value: { count: 2, paidAt: "2026-11-18T03:00:00.000Z" },
    });
    expect(JSON.stringify(stableToolPayloads([inFlight]))).toBe(
      JSON.stringify(stableToolPayloads([replayed])),
    );
  });

  it("gives a declined or refused call the form it is replayed in", () => {
    // In flight the SDK marks it "denied"; from the store it comes back as an error.
    const inFlight = result({ type: "execution-denied", reason: "You declined this change." });
    const replayed = result({ type: "error-text", value: "You declined this change." });
    expect(stableToolPayloads([inFlight])).toEqual([replayed]);
    expect(stableToolPayloads([replayed])).toEqual([replayed]);
    // Without a reason both sides use the SDK's own words.
    expect(stableToolPayloads([result({ type: "execution-denied" })])).toEqual([
      result({ type: "error-text", value: "Tool call execution denied." }),
    ]);
  });

  it("leaves everything else as it is, and what it was given untouched", () => {
    const user: ModelMessage = { role: "user", content: [{ type: "text", text: "Hi" }] };
    const plain: ModelMessage = { role: "assistant", content: "Hello." };
    const text = result({ type: "text", value: "b then a" });
    const input = { b: 1, a: 2 };
    const original = call(input);
    const stable = stableToolPayloads([user, plain, text, original]);
    expect(stable.slice(0, 3)).toEqual([user, plain, text]);
    expect(Object.keys(input)).toEqual(["b", "a"]);
    expect(JSON.stringify(original)).toContain('"input":{"b":1,"a":2}');
    // Doing it again changes nothing, so running it before every step is safe.
    expect(JSON.stringify(stableToolPayloads(stable))).toBe(JSON.stringify(stable));
  });
});

describe("createUsageReporter", () => {
  const model = new MockLanguageModelV4({ provider: "anthropic.messages", modelId: "configured" });
  const step = (input: number, output: number) => ({
    usage: {
      inputTokens: input,
      inputTokenDetails: {
        noCacheTokens: input,
        cacheReadTokens: undefined,
        cacheWriteTokens: undefined,
      },
      outputTokens: output,
      outputTokenDetails: { textTokens: output, reasoningTokens: undefined },
      totalTokens: input + output,
    },
  });

  it("reports a call once, even when it is stopped and then ends", () => {
    const onUsage = vi.fn();
    const report = createUsageReporter(model, onUsage);
    report([step(100, 10)]); // stopped: one finished step
    report([step(100, 10), step(50, 5)]); // then the end arrives as well
    expect(onUsage).toHaveBeenCalledTimes(1);
    expect(onUsage).toHaveBeenCalledWith(
      expect.objectContaining({ inputTokens: 100, outputTokens: 10, steps: 1 }),
    );
  });

  it("has nothing to report for a call stopped before any step finished", () => {
    const onUsage = vi.fn();
    const report = createUsageReporter(model, onUsage);
    report([]);
    expect(onUsage).not.toHaveBeenCalled();
    // An empty report does not use up the one report.
    report([step(100, 10)]);
    expect(onUsage).toHaveBeenCalledTimes(1);
  });

  it("does not let a failing listener reach the stream", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const report = createUsageReporter(model, () => {
      throw new Error("ledger down");
    });
    expect(() => report([step(1, 1)])).not.toThrow();
    expect(errors).toHaveBeenCalledWith("[assistant] could not report usage:", expect.any(Error));
    errors.mockRestore();
    // No listener at all is fine too.
    expect(() => createUsageReporter(model, undefined)([step(1, 1)])).not.toThrow();
  });
});

describe("summariseCallUsage", () => {
  const step = (
    input: number,
    output: number,
    cache: { read?: number; write?: number } = {},
    modelId?: string,
  ) => ({
    usage: {
      inputTokens: input,
      inputTokenDetails: {
        noCacheTokens: input - (cache.read ?? 0) - (cache.write ?? 0),
        cacheReadTokens: cache.read,
        cacheWriteTokens: cache.write,
      },
      outputTokens: output,
      outputTokenDetails: { textTokens: output, reasoningTokens: undefined },
      totalTokens: input + output,
    },
    response: modelId ? { modelId } : undefined,
  });

  it("adds up the steps of a call and names the model that answered", () => {
    expect(
      summariseCallUsage(model("anthropic.messages"), [
        step(2_100, 20, { write: 2_000 }, "answered-model"),
        step(2_300, 30, { read: 2_000 }, "answered-model"),
      ]),
    ).toEqual({
      provider: "anthropic",
      model: "answered-model",
      inputTokens: 4_400,
      outputTokens: 50,
      cacheReadTokens: 2_000,
      cacheWriteTokens: 2_000,
      steps: 2,
    });
  });

  it("counts what a provider did not report as zero and falls back to the configured model", () => {
    const blank = {
      usage: {
        inputTokens: undefined,
        inputTokenDetails: {
          noCacheTokens: undefined,
          cacheReadTokens: undefined,
          cacheWriteTokens: undefined,
        },
        outputTokens: undefined,
        outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
        totalTokens: undefined,
      },
    };
    expect(summariseCallUsage(model("openai.responses"), [blank])).toEqual({
      provider: "openai",
      model: "configured",
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      steps: 1,
    });
  });
});
