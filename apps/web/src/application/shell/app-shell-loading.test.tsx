import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { AppShell } from "@/application/shell/app-shell";
import type { WorkspaceId } from "@/types/ids";

const panelModule = vi.hoisted(() => {
  type Module = { HaiAssistantPanel: () => null };
  let resolve: (module: Module) => void;
  const promise = new Promise<Module>((done) => {
    resolve = done;
  });
  return { promise, finish: () => resolve({ HaiAssistantPanel: () => null }) };
});

vi.mock("@/features/assistant/components/hai-assistant-panel", () => panelModule.promise);
vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard" }));
vi.mock("@/application/shell/workspace-switcher", () => ({ WorkspaceSwitcher: () => null }));
vi.mock("@/application/shell/account-menu", () => ({ AccountMenu: () => null }));
vi.mock("@/application/shell/quick-create-menu", () => ({ QuickCreateMenu: () => null }));
vi.mock("@/components/theme-toggle", () => ({ ThemeToggle: () => null }));
vi.mock("@/features/notifications/components/notification-bell", () => ({
  NotificationBell: () => null,
}));
vi.mock("@/features/search/components/search-trigger", () => ({
  SearchTrigger: () => null,
}));

it("allows keyboard dismissal during loading without refocusing when loading finishes", async () => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  const user = userEvent.setup();
  render(
    <AppShell
      workspaces={[]}
      activeWorkspaceId={"workspace" as WorkspaceId}
      installedModules={[]}
      role="owner"
      userEmail="owner@example.test"
      notificationCount={0}
    >
      <button>Continue working</button>
    </AppShell>,
  );
  const trigger = screen.getByRole("button", { name: "hAI" });
  await user.click(trigger);
  expect(await screen.findByRole("dialog", { name: "hAI global assistant" })).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent("Loading hAI");
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  await waitFor(() => expect(trigger).toHaveFocus());
  const workspace = screen.getByRole("button", { name: "Continue working" });
  await user.click(workspace);
  await act(async () => {
    panelModule.finish();
    await panelModule.promise;
  });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(workspace).toHaveFocus();
});
