import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { ReceiptReview } from "@/components/receipt-review";

jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
jest.mock("@/lib/session", () => ({
  useSession: () => ({ userId: "user", workspaceId: "workspace", request: jest.fn() }),
}));
jest.mock("@/offline/store", () => ({ nativeOperation: jest.fn() }));
jest.mock("@/lib/resources", () => ({ detailHref: jest.fn() }));
jest.mock("@/components/ui", () => {
  const React = jest.requireActual("react");
  const { View, Text, TextInput, Pressable } = jest.requireActual("react-native");
  return {
    Group: ({ children }: any) => <View>{children}</View>,
    Copy: ({ children }: any) => <Text>{children}</Text>,
    Field: ({ label, onChangeText, value }: any) => (
      <TextInput accessibilityLabel={label} onChangeText={onChangeText} value={value} />
    ),
    Choice: () => null,
    ErrorNotice: () => null,
    Action: ({ title, onPress }: any) => (
      <Pressable onPress={onPress}>
        <Text>{title}</Text>
      </Pressable>
    ),
  };
});
const result = {
  merchant: "Cafe",
  totalCents: 1234,
  taxCents: 112,
  date: "2026-10-25",
  currency: "NZD",
};
it("hydrates extraction arriving after processing without overwriting subsequent corrections", async () => {
  const view = await render(
    <ReceiptReview receipt={{ id: "receipt", processing: true }} onSaved={jest.fn()} />,
  );
  await view.rerender(
    <ReceiptReview
      receipt={{ id: "receipt", processing: false, extractedData: result }}
      onSaved={jest.fn()}
    />,
  );
  expect(screen.getByLabelText("Description *").props.value).toBe("Cafe");
  expect(screen.getByLabelText("Total amount *").props.value).toBe("12.34");
  await fireEvent.changeText(screen.getByLabelText("Description *"), "Corrected merchant");
  await view.rerender(
    <ReceiptReview
      receipt={{ id: "receipt", extractedData: { ...result, merchant: "Reprocessed" } }}
      onSaved={jest.fn()}
    />,
  );
  expect(screen.getByLabelText("Description *").props.value).toBe("Corrected merchant");
});
it("binds corrections to receipt identity and preserves edits made before extraction arrives", async () => {
  const view = await render(<ReceiptReview receipt={{ id: "one" }} onSaved={jest.fn()} />);
  await fireEvent.changeText(screen.getByLabelText("Description *"), "My correction");
  await view.rerender(
    <ReceiptReview receipt={{ id: "one", extractedData: result }} onSaved={jest.fn()} />,
  );
  expect(screen.getByLabelText("Description *").props.value).toBe("My correction");
  expect(screen.getByLabelText("Total amount *").props.value).toBe("12.34");
  await view.rerender(
    <ReceiptReview
      receipt={{ id: "two", extractedData: { ...result, merchant: "Second receipt" } }}
      onSaved={jest.fn()}
    />,
  );
  expect(screen.getByLabelText("Description *").props.value).toBe("Second receipt");
});
