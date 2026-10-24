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
