import "server-only";
import { generateText, type LanguageModel } from "ai";
import { summariseCallUsage, type AiCallUsage } from "@/server/infrastructure/ai/usage";

/**
 * One short, non-streaming text answer from a model, with what the call used. For small
 * jobs beside the chat (a conversation title): a single attempt, a hard time limit and a
 * small output cap, so a slow or failing provider costs little and holds nothing up.
 */
export async function generateShortText(opts: {
  model: LanguageModel;
  instructions: string;
  prompt: string;
  /** On models that reason before answering, the reasoning shares this cap. */
  maxOutputTokens: number;
  timeoutMs: number;
}): Promise<{ text: string; usage: AiCallUsage }> {
  const result = await generateText({
    model: opts.model,
    instructions: opts.instructions,
    prompt: opts.prompt,
    maxOutputTokens: opts.maxOutputTokens,
    timeout: opts.timeoutMs,
    // The caller treats a failure as "no answer"; retrying would only stretch the wait.
    maxRetries: 0,
  });
  return { text: result.text, usage: summariseCallUsage(opts.model, result.steps) };
}
