import { ReferenceField } from "@/components/reference-field";
import { LegalScreen } from "@/features/account/screens/legal";
import { SignInScreen, WorkspacesScreen } from "@/features/auth/screens/auth";
import { EditorScreen } from "@/features/records/components/editor";
import { catalog, formBody } from "@/config/resources";
import {
  correctRejectedDraft,
  createDraft,
  explicitSave,
  getDraft,
  listDrafts,
  syncOutbox,
} from "@/lib/offline/store";
import { useResource } from "@/lib/resources";
import { supabase } from "@/lib/supabase";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Alert } from "react-native";
const mockRequest = jest.fn();
const mockCloseAccount = jest.fn().mockResolvedValue(undefined);
const mockRefreshBootstrap = jest.fn().mockResolvedValue(undefined);
const mockSignOut = jest.fn().mockResolvedValue(undefined);
jest.mock("expo-router", () => ({
  router: { back: jest.fn(), push: jest.fn(), replace: jest.fn(), dismissTo: jest.fn() },
  useLocalSearchParams: jest.fn(),
}));
jest.mock("@/lib/supabase", () => ({
  configured: true,
  supabase: {
    auth: { signInWithPassword: jest.fn(), signInWithOtp: jest.fn(), signUp: jest.fn() },
  },
}));
jest.mock("expo-linking", () => ({
  createURL: () => "soletrade://auth/callback",
  openURL: jest.fn(),
}));
jest.mock("expo-crypto", () => ({ randomUUID: () => "a107a043-d769-4c46-b999-0705d7734134" }));
jest.mock("@/components/date-field", () => ({
  DateField: ({ label, value, onChange }: any) => {
    const { TextInput } = jest.requireActual("react-native");
    return <TextInput accessibilityLabel={label} value={value} onChangeText={onChange} />;
  },
}));
jest.mock("@/components/ui", () => {
  const { View, Text, TextInput, Pressable } = jest.requireActual("react-native");
  return {
    Screen: ({ children }: any) => <View>{children}</View>,
    Group: ({ children }: any) => <View>{children}</View>,
    Copy: ({ children }: any) => <Text>{children}</Text>,
    Loading: () => <Text>Loading</Text>,
    ErrorNotice: ({ message }: any) => <Text>{message}</Text>,
    Field: ({ label, ...props }: any) => <TextInput accessibilityLabel={label} {...props} />,
    Toggle: () => null,
    Action: ({ title, onPress, disabled }: any) => (
      <Pressable disabled={disabled} onPress={onPress}>
        <Text>{title}</Text>
      </Pressable>
    ),
    Choice: ({ label, options, onChange }: any) => (
      <View>
        <Text>{label}</Text>
        {options.map((option: any, index: number) => (
          <Pressable key={index} onPress={() => onChange(option.value)}>
            <Text>{option.label}</Text>
          </Pressable>
        ))}
      </View>
    ),
    Row: ({ title, onPress }: any) => (
      <Pressable onPress={onPress}>
        <Text>{title}</Text>
      </Pressable>
    ),
    human: (value: string) => value,
  };
});
jest.mock("@/lib/resources", () => ({
  useWorkspacePath: (resource: string) => `/workspaces/workspace/${resource}`,
  useResource: jest.fn(),
}));
jest.mock("@/lib/session", () => ({
  useSession: () => ({
    userId: "user",
    workspaceId: "workspace",
    request: mockRequest,
    closeAccount: mockCloseAccount,
    signOut: mockSignOut,
    refreshBootstrap: mockRefreshBootstrap,
    bootstrap: {
      workspaces: [],
      activeWorkspace: {
        modules: ["drive", "invoices"],
        capabilities: ["manage:drive", "manage:invoice"],
        settings: { defaultCurrency: "AUD" },
      },
    },
  }),
}));
jest.mock("@/lib/offline/store", () => ({
  createDraft: jest.fn(),
  explicitSave: jest.fn(),
  listDrafts: jest.fn(),
  syncOutbox: jest.fn(),
  getDraft: jest.fn(),
  correctRejectedDraft: jest.fn(),
}));
const vehicle = { id: "vehicle", name: "Work van" };
const expense = {
  id: "expense",
  vehicleId: "vehicle",
  type: "fuel",
  currency: "AUD",
  amountCents: 1234,
  date: "2026-10-25T00:00:00.000Z",
  description: "Fuel refill",
  odometerKm: 123,
  notes: null,
  updatedAt: "2026-10-25T01:00:00.000Z",
};
const loaded = (data: unknown) => ({ data, loading: false, refresh: jest.fn() });
beforeEach(() => {
  jest.clearAllMocks();
  mockRequest.mockResolvedValue(expense);
  jest
    .mocked(useLocalSearchParams)
    .mockReturnValue({ resource: "drive%2Fexpenses", id: "expense" });
});
it("sends an expense PATCH without the immutable vehicle ID while retaining editable financial fields", async () => {
  const detail = loaded(expense),
    vehicles = loaded({ items: [vehicle], nextCursor: null });
  jest
    .mocked(useResource)
    .mockImplementation((path: any) =>
      path?.includes("/expenses/expense") ? detail : (vehicles as any),
    );
  await render(<EditorScreen />);
  await waitFor(() => expect(screen.getByDisplayValue("Fuel refill")).toBeTruthy());
  await fireEvent.press(screen.getByText("Save"));
  await waitFor(() => expect(mockRequest).toHaveBeenCalled());
  const [, options] = mockRequest.mock.calls[0];
  expect(options.method).toBe("PATCH");
  expect(options.body).not.toHaveProperty("vehicleId");
  expect(options.body).toMatchObject({
    amountCents: 1234,
    type: "fuel",
    description: "Fuel refill",
  });
});
it("offers only server-supported vehicle expense types", () => {
  expect(catalog["drive/expenses"].fields?.find((field) => field.key === "type")?.options).toEqual([
    "fuel",
    "maintenance",
    "insurance",
    "registration",
    "other",
  ]);
});
it("keeps the version of the hydrated edit after a background refresh", async () => {
  let detail = loaded(expense);
  const vehicles = loaded({ items: [vehicle], nextCursor: null });
  jest
    .mocked(useResource)
    .mockImplementation((path: any) =>
      path?.includes("/expenses/expense") ? detail : (vehicles as any),
    );
  const view = await render(<EditorScreen />);
  await fireEvent.changeText(screen.getByLabelText("Description *"), "My unsaved change");
  detail = loaded({
    ...expense,
    description: "Changed on the web",
    updatedAt: "2026-10-25T02:00:00.000Z",
  });
  await view.rerender(<EditorScreen />);
  await fireEvent.press(screen.getByText("Save"));
  await waitFor(() => expect(mockRequest).toHaveBeenCalled());
  expect(mockRequest.mock.calls[0][1]).toMatchObject({
    version: expense.updatedAt,
    body: { description: "My unsaved change" },
  });
});
it("keeps unsaved document lines mounted through a token-triggered refetch", async () => {
  const invoice = {
    id: "invoice",
    issueDate: "2026-10-25T00:00:00.000Z",
    currency: "AUD",
    taxRate: 10,
    customerId: "customer",
    lineItems: [{ description: "Original work", quantity: 1, unitPriceCents: 5000 }],
    updatedAt: expense.updatedAt,
  };
  let detail: any = loaded(invoice);
  const customers = loaded({ items: [{ id: "customer", name: "A customer" }], nextCursor: null });
  jest.mocked(useLocalSearchParams).mockReturnValue({ resource: "invoices", id: "invoice" });
  jest
    .mocked(useResource)
    .mockImplementation((path: any) =>
      path?.includes("/invoices/invoice") ? detail : (customers as any),
    );
  const view = await render(<EditorScreen />);
  await fireEvent.changeText(screen.getByLabelText("Description *"), "My unsaved line");
  detail = { loading: true, refresh: jest.fn() };
  await view.rerender(<EditorScreen />);
  expect(screen.getByDisplayValue("My unsaved line")).toBeTruthy();
  detail = loaded({ ...invoice, updatedAt: "2026-10-25T02:00:00.000Z" });
  await view.rerender(<EditorScreen />);
  await fireEvent.press(screen.getByText("Save draft"));
  await waitFor(() => expect(mockRequest).toHaveBeenCalled());
  expect(mockRequest.mock.calls[0][1]).toMatchObject({
    version: invoice.updatedAt,
    body: { lineItems: [{ description: "My unsaved line", quantity: 1, unitPriceCents: 5000 }] },
  });
});
it("uses the member user ID and readable email when choosing an ownership recipient", async () => {
  const members = loaded({
    items: [
      { memberId: "membership", userId: "actual-user", email: "maria@example.com", role: "admin" },
    ],
    nextCursor: null,
  });
  jest.mocked(useResource).mockReturnValue(members as any);
  const change = jest.fn();
  await render(
    <ReferenceField label="Accepting team member" resource="members" value="" onChange={change} />,
  );
  await fireEvent.press(screen.getByText("maria@example.com"));
  expect(change).toHaveBeenCalledWith("actual-user");
  expect(change).not.toHaveBeenCalledWith(undefined);
});
it("loads additional reference pages without discarding earlier choices and filters loaded choices", async () => {
  const first = loaded({
      items: [{ id: "first", name: "First customer" }],
      nextCursor: "next & page",
    }),
    second = loaded({ items: [{ id: "last", name: "Zoe Customer" }], nextCursor: null });
  jest
    .mocked(useResource)
    .mockImplementation((path: any) => (path?.includes("cursor=") ? second : (first as any)));
  const change = jest.fn();
  await render(<ReferenceField label="Customer" resource="customers" value="" onChange={change} />);
  await fireEvent.press(screen.getByText("Load more customers"));
  await waitFor(() => expect(screen.getByText("Zoe Customer")).toBeTruthy());
  expect(screen.getByText("First customer")).toBeTruthy();
  expect(
    jest
      .mocked(useResource)
      .mock.calls.some(([path]) => String(path).includes("cursor=next%20%26%20page")),
  ).toBe(true);
  await fireEvent.changeText(screen.getByLabelText("Search customer"), "Zoe");
  expect(screen.queryByText("First customer")).toBeNull();
  await fireEvent.press(screen.getByText("Zoe Customer"));
  expect(change).toHaveBeenCalledWith("last");
});

