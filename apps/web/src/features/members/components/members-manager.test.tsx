import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MembersPageData } from "@/features/members/api/members";
import {
  removeMemberAction,
  revokeInvitationAction,
  updateMemberRoleAction,
} from "@/features/members/api/members";
import { MembersManager } from "@/features/members/components/members-manager";

const { refresh, toastSuccess } = vi.hoisted(() => ({ refresh: vi.fn(), toastSuccess: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("sonner", () => ({ toast: { success: toastSuccess } }));
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

describe("MembersManager confirmations", () => {
  const manageable: MembersPageData = {
    members: [
      {
        userId: "member",
        role: "employee",
        email: "member@example.test",
        createdAt: "2025-07-01T00:00:00Z",
      },
    ],
    invitations: [
      {
        id: "invitation",
        email: "invitee@example.test",
        role: "employee",
        status: "pending",
        createdAt: "2025-07-01T00:00:00Z",
        expiresAt: "2025-07-08T00:00:00Z",
      },
    ],
    canInvite: false,
    canManage: true,
    currentUserId: "viewer",
    ownerId: "owner",
  };

  it("asks before changing a role, keeps the dialog open on failure and closes on success", async () => {
    vi.mocked(updateMemberRoleAction)
      .mockResolvedValueOnce({ ok: false, error: "Not allowed." })
      .mockResolvedValueOnce({ ok: true });
    const user = userEvent.setup();
    render(<MembersManager initial={manageable} />);

    await user.selectOptions(screen.getByLabelText("Change role for member@example.test"), "admin");
    expect(updateMemberRoleAction).not.toHaveBeenCalled();
    expect(screen.getByText("Change role?")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Change role" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Not allowed.");
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(screen.getByText("Change role?")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Change role" }));
    await waitFor(() => expect(screen.queryByText("Change role?")).not.toBeInTheDocument());
    expect(updateMemberRoleAction).toHaveBeenLastCalledWith({ userId: "member", role: "admin" });
    expect(toastSuccess).toHaveBeenCalledWith("Role changed");
  });

  it("asks before revoking an invitation", async () => {
    vi.mocked(revokeInvitationAction).mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<MembersManager initial={manageable} />);

    await user.click(
      screen.getByRole("button", { name: "Revoke invitation to invitee@example.test" }),
    );
    expect(revokeInvitationAction).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Revoke invitation" }));
    await waitFor(() =>
      expect(revokeInvitationAction).toHaveBeenCalledWith({ invitationId: "invitation" }),
    );
    expect(toastSuccess).toHaveBeenCalledWith("Invitation revoked");
  });

  it("removes a member only after confirmation", async () => {
    vi.mocked(removeMemberAction).mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<MembersManager initial={manageable} />);

    await user.click(screen.getByRole("button", { name: "Remove member@example.test" }));
    expect(removeMemberAction).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(removeMemberAction).toHaveBeenCalledWith({ userId: "member" }));
    expect(toastSuccess).toHaveBeenCalledWith("Member removed");
  });
});
