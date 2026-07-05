import { describe, expect, it } from "vitest";
import { DRIVE_PLATFORMS, isDrivePlatform, platformLabel } from "./drive-platforms";

describe("drive-platforms catalog", () => {
  it("has a non-empty platform list", () => {
    expect(DRIVE_PLATFORMS.length).toBeGreaterThan(0);
  });

  it("has unique keys", () => {
    const keys = DRIVE_PLATFORMS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("includes the 'other' catch-all slug", () => {
    expect(DRIVE_PLATFORMS.some((p) => p.key === "other")).toBe(true);
  });

  it("isDrivePlatform validates slugs against the list", () => {
    expect(isDrivePlatform("uber")).toBe(true);
    expect(isDrivePlatform("doordash")).toBe(true);
    expect(isDrivePlatform("other")).toBe(true);
    // unknown slug
    expect(isDrivePlatform("nope")).toBe(false);
    // empty string
    expect(isDrivePlatform("")).toBe(false);
  });

  it("platformLabel returns the human label or null", () => {
    expect(platformLabel("uber")).toBe("Uber");
    expect(platformLabel("uber_eats")).toBe("Uber Eats");
    expect(platformLabel("unknown")).toBeNull();
  });
});
