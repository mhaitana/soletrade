import { describe, expect, it } from "vitest";
import { buildSetupChecklist } from "@/features/dashboard/utils/setup-checklist";

describe("buildSetupChecklist", () => {
  it("only marks the workspace step complete for a brand-new workspace", () => {
    const setup = buildSetupChecklist({
      installedModules: [],
      customerCount: 0,
      sentDocumentCount: 0,
    });
    expect(setup?.steps.map((s) => [s.id, s.complete])).toEqual([
      ["workspace", true],
      ["module", false],
      ["customer", false],
      ["send", false],
    ]);
    expect(setup?.completed).toBe(1);
    expect(setup?.steps[1]?.href).toBe("/settings/modules");
    expect(setup?.steps[2]?.href).toBe("/customers/new");
    expect(setup?.steps[3]?.href).toBe("/settings/modules");
  });

  it("derives each flag from real data and links the next step to where it is done", () => {
    const setup = buildSetupChecklist({
      installedModules: ["books", "invoices"],
      customerCount: 3,
      sentDocumentCount: 0,
    });
    expect(setup?.steps.map((s) => s.complete)).toEqual([true, true, true, false]);
    expect(setup?.steps[3]?.href).toBe("/invoices/new");
  });

  it("sends quotes-only workspaces to the quote form", () => {
    const setup = buildSetupChecklist({
      installedModules: ["quotes"],
      customerCount: 0,
      sentDocumentCount: 0,
    });
    expect(setup?.steps[3]?.href).toBe("/quotes/new");
  });

  it("returns null once every step is complete", () => {
    expect(
      buildSetupChecklist({
        installedModules: ["invoices"],
        customerCount: 1,
        sentDocumentCount: 2,
      }),
    ).toBeNull();
  });

  it("does not ask a Books- or Drive-only workspace for customers or documents it will never have", () => {
    // Enabling the module completes everything that applies, so the card goes away.
    expect(
      buildSetupChecklist({ installedModules: ["drive"], customerCount: 0, sentDocumentCount: 0 }),
    ).toBeNull();
    expect(
      buildSetupChecklist({
        installedModules: ["books", "drive"],
        customerCount: 0,
        sentDocumentCount: 0,
      }),
    ).toBeNull();
  });

  it("keeps the billing steps once an invoicing or quoting module is added", () => {
    const setup = buildSetupChecklist({
      installedModules: ["drive", "quotes"],
      customerCount: 0,
      sentDocumentCount: 0,
    });
    expect(setup?.steps.map((s) => s.id)).toEqual(["workspace", "module", "customer", "send"]);
    expect(setup?.completed).toBe(2);
  });
});
