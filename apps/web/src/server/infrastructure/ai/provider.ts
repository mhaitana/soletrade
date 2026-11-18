import "server-only";
import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import { env } from "@/server/infrastructure/config/env";

/**
 * AI provider abstraction (Phase 10). The route handler branches on
 * `isMockProvider()`: the mock path builds a canned reply from real workspace
 * data (no API key, no model); real providers resolve a model here and run the
 * AI SDK's `streamText` tool-calling loop. Model ids come from env so a newer
 * Claude / GPT release can be opted into without a code change.
 *
 * Callers ask for a model by task, not by name: `chat` for the assistant, `light` for
 * short text tasks, `vision` for reading receipts. Each tier falls back to the chat
 * model until its own env var is set.
 */

export type AIModelTier = "chat" | "light" | "vision";

/** The configured model id for a tier on the active provider (`null` for the mock). */
function modelIdFor(tier: AIModelTier): string | null {
  switch (env.AI_PROVIDER) {
    case "anthropic":
      return (
        (tier === "light" && env.ANTHROPIC_MODEL_LIGHT) ||
        (tier === "vision" && env.ANTHROPIC_MODEL_VISION) ||
        env.ANTHROPIC_MODEL
      );
    case "openai":
      return (
        (tier === "light" && env.OPENAI_MODEL_LIGHT) ||
        (tier === "vision" && env.OPENAI_MODEL_VISION) ||
        env.OPENAI_MODEL
      );
    case "mock":
      return null;
  }
}

/**
 * A label for records and logs saying which model handled a task, e.g.
 * `anthropic/claude-sonnet-5`, or `mock` when no real provider is configured.
 */
export function aiModelLabel(tier: AIModelTier = "chat"): string {
  const id = modelIdFor(tier);
  return id ? `${env.AI_PROVIDER}/${id}` : "mock";
}

/** True when no real provider is configured - the route uses the canned mock stream. */
export function isMockProvider(): boolean {
  return env.AI_PROVIDER === "mock";
}

/**
 * Resolve the language model for the configured real provider. Throws if called
 * for the mock provider (the caller must branch to the mock stream instead) or
 * if the provider's API key is unset - the boundary, not the env schema, surfaces
 * the missing-secret error (keeps the app bootable without keys per Phase 0).
 */
export function getAIModel(tier: AIModelTier = "chat"): LanguageModel {
  switch (env.AI_PROVIDER) {
    case "anthropic": {
      if (!env.ANTHROPIC_API_KEY) {
        throw new Error("AI_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set.");
      }
      return anthropic(modelIdFor(tier) ?? env.ANTHROPIC_MODEL);
    }
    case "openai": {
      if (!env.OPENAI_API_KEY) {
        throw new Error("AI_PROVIDER=openai but OPENAI_API_KEY is not set.");
      }
      return openai(modelIdFor(tier) ?? env.OPENAI_MODEL);
    }
    case "mock":
      throw new Error(
        "getAIModel() called for the mock provider - use streamMockAssistantTurn() instead.",
      );
  }
}
