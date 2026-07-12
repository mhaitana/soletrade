import { describe, it, expect, afterEach, vi } from "vitest";

/**
 * URL config is env-driven: the production application domain is never hard-coded.
 * `urls.app` follows `NEXT_PUBLIC_APP_URL` (falling back to localhost); marketing/support/
 * privacy/terms derive from `NEXT_PUBLIC_MARKETING_URL` unless individually overridden.
 *
 * Because `urls` reads `process.env` at module load, each test stubs the env it cares about,
 * resets the module registry, and dynamically re-imports so the new values take effect.
 */
describe("urls config", () => {
  const keys = [
    "NEXT_PUBLIC_APP_URL",
    "APP_URL",
    "NEXT_PUBLIC_MARKETING_URL",
    "NEXT_PUBLIC_SUPPORT_URL",
    "NEXT_PUBLIC_PRIVACY_URL",
    "NEXT_PUBLIC_TERMS_URL",
  ] as const;

  afterEach(() => {
    for (const k of keys) delete process.env[k];
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("defaults the app URL to localhost when env is unset", async () => {
    vi.resetModules();
    const { urls } = await import("@/config/urls");
    expect(urls.app).toBe("http://localhost:3000");
  });

  it("never hard-codes a production application domain in the default", async () => {
    vi.resetModules();
    const { urls } = await import("@/config/urls");
    // The app default must be localhost - no production app domain baked into the code.
    expect(urls.app).not.toContain("soletrade.example");
    expect(urls.app).not.toContain("soletrade.example");
  });

  it("reads the app URL from NEXT_PUBLIC_APP_URL (any configured domain)", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://workspace.soletrade.example";
    vi.resetModules();
    const { urls } = await import("@/config/urls");
    expect(urls.app).toBe("https://workspace.soletrade.example");
  });

  it("supports the legacy APP_URL fallback", async () => {
    process.env.APP_URL = "https://app.soletrade.example";
    vi.resetModules();
    const { urls } = await import("@/config/urls");
    expect(urls.app).toBe("https://app.soletrade.example");
  });

  it("derives marketing/support/privacy/terms from the marketing URL by default", async () => {
    process.env.NEXT_PUBLIC_MARKETING_URL = "https://www.soletrade.example";
    vi.resetModules();
    const { urls } = await import("@/config/urls");
    expect(urls.marketing).toBe("https://www.soletrade.example");
    expect(urls.support).toBe("https://www.soletrade.example/support");
    expect(urls.privacy).toBe("https://www.soletrade.example/privacy");
    expect(urls.terms).toBe("https://www.soletrade.example/terms");
  });

  it("lets support/privacy/terms be overridden individually", async () => {
    process.env.NEXT_PUBLIC_MARKETING_URL = "https://www.soletrade.example";
    process.env.NEXT_PUBLIC_SUPPORT_URL = "https://help.soletrade.example";
    process.env.NEXT_PUBLIC_PRIVACY_URL = "https://www.soletrade.example/legal/privacy";
    process.env.NEXT_PUBLIC_TERMS_URL = "https://www.soletrade.example/legal/terms";
    vi.resetModules();
    const { urls } = await import("@/config/urls");
    expect(urls.support).toBe("https://help.soletrade.example");
    expect(urls.privacy).toBe("https://www.soletrade.example/legal/privacy");
    expect(urls.terms).toBe("https://www.soletrade.example/legal/terms");
  });
});
