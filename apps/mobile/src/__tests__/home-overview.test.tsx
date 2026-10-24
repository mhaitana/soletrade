import React from "react";
import { render, screen, waitFor } from "@testing-library/react-native";
import { HomeScreen } from "@/screens/tabs";
import { clearWidgets, updateOverviewWidget } from "@/native/widgets";
const mockOverview = {
  workspaceId: "workspace",
  period: "month",
  periodLabel: "This month",
  currency: "AUD",
  totalIncome: { currentCents: 30000, previousCents: null, source: "books" },
  kpis: [
    { id: "income", label: "Total income", cents: 30000 },
    { id: "expenses", label: "Expenses", cents: 4000 },
    { id: "net-income", label: "Net income", cents: 26000 },
    { id: "outstanding", label: "Outstanding invoices", cents: 15000 },
  ],
  attention: [
    { id: "overdue", title: "Overdue invoices", count: 2, resource: "invoices", status: "overdue" },
    {
      id: "receipts",
      title: "Receipts to review",
      count: 4,
      resource: "books/receipts",
      status: "pending",
    },
  ],
};
let mockState: any;
const mockActive = {
  id: "workspace",
  name: "Business",
  modules: ["invoices", "books", "drive"],
  capabilities: ["view:invoice", "view:books", "manage:books", "view:activity", "create:drive"],
  settings: {},
  unreadCount: 0,
};
jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
jest.mock("expo-linking", () => ({}));
jest.mock("@expo/ui", () => ({}));
jest.mock("@/screens/auth", () => ({ SignOutButton: () => null }));
jest.mock("@/screens/resources", () => ({ RecordFields: () => null, shareBinary: jest.fn() }));
jest.mock("@/components/trends", () => ({ SummaryView: () => null }));
jest.mock("@/native/widgets", () => ({
  updateOverviewWidget: jest.fn(async () => undefined),
  clearWidgets: jest.fn(async () => undefined),
}));
jest.mock("@/lib/session", () => ({
  useSession: () => ({
    userId: "user",
    workspaceId: "workspace",
    bootstrap: { user: { fullName: "Mina" }, activeWorkspace: mockActive },
  }),
}));
jest.mock("@/lib/resources", () => ({
  useResource: () => mockState,
  useWorkspacePath: () => "/workspaces/workspace/dashboard",
  listHref: (resource: string) => `/resource/${encodeURIComponent(resource)}`,
  detailHref: (resource: string, id: string) => `/resource/${resource}/${id}`,
}));
jest.mock("@/components/ui", () => {
  const React = jest.requireActual("react");
  const { View, Text } = jest.requireActual("react-native");
  return {
    Screen: ({ children }: any) => <View>{children}</View>,
    Copy: ({ children }: any) => <Text>{children}</Text>,
    Group: ({ title, children }: any) => (
      <View>
        <Text>{title}</Text>
        {children}
      </View>
    ),
    Row: ({ title, subtitle, trailing }: any) => (
      <View>
        <Text>{title}</Text>
        <Text>{subtitle}</Text>
        <Text>{trailing}</Text>
      </View>
    ),
    KpiTile: ({ label, value }: any) => (
      <View>
        <Text>{label}</Text>
        <Text>{value}</Text>
      </View>
    ),
    StatusPill: ({ label }: any) => <Text>{label}</Text>,
    NavRow: ({ title, subtitle, href }: any) => (
      <View accessibilityLabel={href}>
        <Text>{title}</Text>
        <Text>{subtitle}</Text>
      </View>
    ),
    Choice: () => null,
    Loading: () => null,
    ErrorNotice: () => null,
    human: (value: string) => value.replace(/([a-z])([A-Z])/g, "$1 $2"),
    formatMoney: (value: number, currency: string) => `${currency} ${(value / 100).toFixed(2)}`,
  };
});
beforeEach(() => {
  jest.clearAllMocks();
  mockState = {
    data: {
      overview: mockOverview,
      invoices: { paidCents: 999 },
      activity: Array.from({ length: 7 }, (_, index) => ({
        id: `event-${index}`,
        type: `InvoicePaid${index}`,
        actorFullName: "Mina",
        createdAt: "2026-10-25T00:00:00Z",
      })),
    },
    syncedAt: 1000,
    cached: true,
    loading: false,
  };
});
it("renders bounded canonical financial totals, actionable attention and five recent events", async () => {
  await render(<HomeScreen />);
  expect(screen.getByText("Total income")).toBeTruthy();
  expect(screen.getByText("AUD 300.00")).toBeTruthy();
  expect(screen.queryByText("Paid cents")).toBeNull();
  expect(screen.getByText("Overdue invoices")).toBeTruthy();
  expect(screen.getByLabelText("/resource/invoices?status=overdue")).toBeTruthy();
  expect(screen.getByLabelText("/resource/books%2Freceipts?status=pending")).toBeTruthy();
  expect(screen.getByText("Invoice Paid4")).toBeTruthy();
  expect(screen.queryByText("Invoice Paid5")).toBeNull();
  expect(screen.getByText("Capture a receipt")).toBeTruthy();
  expect(screen.getByText("Start or review a shift")).toBeTruthy();
  await waitFor(() =>
    expect(updateOverviewWidget).toHaveBeenCalledWith(
      { userId: "user", workspaceId: "workspace" },
      {
        workspaceName: "Business",
        summary: "This month · Income AUD 300.00 · Expenses AUD 40.00",
        syncedAt: 1000,
      },
    ),
  );
});
it("never displays or writes an overview from another workspace", async () => {
  mockState.data.overview = { ...mockOverview, workspaceId: "other-workspace" };
  await render(<HomeScreen />);
  expect(screen.queryByText("AUD 300.00")).toBeNull();
  expect(screen.queryByText("Invoice Paid0")).toBeNull();
  expect(updateOverviewWidget).not.toHaveBeenCalled();
});
it("hides financial attention and activity after authoritative denial", async () => {
  mockState = { loading: false, denied: true, error: "Module unavailable" };
  await render(<HomeScreen />);
  expect(screen.queryByText("Overdue invoices")).toBeNull();
  expect(screen.queryByText("Total income")).toBeNull();
  expect(updateOverviewWidget).not.toHaveBeenCalled();
  expect(clearWidgets).toHaveBeenCalled();
});
