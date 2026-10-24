import { Row, StatusPill } from "@/components/ui";
import { render, screen } from "@testing-library/react-native";

// Row renders native Text/View only; these imported native controls are unused.
jest.mock("@expo/ui", () => ({}));
jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));

it("shows a record status badge inside the row", async () => {
  await render(<Row title="Invoice 1042" badge={<StatusPill label="Overdue" />} />);
  expect(screen.getByText("Overdue")).toBeTruthy();
  expect(screen.getByText("Invoice 1042")).toBeTruthy();
});

it("renders a row without a badge", async () => {
  await render(<Row title="Customer" onPress={() => undefined} />);
  expect(screen.getByRole("button", { name: "Customer" })).toBeTruthy();
});
