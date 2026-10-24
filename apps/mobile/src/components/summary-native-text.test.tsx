import { SummaryView } from "@/components/trends";
import { render, screen } from "@testing-library/react-native";
import { View } from "react-native";

// SummaryView uses the real Group/Row/Copy and RN Views/Text. None of its rendered
// controls use this native module, so only the unneeded import boundary is mocked.
jest.mock("@expo/ui", () => ({}));
jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));

it.each([
  ["an empty response", {}],
  [
    "Books and Drive chart sections",
    {
      netCents: 1200,
      monthly: [{ month: "2026-10", netCents: 1200 }],
      byCategory: [{ category: "supplies", amountCents: 1200 }],
      byPlatform: [{ platform: "other", earningsCents: 1200 }],
      weekly: [{ week: "2026-W43", earningsCents: 1200 }],
    },
  ],
])("renders %s inside a native View without raw text children", async (_label, summary) => {
  await render(
    <View>
      <SummaryView summary={summary} />
    </View>,
  );
  expect(screen.getByText("Period totals")).toBeTruthy();
  if ("byCategory" in summary) {
    expect(screen.getByText("By category")).toBeTruthy();
    expect(screen.getByText("Earnings by platform")).toBeTruthy();
    expect(screen.getByText("Weekly earnings")).toBeTruthy();
  }
});
