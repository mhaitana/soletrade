import { beforeEach, describe, expect, it, vi } from "vitest";

const { redirect, exchangeCodeForSession, ensureUserMirror, tryAdminContext } = vi.hoisted(() => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
  exchangeCodeForSession: vi.fn(),
  ensureUserMirror: vi.fn(),
  tryAdminContext: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect }));

vi.mock("@/shared/lib/supabase/server", () => ({
  createSupabaseServerClient: () => ({
    auth: { exchangeCodeForSession },
  }),
}));

vi.mock("@/platform/users", () => ({ ensureUserMirror }));

vi.mock("@/platform/admin/services/admin-auth", () => ({ tryAdminContext }));

import { GET } from "./route";

describe("GET /auth/callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    exchangeCodeForSession.mockResolvedValue({
      data: {
        user: {
          id: "user-1",
          email: "owner@example.com",
          user_metadata: {},
        },
      },
      error: null,
    });
    ensureUserMirror.mockResolvedValue(undefined);
    tryAdminContext.mockResolvedValue(null);
  });

  it("sends a regular user to the dashboard after exchanging a magic-link code", async () => {
    const request = new Request("https://workspace.soletrade.example/auth/callback?code=pkce-code");

    await expect(GET(request)).rejects.toThrow("REDIRECT:/dashboard");

    expect(exchangeCodeForSession).toHaveBeenCalledWith("pkce-code");
    expect(ensureUserMirror).toHaveBeenCalledWith({
      id: "user-1",
      email: "owner@example.com",
      fullName: null,
    });
  });
});
