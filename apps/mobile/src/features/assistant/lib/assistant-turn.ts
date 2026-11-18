export type AssistantTurn = { conversationId: string; message: string; operationId: string };
export function prepareAssistantTurn(
  previous: AssistantTurn | null,
  conversationId: string,
  message: string,
  newId: () => string,
): AssistantTurn {
  const normalized = message.trim();
  if (previous?.conversationId === conversationId && previous.message === normalized)
    return previous;
  return { conversationId, message: normalized, operationId: newId() };
}
/** What to tell the user after they stop a response. `accepted` means the server took the turn. */
export function stoppedNotice(accepted: boolean) {
  return accepted
    ? "Stopped. The conversation was reloaded; hAI may have saved part of its reply."
    : "Stopped before hAI replied. Your message is kept, and sending it again will not repeat actions.";
}
