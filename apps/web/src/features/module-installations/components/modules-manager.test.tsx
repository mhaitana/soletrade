import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  disableModuleAction,
  previewCancelModuleAction,
  type ModulesPageData,
} from "@/features/module-installations/api/module-installations";
import { ModulesManager } from "@/features/module-installations/components/modules-manager";

const { refresh, toastSuccess } = vi.hoisted(() => ({ refresh: vi.fn(), toastSuccess: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("sonner", () => ({ toast: { success: toastSuccess } }));
vi.mock("@/features/module-installations/api/module-installations", () => ({
  disableModuleAction: vi.fn(),
  enableModuleAction: vi.fn(),
  previewAddModuleAction: vi.fn(),
  previewCancelModuleAction: vi.fn(),
  cancelModuleAction: vi.fn(),
  undoCancelModuleAction: vi.fn(),
}));

const initial = {
  installed: ["books"],
  pendingCancellations: [],
  canManage: true,
} as unknown as ModulesPageData;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
  vi.mocked(previewCancelModuleAction).mockResolvedValue({
    ok: true,
    moduleKey: "books",
    options: [{ option: "keep_until_end_of_cycle", amountCents: 0, recommended: true }],
  } as unknown as Awaited<ReturnType<typeof previewCancelModuleAction>>);
});

describe("ModulesManager disable confirmation", () => {
  it("asks before disabling a module with no billing impact, and keeps the dialog open on failure", async () => {
    vi.mocked(disableModuleAction)
      .mockResolvedValueOnce({ ok: false, error: "Cannot disable right now." })
      .mockResolvedValueOnce({ ok: true, moduleKey: "books" });
    const user = userEvent.setup();
    render(<ModulesManager initial={initial} />);

    await user.click(screen.getByRole("button", { name: "Disable Books" }));
    expect(await screen.findByText("Disable Books?")).toBeInTheDocument();
    expect(disableModuleAction).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Disable" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Cannot disable right now.");
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(screen.getByText("Disable Books?")).toBeInTheDocument();

    // The error can render a moment before the first attempt stops pending, while the
    // button still reads "Disabling…"; wait for it to come back before retrying.
    await user.click(await screen.findByRole("button", { name: "Disable" }));
    await waitFor(() => expect(screen.queryByText("Disable Books?")).not.toBeInTheDocument());
    expect(toastSuccess).toHaveBeenCalledWith("Books disabled");
    expect(refresh).toHaveBeenCalled();
  });
});
