import { prepareAssistantTurn, stoppedNotice } from "@/features/assistant/lib/assistant-turn";
it("reuses an uncertain turn on retry and starts a new operation when the user edits or changes conversation", () => {
  const uuid = jest
    .fn()
    .mockReturnValueOnce("first")
    .mockReturnValueOnce("edited")
    .mockReturnValueOnce("other");
  const first = prepareAssistantTurn(null, "conversation", " Confirm invoice ", uuid);
  expect(prepareAssistantTurn(first, "conversation", "Confirm invoice", uuid).operationId).toBe(
    "first",
  );
  expect(uuid).toHaveBeenCalledTimes(1);
  const edited = prepareAssistantTurn(first, "conversation", "Cancel instead", uuid);
  expect(edited.operationId).toBe("edited");
  expect(prepareAssistantTurn(edited, "other", "Cancel instead", uuid).operationId).toBe("other");
});
it("explains a stopped response differently before and after the server accepted the turn", () => {
  expect(stoppedNotice(true)).toMatch(/reloaded/);
  expect(stoppedNotice(false)).toMatch(/not repeat actions/);
});
it("keeps the operation id when the user stops before acceptance and sends the same text again", () => {
  const uuid = jest.fn().mockReturnValueOnce("first").mockReturnValueOnce("second");
  const turn = prepareAssistantTurn(null, "conversation", "Create the invoice", uuid);
  expect(prepareAssistantTurn(turn, "conversation", "Create the invoice", uuid)).toBe(turn);
});
