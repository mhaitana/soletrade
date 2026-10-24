import { gigAppLink } from "@/lib/native/gig-launch";
import { describe, expect, it } from "vitest";
describe("explicit gig-app launch configuration", () => {
  it("defaults to manual switching and uses only a configured selected-platform link", () => {
    expect(gigAppLink("uber", "{}")).toBeNull();
    expect(gigAppLink("uber", "not json")).toBeNull();
    expect(gigAppLink("uber", JSON.stringify({ uber: "verified-provider://home" }))).toBe(
      "verified-provider://home",
    );
    expect(gigAppLink("uber", JSON.stringify({ uber: "https://provider.example/driver" }))).toBe(
      "https://provider.example/driver",
    );
    expect(gigAppLink("doordash", JSON.stringify({ uber: "verified-provider://home" }))).toBeNull();
  });
  it("rejects dangerous schemes, credentials, query/fragment payloads and malformed mappings", () => {
    for (const value of [
      "javascript:alert(1)",
      "data:text/plain,a",
      "file:///private/document",
      "content://receipt",
      "intent://driver",
      "tel:+61123",
      "sms:123",
      "mailto:x@example.com",
      "geo:-37,144",
      "http://provider.example",
      "https://user:secret@provider.example/app",
      "https://provider.example/app?latitude=-37",
      "verified-provider://home?status=online",
      "verified-provider://home#coordinates",
      " verified-provider://home",
      "verified-provider://home\\path",
    ])
      expect(gigAppLink("uber", JSON.stringify({ uber: value }))).toBeNull();
    expect(gigAppLink("uber", "[]")).toBeNull();
    expect(
      gigAppLink("uber", JSON.stringify({ uber: { url: "https://provider.example" } })),
    ).toBeNull();
  });
});
