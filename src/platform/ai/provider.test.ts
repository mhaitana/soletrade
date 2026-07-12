import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Unit tests for the AI provider abstraction. The `env` object is parsed once at
 * module load from `process.env`, so each case stubs the relevant env vars, resets
 * the module registry, and re-imports the provider fresh - exercising `getAIModel`
 * against each `AI_PROVIDER` value with/without the provider's API key.
 */
describe("AI provider (platform/ai/provider)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("isMockProvider() is true by default (AI_PROVIDER=mock)", async () => {
    vi.stubEnv("AI_PROVIDER", "mock");
    vi.resetModules();
    const { isMockProvider } = await import("@/platform/ai/provider");
    expect(isMockProvider()).toBe(true);
  });

  it("getAIModel() throws for the mock provider (caller must use the mock stream)", async () => {
    vi.stubEnv("AI_PROVIDER", "mock");
    vi.resetModules();
    const { getAIModel } = await import("@/platform/ai/provider");
    expect(() => getAIModel()).toThrow(/mock provider/);
  });

  it("getAIModel() throws when AI_PROVIDER=anthropic but ANTHROPIC_API_KEY is unset", async () => {
    vi.stubEnv("AI_PROVIDER", "anthropic");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.resetModules();
    const { getAIModel } = await import("@/platform/ai/provider");
    expect(() => getAIModel()).toThrow(/ANTHROPIC_API_KEY/);
  });

  it("getAIModel() throws when AI_PROVIDER=openai but OPENAI_API_KEY is unset", async () => {
    vi.stubEnv("AI_PROVIDER", "openai");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.resetModules();
    const { getAIModel } = await import("@/platform/ai/provider");
    expect(() => getAIModel()).toThrow(/OPENAI_API_KEY/);
  });

  it("getAIModel() returns the Anthropic model when its API key is set", async () => {
    vi.stubEnv("AI_PROVIDER", "anthropic");
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key-anthropic");
    vi.stubEnv("ANTHROPIC_MODEL", "claude-sonnet-5");
    vi.resetModules();
    const { getAIModel, isMockProvider } = await import("@/platform/ai/provider");
    expect(isMockProvider()).toBe(false);
    const model = getAIModel() as unknown as { provider: string };
    // The AI SDK stamps the provider id on the model - `anthropic.*` for the Anthropic factory.
    expect(model.provider).toMatch(/^anthropic/);
  });

  it("getAIModel() returns the OpenAI model when its API key is set", async () => {
    vi.stubEnv("AI_PROVIDER", "openai");
    vi.stubEnv("OPENAI_API_KEY", "test-key-openai");
    vi.stubEnv("OPENAI_MODEL", "gpt-4o");
    vi.resetModules();
    const { getAIModel } = await import("@/platform/ai/provider");
    const model = getAIModel() as unknown as { provider: string };
    expect(model.provider).toMatch(/^openai/);
  });
});
