import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { AppShell } from "./app-shell";
import type { WorkspaceId } from "@/shared/types/ids";

const panelModule = vi.hoisted(() => {
  type Module = { HaiAssistantPanel: () => null };
  let resolve: (module: Module) => void;
  const promise = new Promise<Module>((done) => {
    resolve = done;
  });
  return { promise, finish: () => resolve({ HaiAssistantPanel: () => null }) };
});

vi.mock("@/app/(app)/assistant/hai-assistant-panel", () => panelModule.promise);
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
