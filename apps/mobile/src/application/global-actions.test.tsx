import { PrivateToolbar } from "@/components/private-toolbar";
import { contextualCreate, privateToolbarAllowed } from "@/lib/navigation/global-actions";
import { fireEvent, render, screen } from "@testing-library/react-native";
jest.mock("@expo/ui", () => {
  const React = jest.requireActual("react");
  const { View, Text, Pressable } = jest.requireActual("react-native");
  return {
    Host: ({ children }: any) => <View>{children}</View>,
    Button: ({ children, label, onPress }: any) => (
      <Pressable accessibilityRole="button" onPress={onPress}>
        {children ?? <Text>{label}</Text>}
      </Pressable>
    ),
    Text: ({ children }: any) => <Text>{children}</Text>,
  };
});
const modules = ["invoices", "quotes", "books", "drive"] as const;
it.each([
  ["/money", ["manage:books"], "Create transaction", "/edit/books%2Ftransactions/new"],
  ["/drive", ["create:drive"], "Create earning", "/edit/drive%2Fearnings/new"],
  ["/sales", ["manage:quote"], "Create quote", "/edit/quotes/new"],
  ["/resource/drive%2Fexpenses", ["manage:drive"], "Create expense", "/edit/drive%2Fexpenses/new"],
  ["/resource/customers/customer", ["manage:customer"], "Create customer", "/edit/customers/new"],
  ["/resource/files", ["manage:file"], "Upload file", "/upload"],
])("chooses a permitted contextual creation on %s", (pathname, capabilities, label, href) => {
  expect(contextualCreate(pathname, [...modules], capabilities)).toEqual({ label, href });
});
it("respects installed modules, read-only resources and file-management permission", () => {
  expect(contextualCreate("/money", [], ["manage:books"])).toBeNull();
  expect(contextualCreate("/resource/files", [], ["view:file"])).toBeNull();
  expect(contextualCreate("/resource/audit", [], ["view:audit"])).toBeNull();
  expect(contextualCreate("/sales", [], ["manage:customer"])).toEqual({
    label: "Create customer",
    href: "/edit/customers/new",
  });
});
it("renders global navigation without creation permission, switches workspaces and avoids duplicate current routes", async () => {
  const navigate = jest.fn();
  await render(
    <PrivateToolbar
      workspaceName="Mina's business"
      pathname="/search"
      modules={[]}
      capabilities={[]}
      onNavigate={navigate}
      topInset={44}
    />,
  );
  expect(screen.getByTestId("private-toolbar")).toHaveStyle({ paddingTop: 44 });
  await fireEvent.press(screen.getByRole("button", { name: "Mina's business ▾" }));
  expect(navigate).toHaveBeenLastCalledWith("/workspaces");
  await fireEvent.press(screen.getByRole("button", { name: "Search" }));
  expect(navigate).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByRole("button", { name: "hAI" }));
  expect(navigate).toHaveBeenLastCalledWith("/assistant");
  expect(screen.queryByText(/Create/)).toBeNull();
});
it("shows the clear contextual label and navigates to its permitted form", async () => {
  const navigate = jest.fn();
  await render(
    <PrivateToolbar
      workspaceName="Business"
      pathname="/sales"
      modules={["invoices"]}
      capabilities={["manage:invoice"]}
      onNavigate={navigate}
    />,
  );
  await fireEvent.press(screen.getByRole("button", { name: "Create invoice" }));
  expect(navigate).toHaveBeenCalledWith("/edit/invoices/new");
});
it("never exposes the private toolbar on public, onboarding or mismatched pending bindings", () => {
  const binding = {
    authenticated: true,
    pathname: "/money",
    userId: "user",
    bootstrapUserId: "user",
    workspaceId: "workspace",
    activeWorkspaceId: "workspace",
  };
  expect(privateToolbarAllowed(binding)).toBe(true);
  for (const pathname of ["/sign-in", "/auth/callback", "/invite/token", "/legal"])
    expect(privateToolbarAllowed({ ...binding, pathname })).toBe(false);
  expect(privateToolbarAllowed({ ...binding, authenticated: false })).toBe(false);
  expect(privateToolbarAllowed({ ...binding, activeWorkspaceId: "" })).toBe(false);
  expect(privateToolbarAllowed({ ...binding, requestedWorkspace: "other" })).toBe(false);
  expect(privateToolbarAllowed({ ...binding, requestedUser: "other" })).toBe(false);
  expect(privateToolbarAllowed({ ...binding, bootstrapUserId: "other" })).toBe(false);
});
