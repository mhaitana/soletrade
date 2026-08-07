import { describe, expect, it } from "vitest";
import { ACTIVITY_LABELS, describeActivity } from "./labels";

describe("activity labels", () => {
  it("returns a known label for a catalogued event type", () => {
    expect(describeActivity("CustomerCreated")).toEqual({
      label: "added a customer",
      tone: "positive",
    });
    expect(describeActivity("InvoicePaid")).toEqual({
      label: "paid an invoice",
      tone: "positive",
    });
    expect(describeActivity("CustomerDeleted").tone).toBe("danger");
  });

  it("every catalogued entry has a non-empty label and a valid tone", () => {
    for (const [type, entry] of Object.entries(ACTIVITY_LABELS)) {
      expect(entry.label.length, `${type} label`).toBeGreaterThan(0);
      expect(["neutral", "positive", "info", "warning", "danger"]).toContain(entry.tone);
    }
  });

  it("falls back to a humanised type for unknown events", () => {
    const { label, tone } = describeActivity("SomeNewModuleEvent");
    expect(label).toBe("some new module event");
    expect(tone).toBe("neutral");
  });

  it("humanises consecutive capitals and digit boundaries", () => {
    expect(describeActivity("OCRCompleted").label).toBe("ocr completed");
    expect(describeActivity("VATReturnFiled").label).toBe("vat return filed");
  });

  it("maps legacy dotted event names to useful activity text", () => {
    expect(describeActivity("quote.accepted")).toEqual({
      label: "accepted a quote",
      tone: "positive",
    });
    expect(describeActivity("invoice.sent").label).toBe("sent an invoice");
    expect(describeActivity("custom.event_name").label).toBe("custom event name");
  });
});
