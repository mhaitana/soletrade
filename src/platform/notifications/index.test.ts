import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { publishEvent, clearEventBus, type BusEvent } from "@/server/events";
import {
  clearEmailClientForTest,
  setEmailClientForTest,
  type EmailClient,
  type EmailPayload,
} from "@/server/email";
import { branded } from "@/shared/types/ids";
import { registerNotifications } from "./index";
import type { InvoiceEmailMeta } from "./templates";

// publishEvent reads env.NEXT_PUBLIC_APP_URL via the notifications handlers; the assertions
// check the link contains `/i/<token>` rather than the exact host, so this test is env-agnostic.

const ws = branded<"WorkspaceId">("00000000-0000-6000-8000-0000000000c1");
const invoiceId = branded<"InvoiceId">("00000000-0000-6000-8000-0000000000d1");

function meta(overrides: Partial<InvoiceEmailMeta> = {}): InvoiceEmailMeta {
  return {
    number: "INV-2026-0009",
    totalCents: 19900,
    currency: "AUD",
    customerEmail: "customer@globex.com",
    customerName: "Globex Corp",
    publicToken: "tok-xyz",
    dueDate: new Date("2026-09-01"),
    ...overrides,
  };
}

let sends: EmailPayload[];
let unsub: (() => void) | null = null;

beforeEach(() => {
  clearEventBus();
  sends = [];
  const fake: EmailClient = {
    async send(p: EmailPayload) {
      sends.push(p);
      return { id: "re_test" };
    },
  };
  setEmailClientForTest(fake);
  unsub = registerNotifications();
});

afterEach(() => {
  unsub?.();
  unsub = null;
  clearEmailClientForTest();
  clearEventBus();
});

async function publish(type: string, metadata: Record<string, unknown>): Promise<BusEvent> {
  const event: BusEvent = {
    type,
    workspaceId: ws,
    entityType: "invoice",
    entityId: invoiceId,
    metadata,
  };
  await publishEvent(event);
  return event;
}

describe("notifications (event-driven email)", () => {
  it("sends an invoice-sent email when InvoiceSent carries a customer email", async () => {
    await publish("InvoiceSent", meta());
    expect(sends).toHaveLength(1);
    expect(sends[0]?.to).toBe("customer@globex.com");
    expect(sends[0]?.subject).toBe("Invoice INV-2026-0009 from soletrade labs");
    expect(sends[0]?.text).toContain(`/i/tok-xyz`);
    expect(sends[0]?.html).toContain(`href="`);
  });

  it("no-ops when the customer has no email (walk-in)", async () => {
    await publish("InvoiceSent", meta({ customerEmail: null }));
    expect(sends).toHaveLength(0);
  });

  it("sends an overdue email on InvoiceOverdue with the red accent", async () => {
    await publish("InvoiceOverdue", meta());
    expect(sends).toHaveLength(1);
    expect(sends[0]?.subject).toBe("Overdue: Invoice INV-2026-0009");
    expect(sends[0]?.html).toContain("#DC2626");
  });

  it("sends a receipt on InvoicePaid (stripe source)", async () => {
    await publish("InvoicePaid", { ...meta(), source: "stripe" });
    expect(sends).toHaveLength(1);
    expect(sends[0]?.subject).toBe("Receipt: Invoice INV-2026-0009");
    expect(sends[0]?.html).toContain("#059669");
  });

  it("unsubscribes stop further deliveries", async () => {
    unsub?.();
    unsub = null;
    await publish("InvoiceSent", meta());
    expect(sends).toHaveLength(0);
  });

  it("ignores event types it did not subscribe to", async () => {
    await publish("InvoiceViewed", meta()); // viewed is not an email trigger
    expect(sends).toHaveLength(0);
  });
});