it("purges local account state after successful account deletion rather than ordinary sign-out", async () => {
  jest.mocked(useResource).mockReturnValue(loaded({ items: [] }) as any);
  mockRequest.mockResolvedValue({ deleted: true });
  const alert = jest.spyOn(Alert, "alert").mockImplementation((_title, _message, buttons) => {
    buttons?.find((button) => button.text === "Delete account")?.onPress?.();
  });
  await render(<LegalScreen />);
  await fireEvent.changeText(screen.getByLabelText("Type DELETE to confirm"), "DELETE");
  await fireEvent.press(screen.getByText("Delete my account"));
  await waitFor(() => expect(mockCloseAccount).toHaveBeenCalledTimes(1));
  expect(mockSignOut).not.toHaveBeenCalled();
  alert.mockRestore();
});
it("replays an incoming receipt destination after password sign-in", async () => {
  jest.mocked(useLocalSearchParams).mockReturnValue({ returnTo: "/feature/receipt" });
  jest
    .mocked(supabase.auth.signInWithPassword)
    .mockResolvedValue({ data: { session: { access_token: "token" } }, error: null } as any);
  await render(<SignInScreen />);
  await fireEvent.changeText(screen.getByLabelText("Email"), "owner@example.com");
  await fireEvent.changeText(screen.getByLabelText("Password"), "password123");
  await fireEvent.press(screen.getByText("Sign in"));
  await waitFor(() => expect(supabase.auth.signInWithPassword).toHaveBeenCalled());
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/feature/receipt"));
});
it("replays the destination after workspace creation instead of dropping it during onboarding", async () => {
  jest.mocked(useLocalSearchParams).mockReturnValue({ returnTo: "/feature/receipt" });
  jest.mocked(useResource).mockReturnValue(loaded({ items: [] }) as any);
  mockRequest.mockResolvedValue({ workspaceId: "new-workspace" });
  await render(<WorkspacesScreen />);
  await fireEvent.changeText(screen.getByLabelText("Business name"), "Receipt Business");
  await fireEvent.press(screen.getByText("Create workspace"));
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/feature/receipt"));
  expect(mockRefreshBootstrap).toHaveBeenCalledWith("new-workspace");
});

