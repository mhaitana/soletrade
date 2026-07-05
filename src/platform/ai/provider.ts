import "server-only";
import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import { env } from "@/shared/lib/env";

/**
 * AI provider abstraction (Phase 10). The route handler branches on
 * `isMockProvider()`: the mock path builds a canned reply from real workspace
 * data (no API key, no model); real providers resolve a model here and run the
 * AI SDK's `streamText` tool-calling loop. Model ids come from env so a newer
 * Claude / GPT release can be opted into without a code change.
 */

/** True when no real provider is configured — the route uses the canned mock stream. */
export function isMockProvider(): boolean {
  return env.AI_PROVIDER === "mock";
}

/**
 * Resolve the language model for the configured real provider. Throws if called
 * for the mock provider (the caller must branch to the mock stream instead) or
 * if the provider's API key is unset — the boundary, not the env schema, surfaces
 * the missing-secret error (keeps the app bootable without keys per Phase 0).
 */
export function getAIModel(): LanguageModel {
  switch (env.AI_PROVIDER) {
    case "anthropic": {
      if (!env.ANTHROPIC_API_KEY) {
        throw new Error("AI_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set.");
      }
      return anthropic(env.ANTHROPIC_MODEL);
    }
    case "openai": {
      if (!env.OPENAI_API_KEY) {
        throw new Error("AI_PROVIDER=openai but OPENAI_API_KEY is not set.");
      }
      return openai(env.OPENAI_MODEL);
    }
    case "mock":
      throw new Error(
        "getAIModel() called for the mock provider — use streamMockAssistant() instead.",
      );
  }
}
