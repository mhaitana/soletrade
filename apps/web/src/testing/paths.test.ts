import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { repositoryRoot, webRoot } from "./paths";

describe("test workspace paths", () => {
  it("resolves real workspace directories in the default jsdom environment", () => {
    const webPackage = JSON.parse(readFileSync(join(webRoot, "package.json"), "utf8"));
    const repositoryPackage = JSON.parse(
      readFileSync(join(repositoryRoot, "package.json"), "utf8"),
    );

    expect(webPackage.name).toBe("@soletrade/web");
    expect(repositoryPackage.name).toBe("soletrade");
    expect(relative(repositoryRoot, webRoot)).toBe(join("apps", "web"));
  });
});
