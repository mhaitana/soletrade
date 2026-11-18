import "server-only";
import type { LanguageModel, ModelMessage, SystemModelMessage, ToolSet } from "ai";
import { modelProviderName } from "@/server/infrastructure/ai/usage";

/**
 * Prompt caching for Anthropic models.
 *
 * Anthropic bills input it has seen before at a fraction of the normal price, but only
 * for an exact prefix of the request, and only up to a block the request marks. A request
 * is laid out as tool definitions, then the system prompt, then the messages, so three
 * blocks are marked:
 *
 * 1. the last tool definition: the tools alone, shared by every workspace with the same
 *    modules and permissions;
 * 2. the system prompt: tools and prompt, shared by every turn in a workspace;
 * 3. the end of the last message: the whole conversation so far, reused by the next step
 *    of the same turn and by the next turn if it follows within the cache's five minutes.
 *
 * Anything before a mark has to be byte-identical between requests, which is why tools go
 * out in a fixed order, the system prompt carries nothing that changes per turn, and tool
 * calls and results are put in one fixed form whether they come straight from the model
 * or back from the store (`stableToolPayloads`).
 *
 * The mark is `providerOptions.anthropic.cacheControl`, as `@ai-sdk/anthropic` reads it on
 * tool definitions, system messages, messages and message parts (`get-cache-control.ts`
 * and `convert-to-anthropic-prompt.ts` in the installed package). It allows four per
 * request. Other providers are sent nothing extra: OpenAI caches prefixes without being
 * asked.
 */

const BREAKPOINT = { type: "ephemeral" } as const;

type WithProviderOptions = { providerOptions?: Record<string, Record<string, unknown>> };

/** True for models whose provider takes explicit cache marks. */
export function usesCacheBreakpoints(model: LanguageModel): boolean {
  return modelProviderName(model) === "anthropic";
}

function marked<T extends WithProviderOptions>(value: T): T {
  return {
    ...value,
    providerOptions: {
      ...value.providerOptions,
      anthropic: { ...value.providerOptions?.anthropic, cacheControl: BREAKPOINT },
    },
  };
}

function unmarked<T extends WithProviderOptions>(value: T): T {
  const anthropic = value.providerOptions?.anthropic;
  if (!anthropic || !("cacheControl" in anthropic)) return value;
  // Rebuild the options without the mark, dropping whatever is left empty, so a message
  // that only ever carried the mark is exactly what it was before.
  const rest = Object.fromEntries(
    Object.entries(anthropic).filter(([key]) => key !== "cacheControl"),
  );
  const providerOptions = { ...value.providerOptions };
  if (Object.keys(rest).length > 0) providerOptions.anthropic = rest;
  else delete providerOptions.anthropic;
  const copy: WithProviderOptions = { ...value, providerOptions };
  if (Object.keys(providerOptions).length === 0) delete copy.providerOptions;
  return copy as T;
}

/**
 * The order tool definitions are sent in: by name. Object key order follows how the tool
 * set happened to be built, and a different order is a different prefix.
 */
export function stableToolOrder(tools: ToolSet): string[] {
  return Object.keys(tools).sort();
}

/** The system prompt as a message marked for caching. */
export function cachedSystemPrompt(system: string): SystemModelMessage {
  return marked<SystemModelMessage>({ role: "system", content: system });
}

/** The tool set with the last definition (in the order sent) marked for caching. */
export function cachedToolDefinitions(tools: ToolSet): ToolSet {
  const last = stableToolOrder(tools).at(-1);
  if (!last) return tools;
  return { ...tools, [last]: marked(tools[last] as WithProviderOptions) as ToolSet[string] };
}

/** A message as this module handles it: any role, text or parts. */
type AnyPart = WithProviderOptions & { type: string; input?: unknown; output?: unknown };
type AnyMessage = WithProviderOptions & { role: string; content: string | AnyPart[] };

/** A plain JSON value with every object's keys in name order, at every depth. */
function inKeyOrder(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(inKeyOrder);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, inKeyOrder(record[key])]),
    );
  }
  return value;
}

