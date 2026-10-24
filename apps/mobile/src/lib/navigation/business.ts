import { detailHref, listHref } from "@/lib/resources";
import { router } from "expo-router";

export function navigateBusiness(href: string) {
  const path = href.split("?")[0];
  const params = new URLSearchParams(href.split("?")[1] ?? "");
  const match = path.match(/^\/(customers|invoices|quotes)\/([0-9a-fA-F-]{36})$/);
  if (match) {
    router.push(detailHref(match[1], match[2]) as never);
    return;
  }
  const books = path.match(/^\/books\/([0-9a-fA-F-]{36})$/);
  if (books) {
    router.push(detailHref("books/transactions", books[1]) as never);
    return;
  }
  const mapped: Record<string, string> = {
    "/drive": "/(tabs)/drive",
    "/books": "/(tabs)/money",
    "/files": listHref("files"),
    "/customers": listHref("customers"),
    "/invoices": listHref("invoices"),
    "/quotes": listHref("quotes"),
    "/": "/(tabs)",
    "/dashboard": "/(tabs)",
    "/books/receipts": listHref("books/receipts"),
    "/books/tax": "/tax",
    "/drive/vehicles": listHref("drive/vehicles"),
    "/drive/expenses": listHref("drive/expenses"),
    "/drive/settings": listHref("drive/settings"),
    "/activity": listHref("activity"),
    "/audit": listHref("audit"),
    "/billing": "/billing",
    "/settings": listHref("settings"),
    "/settings/modules": "/feature/store",
    "/settings/members": listHref("members"),
    "/settings/account": "/profile",
    "/assistant": "/assistant",
  };
  if (path === "/drive" && params.get("view") === "trips") {
    router.push(listHref("drive/trips") as never);
    return;
  }
  if (mapped[path])
    router.push(
      `${mapped[path]}${params.get("status") ? `?status=${encodeURIComponent(params.get("status")!)}` : ""}` as never,
    );
}
