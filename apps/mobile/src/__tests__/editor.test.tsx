import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { DocumentForm, EditorScreen } from "@/screens/editor";
import { createDraft } from "@/offline/store";

jest.mock("expo-router", () => ({
  router: { back: jest.fn(), push: jest.fn() },
  useLocalSearchParams: () => ({ resource: "customers", id: "new" }),
}));
jest.mock("@expo/ui/community/datetime-picker", () => ({ __esModule: true, default: () => null }));
jest.mock("expo-crypto", () => ({ randomUUID: () => "a107a043-d769-4c46-b999-0705d7734134" }));
jest.mock("@expo/ui", () => {
  const React = jest.requireActual("react");
  const { View, Pressable, Text } = jest.requireActual("react-native");
  return {
    Host: ({ children }: any) => <View>{children}</View>,
    Button: ({ label, onPress, disabled }: any) => (
      <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress}>
        <Text>{label}</Text>
      </Pressable>
    ),
    Picker: Object.assign(({ children }: any) => <View>{children}</View>, {
      Item: ({ label }: any) => <Text>{label}</Text>,
    }),
    Switch: ({ label, value, onValueChange }: any) => (
      <Pressable
        accessibilityRole="switch"
        accessibilityState={{ checked: value }}
        onPress={() => onValueChange(!value)}
      >
        <Text>{label}</Text>
      </Pressable>
    ),
  };
});
jest.mock("@/lib/resources", () => ({
  useWorkspacePath: (resource: string) => `/workspaces/workspace/${resource}`,
  useResource: () => ({ data: undefined, loading: false, refresh: jest.fn() }),
}));
jest.mock("@/lib/session", () => ({
  useSession: () => ({
    userId: "user",
    workspaceId: "workspace",
    request: jest.fn(),
    bootstrap: {
      activeWorkspace: { capabilities: ["manage:customer"], settings: { defaultCurrency: "AUD" } },
    },
  }),
}));
jest.mock("@/offline/store", () => ({
  createDraft: jest.fn(),
  explicitSave: jest.fn(),
  listDrafts: jest.fn(),
  syncOutbox: jest.fn(),
}));

it("blocks an incomplete invoice and submits multiple line items with exact cents", async () => {
  const save = jest.fn().mockResolvedValue(undefined);
  await render(
    <DocumentForm
      resource="invoices"
      initial={{ issueDate: "2026-10-25", taxRate: 10, customerId: "customer" }}
      busy={false}
      onSave={save}
    />,
  );
  await fireEvent.press(screen.getByText("Save draft"));
  expect(screen.getByText("Check description, quantity and price on item 1.")).toBeTruthy();
  expect(save).not.toHaveBeenCalled();
  await fireEvent.changeText(screen.getByLabelText("Description *"), "Consultation");
  await fireEvent.changeText(screen.getByLabelText("Unit price *"), "12.34");
  await fireEvent.press(screen.getByText("Add line item"));
  await fireEvent.changeText(screen.getAllByLabelText("Description *")[1], "Travel");
  await fireEvent.changeText(screen.getAllByLabelText("Unit price *")[1], "5.50");
  await fireEvent.changeText(screen.getAllByLabelText("Quantity *")[1], "2");
  await fireEvent.press(screen.getByText("Save draft"));
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        lineItems: [
          { description: "Consultation", quantity: 1, unitPriceCents: 1234 },
          { description: "Travel", quantity: 2, unitPriceCents: 550 },
        ],
      }),
    ),
  );
});
it("keeps entered customer data after failed persistence and allows retry", async () => {
  jest
    .mocked(createDraft)
    .mockRejectedValue(new Error("Device storage is full. Free space and retry."));
  await render(<EditorScreen />);
  await fireEvent.changeText(screen.getByLabelText("Name *"), "Mina Nguyen");
  await fireEvent.changeText(screen.getByLabelText("Email"), "mina@example.com");
  await fireEvent.press(screen.getByText("Save"));
  await waitFor(() =>
    expect(screen.getByText("Device storage is full. Free space and retry.")).toBeTruthy(),
  );
  expect(screen.getByDisplayValue("Mina Nguyen")).toBeTruthy();
  expect(screen.getByDisplayValue("mina@example.com")).toBeTruthy();
  await fireEvent.press(screen.getByText("Save"));
  await waitFor(() => expect(createDraft).toHaveBeenCalledTimes(2));
});
