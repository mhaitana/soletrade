import { describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));
vi.mock("next/navigation", () => navigation);

import LegacyInviteRedirect from "@/features/members/components/pages/invite/legacy-redirect";

describe("legacy /invite?token= links", () => {
  it("forwards an emailed query-string link to the path-based accept page", async () => {
    await expect(
      LegacyInviteRedirect({ searchParams: Promise.resolve({ token: "tok-1" }) }),
    ).rejects.toThrow("REDIRECT:/invite/tok-1");
  });

  it("encodes the token and uses the first value when it is repeated", async () => {
    await expect(
      LegacyInviteRedirect({ searchParams: Promise.resolve({ token: ["a b/c", "ignored"] }) }),
    ).rejects.toThrow("REDIRECT:/invite/a%20b%2Fc");
  });

  it("shows not-found when there is no token", async () => {
    await expect(LegacyInviteRedirect({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      "NOT_FOUND",
    );
    await expect(
      LegacyInviteRedirect({ searchParams: Promise.resolve({ token: "  " }) }),
    ).rejects.toThrow("NOT_FOUND");
  });
});
