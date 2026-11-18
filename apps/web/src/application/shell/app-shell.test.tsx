import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "@/application/shell/app-shell";
import { askHai } from "@/lib/assistant/launcher";
import type { WorkspaceId } from "@/types/ids";
import type { WorkspaceRole } from "@/lib/domain/database-enums";

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Element.prototype.scrollIntoView = vi.fn();
});

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("next/dynamic", async () => {
  const { CommandPalette } = await import("@/features/search/components/command-palette");
  return { default: () => CommandPalette };
});
vi.mock("@/application/shell/workspace-switcher", () => ({ WorkspaceSwitcher: () => null }));
vi.mock("@/application/shell/account-menu", () => ({ AccountMenu: () => null }));
vi.mock("@/application/shell/quick-create-menu", () => ({ QuickCreateMenu: () => null }));
vi.mock("@/components/theme-toggle", () => ({ ThemeToggle: () => null }));
vi.mock("@/features/notifications/components/notification-bell", () => ({
  NotificationBell: () => null,
}));

// Stand in for the network-backed assistant. Its local input state proves that
// closing the shell's panel does not discard a draft or remount a conversation.
vi.mock("@/features/assistant/components/hai-assistant-panel", async () => {
  const { useState } = await import("react");
  return {
    HaiAssistantPanel: ({ open, ask }: { open: boolean; ask?: { question?: string } | null }) => {
      const [draft, setDraft] = useState("");
      return (
        <aside hidden={!open} aria-label="hAI global assistant" data-asked={ask?.question}>
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

it("opens the assistant with a question asked from elsewhere in the app", async () => {
  render(
    <AppShell
      workspaces={[]}
      activeWorkspaceId={"workspace" as WorkspaceId}
      installedModules={[]}
      role="owner"
      userEmail="owner@example.com"
      notificationCount={0}
    >
      <p>Page</p>
    </AppShell>,
  );
  expect(screen.queryByLabelText("hAI global assistant")).not.toBeInTheDocument();

  act(() => askHai({ question: "Summarise this invoice", send: true }));

  const panel = await screen.findByLabelText("hAI global assistant");
  expect(panel).toBeVisible();
  expect(panel).toHaveAttribute("data-asked", "Summarise this invoice");
});

it("does not carry a question into another workspace", async () => {
  const shell = (workspace: string) => (
    <AppShell
      workspaces={[]}
      activeWorkspaceId={workspace as WorkspaceId}
      installedModules={[]}
      role="owner"
      userEmail="owner@example.com"
      notificationCount={0}
    >
      <p>Page</p>
    </AppShell>
  );
  const { rerender } = render(shell("first-workspace"));
  act(() => askHai({ question: "Summarise this invoice", send: true }));
  expect(await screen.findByLabelText("hAI global assistant")).toHaveAttribute(
    "data-asked",
    "Summarise this invoice",
  );

  // Switching workspace remounts the assistant; the old question must not reach it,
  // or it would be sent again there.
  rerender(shell("second-workspace"));
  await waitFor(() =>
    expect(screen.getByLabelText("hAI global assistant")).not.toHaveAttribute("data-asked"),
  );
});

it("removes Audit log from navigation and open search when the workspace role changes", () => {
  const installedModules: [] = [];
  const shell = (role: WorkspaceRole) => (
    <AppShell
      workspaces={[]}
      activeWorkspaceId={"workspace" as WorkspaceId}
      installedModules={installedModules}
      role={role}
      userEmail="member@example.test"
      notificationCount={0}
    >
      <h1>Dashboard</h1>
    </AppShell>
  );
  const { rerender } = render(shell("owner"));
  expect(screen.getByRole("link", { name: "Audit log" })).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Search (⌘K)" }));
  expect(screen.getByRole("option", { name: "Audit log" })).toBeInTheDocument();

  rerender(shell("readonly"));

  expect(screen.queryAllByText("Audit log", { exact: true })).toHaveLength(0);
  expect(screen.getByRole("option", { name: "Dashboard" })).toBeInTheDocument();
});
