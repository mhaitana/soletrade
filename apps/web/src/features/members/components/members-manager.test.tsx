import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MembersPageData } from "@/features/members/api/members";
import { MembersManager } from "@/features/members/components/members-manager";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/features/members/api/members", () => ({
  inviteMemberAction: vi.fn(),
  removeMemberAction: vi.fn(),
  resendInvitationAction: vi.fn(),
  revokeInvitationAction: vi.fn(),
  updateMemberRoleAction: vi.fn(),
}));

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("MembersManager dates", () => {
  it.each([
    {
      createdAt: "2025-07-01T00:30:00Z",
      expiresAt: "2025-07-08T00:30:00Z",
      joined: "01/07/2025",
      expires: "08/07/2025",
    },
    {
      createdAt: "2025-12-31T23:30:00-02:00",
      expiresAt: "2026-01-02T00:30:00+02:00",
      joined: "01/01/2026",
      expires: "01/01/2026",
    },
  ])("keeps UTC calendar dates stable through hydration for $createdAt", (dates) => {
    const initial: MembersPageData = {
      members: [
        {
          userId: "member",
          role: "employee",
          email: "member@example.test",
          createdAt: dates.createdAt,
        },
      ],
      invitations: [
        {
          id: "invitation",
          email: "invitee@example.test",
          role: "employee",
          status: "pending",
          createdAt: dates.createdAt,
          expiresAt: dates.expiresAt,
        },
      ],
      canInvite: false,
      canManage: false,
      currentUserId: "viewer",
      ownerId: "owner",
    };
    const element = <MembersManager initial={initial} />;
    const container = document.createElement("div");
    document.body.append(container);
    container.innerHTML = renderToString(element);

    expect(container).toHaveTextContent(`Member since ${dates.joined}`);
    expect(container).toHaveTextContent(`Expires ${dates.expires}`);

    // WebKit omits numeric padding when options are absent; Node adds it.
    // Reproduce that default change between SSR and hydration in any test timezone.
    const toLocaleDateString = Date.prototype.toLocaleDateString;
    vi.spyOn(Date.prototype, "toLocaleDateString").mockImplementation(function (
      this: Date,
      locales,
      options,
    ) {
      const formatted = toLocaleDateString.call(this, locales, options);
      return options ? formatted : formatted.replace(/\b0(?=\d)/g, "");
    });
    const onRecoverableError = vi.fn();
    render(element, { container, hydrate: true, onRecoverableError });

    expect(screen.getByText(`Member since ${dates.joined}`)).toBeInTheDocument();
    expect(screen.getByText(`Expires ${dates.expires}`)).toBeInTheDocument();
    expect(onRecoverableError).not.toHaveBeenCalled();
  });
});