it("retains the required vehicle link for new expenses", () => {
  expect(
    formBody("drive/expenses", {
      vehicleId: "vehicle",
      type: "fuel",
      currency: "AUD",
      amountCents: "12.34",
      date: "2026-10-25",
      description: "Fuel",
    }),
  ).toHaveProperty("vehicleId", "vehicle");
  expect(() =>
    formBody("drive/expenses", {
      type: "fuel",
      currency: "AUD",
      amountCents: "12.34",
      date: "2026-10-25",
      description: "Fuel",
    }),
  ).toThrow("Vehicle is required.");
});
it("hydrates the selected reference outside the current page and excludes the current owner", async () => {
  const list = loaded({
    items: [{ userId: "owner", email: "owner@example.com" }],
    nextCursor: "next",
  });
  const selected = loaded({ userId: "recipient", email: "selected@example.com" });
  jest
    .mocked(useResource)
    .mockImplementation((path: any) => (path?.endsWith("/recipient") ? selected : (list as any)));
  await render(
    <ReferenceField
      label="Team member"
      resource="members"
      value="recipient"
      excludeIds={["owner"]}
      onChange={jest.fn()}
    />,
  );
  await waitFor(() => expect(screen.getByText("selected@example.com")).toBeTruthy());
  expect(screen.queryByText("owner@example.com")).toBeNull();
});

