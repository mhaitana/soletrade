import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useConversationList } from "@/features/assistant/hooks/use-conversation-list";
import {
  listConversationsAction,
  type ConversationListPage,
} from "@/features/assistant/api/actions";

vi.mock("@/features/assistant/api/actions", () => ({ listConversationsAction: vi.fn() }));

const row = (n: number) => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  title: `Conversation ${n}`,
  updatedAt: new Date("2026-11-18T09:00:00Z"),
});
const page = (numbers: number[], hasMore: boolean) =>
  ({ conversations: numbers.map(row), hasMore }) as unknown as ConversationListPage;
const titles = (conversations: { title: string }[]) => conversations.map((c) => c.title);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useConversationList on a server-rendered first page", () => {
  it("leaves a failed search's error behind when the search is cleared", async () => {
    vi.mocked(listConversationsAction).mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useConversationList(page([1, 2], false)));

    act(() => result.current.setQuery("invoice"));
    await waitFor(() => expect(result.current.failed).toBe(true));

    act(() => result.current.setQuery(""));
    // Back on the list the server rendered: nothing to fetch, so nothing has failed.
    await waitFor(() => expect(result.current.term).toBe(""));
    expect(result.current.failed).toBe(false);
    expect(titles(result.current.conversations)).toEqual(["Conversation 1", "Conversation 2"]);
  });

  it("drops rows loaded after the first page when that page changes", async () => {
    vi.mocked(listConversationsAction).mockResolvedValue(page([3], false));
    const { result, rerender } = renderHook(
      ({ first }: { first: ConversationListPage }) => useConversationList(first),
      { initialProps: { first: page([1, 2], true) } },
    );

    await act(() => result.current.showMore());
    expect(listConversationsAction).toHaveBeenCalledWith({ search: undefined, offset: 2 });
    expect(titles(result.current.conversations)).toEqual([
      "Conversation 1",
      "Conversation 2",
      "Conversation 3",
    ]);
    expect(result.current.hasMore).toBe(false);

    // A new conversation arrives on top and pushes "Conversation 2" off the first page.
    // The rows loaded earlier continued the old page; shown as they are, row 2 would be
    // in neither part of the list.
    rerender({ first: page([9, 1], true) });
    expect(titles(result.current.conversations)).toEqual(["Conversation 9", "Conversation 1"]);
    expect(result.current.hasMore).toBe(true);
  });

  it("keeps a deleted row out until the server's page catches up", () => {
    const { result } = renderHook(() => useConversationList(page([1, 2], false)));

    act(() => result.current.remove(row(1).id));
    expect(titles(result.current.conversations)).toEqual(["Conversation 2"]);
  });
});

describe("useConversationList without a first page", () => {
  it("loads the list itself and searches after a pause in typing", async () => {
    vi.mocked(listConversationsAction).mockImplementation(async (input) =>
      (input as { search?: string }).search ? page([2], false) : page([1, 2], false),
    );
    const { result } = renderHook(() => useConversationList());

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.conversations).toHaveLength(2));

    act(() => result.current.setQuery("two"));
    await waitFor(() =>
      expect(listConversationsAction).toHaveBeenLastCalledWith({ search: "two" }),
    );
    await waitFor(() => expect(titles(result.current.conversations)).toEqual(["Conversation 2"]));
  });
});
