import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadEnvFileOverride } from "./load-env-file-override";

describe("loadEnvFileOverride", () => {
  let tmpDir: string;
  const originalCwd = process.cwd();
  const initialStripeKey = process.env.STRIPE_SECRET_KEY;
  const initialFoo = process.env.OVERRIDE_FOO;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "stripe-env-"));
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tmpDir, { recursive: true, force: true });
    if (initialStripeKey === undefined) {
      delete process.env.STRIPE_SECRET_KEY;
    } else {
      process.env.STRIPE_SECRET_KEY = initialStripeKey;
    }
    if (initialFoo === undefined) {
      delete process.env.OVERRIDE_FOO;
    } else {
      process.env.OVERRIDE_FOO = initialFoo;
    }
  });

  it("overwrites pre-existing process.env values", () => {
    const envFile = path.join(tmpDir, ".env.prod");
    writeFileSync(envFile, "STRIPE_SECRET_KEY=sk_live_override\nOVERRIDE_FOO=bar");
    process.env.STRIPE_SECRET_KEY = "sk_test_existing";
    process.env.OVERRIDE_FOO = "baz";

    loadEnvFileOverride(envFile);

    expect(process.env.STRIPE_SECRET_KEY).toBe("sk_live_override");
    expect(process.env.OVERRIDE_FOO).toBe("bar");
  });

  it("loads new keys that are not already set", () => {
    const envFile = path.join(tmpDir, ".env.prod");
    writeFileSync(envFile, "NEW_KEY=new_value");
    delete process.env.NEW_KEY;

    loadEnvFileOverride(envFile);

    expect(process.env.NEW_KEY).toBe("new_value");
    delete process.env.NEW_KEY;
  });

  it("ignores comments and blank lines", () => {
    const envFile = path.join(tmpDir, ".env.prod");
    writeFileSync(
      envFile,
      "\n# comment\nOVERRIDE_FOO=commented # inline ignored\n   \n",
    );

    loadEnvFileOverride(envFile);

    expect(process.env.OVERRIDE_FOO).toBe("commented");
  });

  it("handles quoted values with inline hash", () => {
    const envFile = path.join(tmpDir, ".env.prod");
    writeFileSync(envFile, 'QUOTED="value # with hash"\n');

    loadEnvFileOverride(envFile);

    expect(process.env.QUOTED).toBe("value # with hash");
    delete process.env.QUOTED;
  });
});
