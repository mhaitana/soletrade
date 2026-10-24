import { MoneyScreen } from "@/features/books/screens/money";
import { DriveScreen } from "@/features/drive/screens/drive";
import { ResourceListScreen } from "@/features/records/components/resources";
import { SalesScreen } from "@/features/sales/screens/sales";
import { useResource } from "@/lib/resources";
import { fireEvent, render, screen } from "@testing-library/react-native";

const mockResource = {
  data: undefined,
  loading: true,
  error: "Connection lost",
  refresh: jest.fn(),
};
jest.mock("expo-router", () => ({
  router: { push: jest.fn() },
  useLocalSearchParams: () => ({ resource: "drive%2Ftrips" }),
}));
jest.mock("@expo/ui", () => {
  const React = jest.requireActual("react");
  const { View, Text, Pressable } = jest.requireActual("react-native");
  const Picker = ({ children, onValueChange }: any) => (
    <View>
      {React.Children.map(children, (child: any) =>
        React.cloneElement(child, { onSelect: () => onValueChange(child.props.value) }),
      )}
    </View>
  );
  Picker.Item = function PickerItem({ label, onSelect }: any) {
    return (
      <Pressable onPress={onSelect}>
        <Text>{label}</Text>
      </Pressable>
    );
  };
  return {
    Host: ({ children }: any) => <View>{children}</View>,
    Button: ({ label, onPress }: any) => (
      <Pressable onPress={onPress}>
        <Text>{label}</Text>
      </Pressable>
    ),
    Switch: ({ label, value, onValueChange }: any) => (
      <Pressable onPress={() => onValueChange(!value)}>
        <Text>{label}</Text>
      </Pressable>
    ),
    Picker,
  };
});
jest.mock("@/lib/session", () => ({
  useSession: () => ({
    userId: "user",
    workspaceId: "workspace",
    bootstrap: {
      activeWorkspace: {
        modules: ["books", "drive", "invoices", "quotes"],
        capabilities: ["view:books", "view:drive"],
        settings: { fyStartMonth: 7, defaultCurrency: "AUD" },
      },
    },
  }),
}));
jest.mock("@/lib/resources", () => ({
  ...jest.requireActual("@/lib/resources"),
  useResource: jest.fn(() => mockResource),
}));
jest.mock("@/lib/api", () => ({}));
jest.mock("@/lib/offline/store", () => ({}));
jest.mock("@/lib/native/widgets", () => ({}));
jest.mock("@/components/sign-out-button", () => ({ SignOutButton: () => null }));
jest.mock("@/components/reference-field", () => ({ ReferenceField: () => null }));
jest.mock("@/components/receipt-review", () => ({ ReceiptReview: () => null }));

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  jest.setSystemTime(new Date("2026-10-25T01:00:00.000Z"));
});
afterEach(() => jest.useRealTimers());

it.each([
  ["Money", MoneyScreen, "books"],
  ["Drive", DriveScreen, "drive"],
])(
  "keeps the %s summary request stable while loading and updates it when the period changes",
  async (_name, Component, module) => {
    const view = await render(<Component />);
    const path = jest.mocked(useResource).mock.lastCall![0]!;
    expect(path).toContain(`/workspaces/workspace/${module}/summary?`);
    expect(new URL(path, "https://test.example").searchParams.get("dateFrom")).toBe(
      "2026-07-01T00:00:00.000Z",
    );
    jest.setSystemTime(new Date("2026-10-25T01:00:05.000Z"));
    await view.rerender(<Component />);
    expect(jest.mocked(useResource).mock.lastCall![0]).toBe(path);
    await fireEvent.press(screen.getByText("This month"));
    const next = new URL(jest.mocked(useResource).mock.lastCall![0]!, "https://test.example");
    expect(next.searchParams.get("dateFrom")).toBe("2026-10-01T00:00:00.000Z");
    expect(next.searchParams.get("dateTo")).toBe("2026-10-25T01:00:05.000Z");
    jest.setSystemTime(new Date("2026-10-25T01:00:10.000Z"));
    await fireEvent.press(screen.getByText("Try again"));
    const refreshed = new URL(jest.mocked(useResource).mock.lastCall![0]!, "https://test.example");
    expect(refreshed.searchParams.get("dateTo")).toBe("2026-10-25T01:00:10.000Z");
    expect(mockResource.refresh).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByText("Try again"));
    expect(mockResource.refresh).toHaveBeenCalledTimes(1);
  },
);

it("keeps a dated list request stable when a filter rerenders its loading state", async () => {
  const view = await render(<ResourceListScreen />);
  await fireEvent.press(screen.getByText("Show filters"));
  await fireEvent.press(screen.getByText("This month"));
  const path = jest.mocked(useResource).mock.lastCall![0]!;
  expect(new URL(path, "https://test.example").searchParams.get("dateFrom")).toBe(
    "2026-10-01T00:00:00.000Z",
  );
  jest.setSystemTime(new Date("2026-10-25T01:00:05.000Z"));
  await view.rerender(<ResourceListScreen />);
  expect(jest.mocked(useResource).mock.lastCall![0]).toBe(path);
  await fireEvent.changeText(screen.getByLabelText("Search mileage"), "delivery");
  const filtered = new URL(jest.mocked(useResource).mock.lastCall![0]!, "https://test.example");
  expect(filtered.searchParams.get("search")).toBe("delivery");
  expect(filtered.searchParams.get("dateTo")).toBe("2026-10-25T01:00:00.000Z");
  await fireEvent.press(screen.getByText("Try again"));
  const refreshed = new URL(jest.mocked(useResource).mock.lastCall![0]!, "https://test.example");
  expect(refreshed.searchParams.get("dateTo")).toBe("2026-10-25T01:00:05.000Z");
  expect(refreshed.searchParams.get("search")).toBe("delivery");
  expect(mockResource.refresh).not.toHaveBeenCalled();
  await fireEvent.changeText(screen.getByLabelText("To date"), "2026-10-25");
  const explicitPath = jest.mocked(useResource).mock.lastCall![0];
  jest.setSystemTime(new Date("2026-10-25T01:00:10.000Z"));
  await fireEvent.press(screen.getByText("Try again"));
  expect(jest.mocked(useResource).mock.lastCall![0]).toBe(explicitPath);
  expect(mockResource.refresh).toHaveBeenCalledTimes(1);
});

it("renders Sales navigation within native views without raw text children", async () => {
  await render(<SalesScreen />);
  expect(screen.getByText("Customers")).toBeTruthy();
  expect(screen.getByText("Invoices")).toBeTruthy();
  expect(screen.getByText("Quotes")).toBeTruthy();
});