const rejectedExpense = {
  id: "original-draft",
  userId: "user",
  workspaceId: "workspace",
  kind: "drive/expenses",
  path: "/workspaces/workspace/drive/expenses",
  operationId: "original-operation",
  status: "blocked",
  attempts: 1,
  nextAttemptAt: 0,
  createdAt: 1,
  updatedAt: 2,
  files: [
    {
      uri: "file:///original-receipt.jpg",
      name: "receipt.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 20,
    },
  ],
  body: {
    vehicleId: "vehicle",
    type: "parking",
    currency: "AUD",
    amountCents: 1234,
    date: "2026-10-25T00:00:00.000Z",
    description: "Original rejected expense",
  },
  failureStatus: 400,
  validationRejected: true,
  uncertainOutcome: false,
};
it("corrects a rejected creation in its original bound draft instead of creating a duplicate capture", async () => {
  jest
    .mocked(useLocalSearchParams)
    .mockReturnValue({ resource: "drive%2Fexpenses", id: "new", draftId: "original-draft" });
  const vehicles = loaded({ items: [vehicle], nextCursor: null });
  jest.mocked(useResource).mockReturnValue(vehicles as any);
  jest.mocked(getDraft).mockResolvedValue(rejectedExpense as any);
  jest
    .mocked(correctRejectedDraft)
    .mockImplementation(
      async (_binding, _id, body) =>
        ({ ...rejectedExpense, status: "draft", operationId: "corrected-operation", body }) as any,
    );
  jest.mocked(listDrafts).mockResolvedValue([{ ...rejectedExpense, status: "synced" }] as any);
  await render(<EditorScreen />);
  await waitFor(() => expect(screen.getByDisplayValue("Original rejected expense")).toBeTruthy());
  await fireEvent.press(screen.getByText("fuel"));
  await fireEvent.changeText(screen.getByLabelText("Description *"), "Corrected fuel expense");
  await fireEvent.press(screen.getByText("Save"));
  await waitFor(() =>
    expect(correctRejectedDraft).toHaveBeenCalledWith(
      { userId: "user", workspaceId: "workspace" },
      "original-draft",
      expect.objectContaining({
        vehicleId: "vehicle",
        type: "fuel",
        description: "Corrected fuel expense",
        amountCents: 1234,
      }),
    ),
  );
  expect(createDraft).not.toHaveBeenCalled();
  expect(explicitSave).toHaveBeenCalledWith(
    { userId: "user", workspaceId: "workspace" },
    "original-draft",
  );
  expect(syncOutbox).toHaveBeenCalledWith(
    { userId: "user", workspaceId: "workspace" },
    mockRequest,
  );
});
it("refuses a rejected draft whose resource does not match the correction form", async () => {
  jest
    .mocked(useLocalSearchParams)
    .mockReturnValue({ resource: "drive%2Fexpenses", id: "new", draftId: "original-draft" });
  jest.mocked(useResource).mockReturnValue(loaded({ items: [] }) as any);
  jest.mocked(getDraft).mockResolvedValue({
    ...rejectedExpense,
    kind: "customers",
    path: "/workspaces/workspace/customers",
  } as any);
  await render(<EditorScreen />);
  await waitFor(() =>
    expect(
      screen.getByText(
        "This draft does not match this form. Open it from its original Drafts entry.",
      ),
    ).toBeTruthy(),
  );
  expect(screen.queryByText("Save")).toBeNull();
  expect(correctRejectedDraft).not.toHaveBeenCalled();
  expect(createDraft).not.toHaveBeenCalled();
});
it("refuses a rejected draft from another workspace even if a stale route references its ID", async () => {
  jest
    .mocked(useLocalSearchParams)
    .mockReturnValue({ resource: "drive%2Fexpenses", id: "new", draftId: "original-draft" });
  jest.mocked(useResource).mockReturnValue(loaded({ items: [] }) as any);
  jest
    .mocked(getDraft)
    .mockResolvedValue({ ...rejectedExpense, workspaceId: "other-workspace" } as any);
  await render(<EditorScreen />);
  await waitFor(() =>
    expect(screen.getByText("This draft belongs to another account or workspace.")).toBeTruthy(),
  );
  expect(screen.queryByText("Save")).toBeNull();
  expect(correctRejectedDraft).not.toHaveBeenCalled();
});

