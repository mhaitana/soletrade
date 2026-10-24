import { describe, expect, it } from "vitest";
import { safeNext } from "@/lib/safe-redirect";

describe("safeNext (open-redirect guard)", () => {
  it("returns null for empty/undefined/null", () => {
    expect(safeNext(undefined)).toBeNull();
    expect(safeNext(null)).toBeNull();
    expect(safeNext("")).toBeNull();
  });

  it("accepts same-origin paths", () => {
    expect(safeNext("/dashboard")).toBe("/dashboard");
    expect(safeNext("/onboarding")).toBe("/onboarding");
    expect(safeNext("/customers/abc/edit")).toBe("/customers/abc/edit");
    expect(safeNext("/")).toBe("/");
  });

  it("rejects protocol-relative URLs (//evil.com)", () => {
    expect(safeNext("//evil.com")).toBeNull();
    expect(safeNext("//evil.com/path")).toBeNull();
  });

  it("rejects absolute schemes", () => {
    expect(safeNext("https://evil.com")).toBeNull();
    expect(safeNext("http://evil.com")).toBeNull();
    expect(safeNext("javascript:alert(1)")).toBeNull();
  });

  it("rejects backslash-prefixed paths", () => {
    expect(safeNext("/\\evil.com")).toBeNull();
  });

  it("rejects relative paths without a leading slash", () => {
    expect(safeNext("dashboard")).toBeNull();
    expect(safeNext("evil.com")).toBeNull();
  });
});
