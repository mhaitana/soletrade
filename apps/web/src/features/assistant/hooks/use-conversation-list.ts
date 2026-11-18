"use client";

import { useEffect, useRef, useState } from "react";
import type { ConversationSummary } from "@/lib/domain/conversations/conversations-types";
import {
  listConversationsAction,
  type ConversationListPage,
} from "@/features/assistant/api/actions";

/** How long typing must pause before a search is sent. */
const SEARCH_DELAY_MS = 250;

/** What a request returned, with the search (and first page) it answers. */
type Fetched = ConversationListPage & { term: string; after: string };

function dedupe(conversations: ConversationSummary[]): ConversationSummary[] {
  const seen = new Set<string>();
  return conversations.filter((c) => {
    if (seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });
}

/**
 * The conversation list behind the side panel's History and the assistant page's list:
 * the newest page, a title search, and "show more" for older ones.
 *
 * `firstPage` is the newest page when the server already rendered it (the assistant page,
 * where it refreshes after every reply). Without it (the panel) the hook loads that page
 * itself. A search or "show more" is fetched here and replaces what is shown.
 */
export function useConversationList(firstPage?: ConversationListPage) {
  const [query, setQuery] = useState("");
  const [term, setTerm] = useState("");
  // What a request returned, tagged with the search it answers. For the unsearched list
  // with a server-rendered first page, these are only the rows after that page.
  const [fetched, setFetched] = useState<Fetched | null>(null);
  // A failure belongs to the search it happened in: changing the search leaves it behind.
  const [failedTerm, setFailedTerm] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreFailedTerm, setMoreFailedTerm] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Rows removed here (deleted) before the server-rendered page catches up.
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set());
  const request = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => setTerm(query.trim()), query.trim() ? SEARCH_DELAY_MS : 0);
    return () => clearTimeout(timer);
  }, [query]);

  // The rows loaded after a server-rendered first page continue that exact page. When the
  // page changes (a new conversation, or an older one becoming the newest) a row can move
  // across the boundary, so those rows are dropped rather than shown with one missing.
  const firstPageKey = firstPage ? firstPage.conversations.map((c) => c.id).join(",") : "";
  const needsFetch = term !== "" || !firstPage;
  useEffect(() => {
    if (!needsFetch) return;
    const id = ++request.current;
    void (async () => {
      try {
        const page = await listConversationsAction({ search: term || undefined });
        if (id === request.current) {
          setFetched({ ...page, term, after: "" });
          setFailedTerm(null);
        }
      } catch {
        if (id === request.current) setFailedTerm(term);
      }
    })();
  }, [term, needsFetch, attempt]);

  const continuesFirstPage = term === "" && Boolean(firstPage);
  const answered =
    fetched?.term === term && (!continuesFirstPage || fetched.after === firstPageKey)
      ? fetched
      : null;
  const failed = needsFetch && failedTerm === term;
  const moreFailed = moreFailedTerm === term;
  // The unsearched list on the assistant page: the server's page, then anything loaded after it.
  const fromServer = term === "" && firstPage ? firstPage : null;
  const conversations = dedupe(
    fromServer
      ? [...fromServer.conversations, ...(answered?.conversations ?? [])]
      : (answered?.conversations ?? []),
  ).filter((c) => !removed.has(c.id));
  const hasMore = fromServer
    ? (answered?.hasMore ?? fromServer.hasMore)
    : (answered?.hasMore ?? false);
  const loading = needsFetch && !answered && !failed;

  async function showMore(): Promise<void> {
    if (loadingMore) return;
    const id = ++request.current;
    setLoadingMore(true);
    setMoreFailedTerm(null);
    try {
      // Deleted rows are gone on the server too, so what is on screen is the offset.
      const page = await listConversationsAction({
        search: term || undefined,
        offset: conversations.length,
      });
      if (id !== request.current) return;
      setFetched({
        term,
        after: continuesFirstPage ? firstPageKey : "",
        conversations: [...(answered?.conversations ?? []), ...page.conversations],
        hasMore: page.hasMore,
      });
    } catch {
      if (id === request.current) setMoreFailedTerm(term);
    } finally {
      setLoadingMore(false);
    }
  }

  return {
    /** The search box's text. */
    query,
    setQuery,
    /** The search the list currently answers ("" for the full list). */
    term,
    conversations,
    hasMore,
    /** The first page of this list or search is on its way. */
    loading,
    loadingMore,
    /** The first page could not be loaded. */
    failed,
    /** "Show more" could not load the next page; what is on screen stays. */
    moreFailed,
    showMore,
    retry() {
      setFailedTerm(null);
      setAttempt((current) => current + 1);
    },
    /** Drop a conversation that was just deleted. */
    remove(id: string) {
      setRemoved((current) => new Set(current).add(id));
    },
  };
}