it("retains corrections and does not queue or clone when the original draft becomes uncertain before Save", async () => {
  jest
    .mocked(useLocalSearchParams)
    .mockReturnValue({ resource: "drive%2Fexpenses", id: "new", draftId: "original-draft" });
  jest.mocked(useResource).mockReturnValue(loaded({ items: [vehicle], nextCursor: null }) as any);
  jest.mocked(getDraft).mockResolvedValue(rejectedExpense as any);
  jest
    .mocked(correctRejectedDraft)
    .mockRejectedValueOnce(
      new Error("This draft has an uncertain outcome and cannot be corrected."),
    );
  await render(<EditorScreen />);
  await waitFor(() => expect(screen.getByDisplayValue("Original rejected expense")).toBeTruthy());
  await fireEvent.press(screen.getByText("fuel"));
  await fireEvent.changeText(screen.getByLabelText("Description *"), "Keep this correction");
  await fireEvent.press(screen.getByText("Save"));
  await waitFor(() =>
    expect(
      screen.getByText("This draft has an uncertain outcome and cannot be corrected."),
    ).toBeTruthy(),
  );
  expect(screen.getByDisplayValue("Keep this correction")).toBeTruthy();
  expect(explicitSave).not.toHaveBeenCalled();
  expect(syncOutbox).not.toHaveBeenCalled();
  expect(createDraft).not.toHaveBeenCalled();
});
