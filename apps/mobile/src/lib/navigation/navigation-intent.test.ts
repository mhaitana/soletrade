import { internalDestination } from "@/lib/navigation/navigation-intent";
it.each([
  "/feature/receipt",
  "/feature/shift",
  "/edit/invoices/new",
  "/feature/receipt?workspaceId=bound-workspace&userId=bound-user",
])("preserves the allowed destination and binding through authentication: %s", (destination) => {
  expect(internalDestination(destination)).toBe(destination);
});
it.each([
  "https://evil.example",
  "//evil.example",
  "/admin",
  "/feature/unknown",
  "/feature/receipt\\evil",
])("rejects external or unsupported pending destinations: %s", (destination) => {
  expect(internalDestination(destination)).toBe("/");
});
