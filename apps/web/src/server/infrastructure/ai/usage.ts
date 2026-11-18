import "server-only";
import type { LanguageModel, LanguageModelUsage } from "ai";

/**
 * What one model call used, in the shape the usage ledger stores. A "call" is one
 * `streamText` or `generateText` run: a chat turn makes several requests to the provider
 * (one per tool-calling step) and they are added up here.
 *
 * `inputTokens` is every input token of the call. The AI SDK reports the provider's
 * cached tokens inside that total (`usage.inputTokens`) and again on their own
 * (`usage.inputTokenDetails.cacheReadTokens` / `cacheWriteTokens`), so cache-read and
 * cache-write are parts of the input, never added on top of it.
 */
export interface AiCallUsage {
  /** The provider's short name, e.g. "anthropic" or "openai". */
  provider: string;
  /** The model id the provider answered with, or the configured id when it gave none. */
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Requests made to the provider during the call. */
  steps: number;
}

/** The provider's short name: "anthropic.messages" and "openai.responses" lose the suffix. */
export function modelProviderName(model: LanguageModel): string {
  const provider = typeof model === "string" ? model.split("/")[0] : model.provider;
  return (provider ?? "").split(".")[0] || "unknown";
}

function modelIdOf(model: LanguageModel): string {
  return typeof model === "string" ? model : model.modelId;
}

const count = (value: number | undefined): number =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;

/** The parts of a finished step this module reads. */
export interface UsageStep {
  usage: LanguageModelUsage;
  response?: { modelId?: string };
}

/**
 * A reporter for one call that passes its usage on at most once. A call can come to an
 * end twice over (stopped, then finished), and the ledger must count it once: the first
 * report with at least one finished step wins and later ones are ignored. A report with
 * no finished steps has nothing to count and does not use up the one report. `onUsage`
 * throwing is logged and goes no further.
 */
export function createUsageReporter(
  model: LanguageModel,
  onUsage: ((usage: AiCallUsage) => void) | undefined,
): (steps: readonly UsageStep[]) => void {
  let reported = false;
  return (steps) => {
    if (reported || steps.length === 0 || !onUsage) return;
    reported = true;
    try {
      onUsage(summariseCallUsage(model, steps));
    } catch (err) {
      console.error("[assistant] could not report usage:", err);
    }
  };
}

/** Add up the steps of one call. `model` is the model that was asked. */
export function summariseCallUsage(model: LanguageModel, steps: readonly UsageStep[]): AiCallUsage {
  const usage: AiCallUsage = {
    provider: modelProviderName(model),
    model: steps.at(-1)?.response?.modelId || modelIdOf(model),
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    steps: steps.length,
  };
  for (const step of steps) {
    usage.inputTokens += count(step.usage.inputTokens);
    usage.outputTokens += count(step.usage.outputTokens);
    usage.cacheReadTokens += count(step.usage.inputTokenDetails?.cacheReadTokens);
    usage.cacheWriteTokens += count(step.usage.inputTokenDetails?.cacheWriteTokens);
  }
  return usage;
}
