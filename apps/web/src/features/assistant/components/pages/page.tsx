import { loadAssistantPage } from "@/features/assistant/api/actions";
import { AssistantChat } from "@/features/assistant/components/assistant-chat";

export const metadata = { title: "Assistant" };

/**
 * AI assistant page (Phase 10). The server loads the conversation sidebar + the active
 * conversation (via `?c=<id>`) and hands them to the client chat component, which uses
 * the AI SDK `useChat` hook against `POST /api/assistant`. `key={c}` forces a clean
 * remount when switching conversations so the hook re-initializes with the right history.
 */
export default async function AssistantPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string | string[] }>;
}) {
  const sp = await searchParams;
  const c = typeof sp.c === "string" ? sp.c : undefined;
  const data = await loadAssistantPage({ conversationId: c });
  return (
    <AssistantChat
      key={c ?? "new"}
      initialConversations={data.conversations}
      activeConversation={data.activeConversation}
    />
  );
}
