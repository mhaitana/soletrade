import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "./app-shell";
import type { WorkspaceId } from "@/shared/types/ids";

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

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard" }));
vi.mock("./workspace-switcher", () => ({ WorkspaceSwitcher: () => null }));
vi.mock("./account-menu", () => ({ AccountMenu: () => null }));
vi.mock("./quick-create-menu", () => ({ QuickCreateMenu: () => null }));
vi.mock("@/shared/components/theme-toggle", () => ({ ThemeToggle: () => null }));
vi.mock("@/shared/components/notification-bell/notification-bell", () => ({
  NotificationBell: () => null,
}));
vi.mock("@/shared/components/command-palette/search-trigger", () => ({
  SearchTrigger: () => null,
}));

// Stand in for the network-backed assistant. Its local input state proves that
// closing the shell's panel does not discard a draft or remount a conversation.
vi.mock("@/app/(app)/assistant/hai-assistant-panel", async () => {
  const { useState } = await import("react");
  return {
    HaiAssistantPanel: ({ open }: { open: boolean }) => {
      const [draft, setDraft] = useState("");
      return (
        <aside hidden={!open} aria-label="hAI global assistant">
          <input
            aria-label="Assistant draft"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        </aside>
      );
    },
  };
});

describe("AppShell assistant lifecycle", () => {
  it("starts a fresh assistant when the active workspace changes", async () => {
    const shell = (workspace: string) => (
      <AppShell
        workspaces={[]}
        activeWorkspaceId={workspace as WorkspaceId}
        installedModules={[]}
        role="owner"
        userEmail="owner@example.test"
        notificationCount={0}
      >
        <h1>Dashboard</h1>
      </AppShell>
    );
    const { rerender } = render(shell("first-workspace"));
    fireEvent.click(screen.getByRole("button", { name: "hAI" }));
    const draft = await screen.findByLabelText("Assistant draft");
    fireEvent.change(draft, { target: { value: "First workspace's customer details" } });

    rerender(shell("second-workspace"));

    expect(screen.getByLabelText("Assistant draft")).toHaveValue("");
    expect(draft).not.toBeInTheDocument();
  });

  it("starts the assistant only when requested and retains its draft after reopening", async () => {
    render(
      <AppShell
        workspaces={[]}
        activeWorkspaceId={"workspace" as WorkspaceId}
        installedModules={["invoices", "books", "drive", "quotes"]}
        role="owner"
        userEmail="owner@example.test"
        notificationCount={0}
      >
        <h1>Dashboard</h1>
      </AppShell>,
    );

    expect(screen.queryByLabelText("Assistant draft")).not.toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: "hAI" });
    fireEvent.click(toggle);
    const draft = await screen.findByLabelText("Assistant draft");
    fireEvent.change(draft, { target: { value: "Help with my invoice" } });
    fireEvent.click(toggle);
    expect(draft).not.toBeVisible();
    fireEvent.click(toggle);
    await waitFor(() => expect(draft).toBeVisible());
    expect(screen.getByLabelText("Assistant draft")).toHaveValue("Help with my invoice");
  });
});
