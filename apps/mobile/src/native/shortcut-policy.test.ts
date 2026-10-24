import { describe, expect, it } from "vitest";
import { SHORTCUT_TARGETS, shortcutTarget } from "./shortcut-policy";
const binding = { userId: "a", workspaceId: "one" };
describe("app shortcut routing", () => {
  it("uses only fixed internal routes and current original binding", () => {
    for (const item of SHORTCUT_TARGETS)
      expect(
        shortcutTarget(
          { id: item.id, params: { ...binding, href: "https://attacker.test" } },
          binding,
          ["drive", "books", "invoices"],
        ),
      ).toBe(item.href);
    expect(shortcutTarget({ id: "unknown", params: binding }, binding, ["drive"])).toBeNull();
    expect(
      shortcutTarget({ id: "soletrade.exampleift", params: { ...binding, userId: "other" } }, binding, [
        "drive",
      ]),
    ).toBeNull();
    expect(
      shortcutTarget(
        { id: "soletrade.exampleift", params: { ...binding, workspaceId: "other" } },
        binding,
        ["drive"],
      ),
    ).toBeNull();
    expect(shortcutTarget({ id: "soletrade.exampleift", params: binding }, binding, [])).toBeNull();
  });
});