/**
 * `value` as it is once stored and read back (dates as text, undefined gone), with keys
 * in name order. Returned as it is when it cannot be written as JSON.
 */
function stableJson(value: unknown): unknown {
  try {
    const text = JSON.stringify(value);
    return text === undefined ? value : inKeyOrder(JSON.parse(text));
  } catch {
    return value;
  }
}

/** What the SDK says for a refused call when no reason was given, in flight and on replay. */
const DENIED = "Tool call execution denied.";

function stableOutput(output: unknown): unknown {
  if (!output || typeof output !== "object") return output;
  const result = output as WithProviderOptions & {
    type?: string;
    value?: unknown;
    reason?: string;
  };
  // A call that was declined or refused. In flight the SDK sends it as "denied"; replayed
  // from the store it is an error with the same words. One form for both: the error.
  if (result.type === "execution-denied") {
    return {
      type: "error-text",
      value: result.reason ?? DENIED,
      ...(result.providerOptions ? { providerOptions: result.providerOptions } : {}),
    };
  }
  if (result.type === "json" || result.type === "error-json") {
    return { ...result, value: stableJson(result.value) };
  }
  return output;
}

/**
 * The messages with every tool call's input and every tool result in one fixed form.
 *
 * Within a turn the SDK sends a tool call as the model wrote it and a result as the tool
 * returned it. On the next turn the same call and result come back from the store, where
 * jsonb has reordered each object's keys, and a declined call has become an error result.
 * The same data in different bytes is a different prefix to the provider, so the cache
 * written at the end of a turn that used a tool was never read by the next one. Run on
 * every request, in flight and replayed alike: keys go in name order and a refused call
 * always reads as the error it is stored as.
 */
export function stableToolPayloads(messages: readonly ModelMessage[]): ModelMessage[] {
  return (messages as readonly AnyMessage[]).map((message) => {
    if (typeof message.content === "string") return message;
    if (message.role !== "assistant" && message.role !== "tool") return message;
    return {
      ...message,
      content: message.content.map((part) => {
        if (part.type === "tool-call") return { ...part, input: stableJson(part.input) };
        if (part.type === "tool-result") return { ...part, output: stableOutput(part.output) };
        return part;
      }),
    };
  }) as ModelMessage[];
}

/** Parts that are sent to Anthropic as a block that can carry a mark. */
const MARKABLE_PARTS = new Set(["text", "file", "image", "tool-call", "tool-result"]);

/** The message without any mark, on itself or on its parts. */
function cleared(message: AnyMessage): AnyMessage {
  const bare = unmarked(message);
  if (typeof bare.content === "string") return bare;
  const content = bare.content.map(unmarked);
  return content.some((part, index) => part !== bare.content[index]) ? { ...bare, content } : bare;
}

/**
 * The message with its last sendable part marked, or null when it has nothing to mark.
 *
 * The mark goes on the part, not the message. The SDK joins consecutive tool messages into
 * one and keeps only the first one's options, so when a reply continues after an approval
 * (the approval answer, then the tool result) a mark on the second message was lost.
 * A message that is plain text has no parts and is marked itself.
 */
function markedAtEnd(message: AnyMessage): AnyMessage | null {
  if (message.role === "system") return null;
  if (typeof message.content === "string") return message.content ? marked(message) : null;
  const index = message.content.findLastIndex((part) => MARKABLE_PARTS.has(part.type));
  if (index < 0) return null;
  const content = [...message.content];
  content[index] = marked(content[index]!);
  return { ...message, content };
}

/**
 * The messages with the end of the conversation marked for caching and any earlier mark
 * removed. Run before every step: each step appends the model's tool calls and their
 * results, so the end moves, and a request may only carry a few marks. The mark goes on
 * the last part that is actually sent; a trailing message with none (an approval answer
 * on its own) passes it to the message before.
 */
export function cachedConversationTail(messages: readonly ModelMessage[]): ModelMessage[] {
  const result = (messages as readonly AnyMessage[]).map(cleared);
  for (let index = result.length - 1; index >= 0; index--) {
    const end = markedAtEnd(result[index]!);
    if (end) {
      result[index] = end;
      break;
    }
  }
  return result as ModelMessage[];
}
