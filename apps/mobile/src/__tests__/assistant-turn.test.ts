import { prepareAssistantTurn } from "@/lib/assistant-turn";
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
