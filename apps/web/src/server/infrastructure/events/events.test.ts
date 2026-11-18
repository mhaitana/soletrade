import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearEventBus,
  onEvent,
  publishEvent,
  setEventPersister,
  setEventScheduler,
  type BusEvent,
} from "@/server/infrastructure/events";
import { branded } from "@/types/ids";

const ws = () => branded<"WorkspaceId">("ws-1");
const user = () => branded<"UserId">("user-1");

afterEach(() => {
  clearEventBus();
});

describe("event bus", () => {
  it("delivers an event to a matching subscriber", async () => {
    const handler = vi.fn();
    onEvent("ModuleEnabled", handler);
    const event: BusEvent = { type: "ModuleEnabled", workspaceId: ws(), actorUserId: user() };
    await publishEvent(event);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(event);
  });

  it("does not deliver to subscribers of other event types", async () => {
    const a = vi.fn();
    const b = vi.fn();
    onEvent("ModuleEnabled", a);
    onEvent("ModuleDisabled", b);
    await publishEvent({ type: "ModuleEnabled", workspaceId: ws() });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
  });

  it("supports multiple subscribers on the same type, all notified", async () => {
    const a = vi.fn();
    const b = vi.fn();
    onEvent("InvoicePaid", a);
    onEvent("InvoicePaid", b);
    await publishEvent({ type: "InvoicePaid", workspaceId: ws() });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("unsubscribe stops further delivery", async () => {
    const handler = vi.fn();
    const off = onEvent("InvoiceSent", handler);
    off();
    await publishEvent({ type: "InvoiceSent", workspaceId: ws() });
    expect(handler).not.toHaveBeenCalled();
  });

  it("awaits async handlers", async () => {
    let resolved = false;
    onEvent("QuoteAccepted", async () => {
      await Promise.resolve();
      resolved = true;
    });
    await publishEvent({ type: "QuoteAccepted", workspaceId: ws() });
    expect(resolved).toBe(true);
  });

  it("a failing handler does not stop other handlers or the publish", async () => {
    const ok = vi.fn();
    onEvent("InvoiceViewed", async () => {
      throw new Error("boom");
    });
    onEvent("InvoiceViewed", ok);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await publishEvent({ type: "InvoiceViewed", workspaceId: ws() });
    expect(ok).toHaveBeenCalledTimes(1);
    errSpy.mockRestore();
  });

  it("persister is called with the event before handlers", async () => {
    const order: string[] = [];
    const persister = vi.fn(async (e: BusEvent) => {
      order.push(`persist:${e.type}`);
    });
    setEventPersister(persister);
    onEvent("ModuleEnabled", () => {
      order.push("handler");
    });
    await publishEvent({ type: "ModuleEnabled", workspaceId: ws() });
    expect(persister).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["persist:ModuleEnabled", "handler"]);
  });

  it("a failing persister does not stop handler delivery", async () => {
    const handler = vi.fn();
    setEventPersister(async () => {
      throw new Error("persist boom");
    });
    onEvent("ModuleEnabled", handler);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await publishEvent({ type: "ModuleEnabled", workspaceId: ws() });
    expect(handler).toHaveBeenCalledTimes(1);
    errSpy.mockRestore();
  });

  it("publishing with no subscribers and no persister resolves cleanly", async () => {
    await expect(publishEvent({ type: "NoListeners", workspaceId: ws() })).resolves.toBeUndefined();
  });

  it("awaits a deferred handler when no request is in flight (tests, scripts, startup)", async () => {
    const handler = vi.fn();
    onEvent("InvoiceSent", handler, { deferred: true });
    await publishEvent({ type: "InvoiceSent", workspaceId: ws() });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("hands deferred handlers to the scheduler and returns without waiting for them", async () => {
    const queued: (() => Promise<void>)[] = [];
    setEventScheduler((task) => {
      queued.push(task);
      return true;
    });
    const order: string[] = [];
    setEventPersister(() => {
      order.push("persist");
    });
    onEvent(
      "InvoiceSent",
      () => {
        order.push("email");
      },
      { deferred: true },
    );
    onEvent("InvoiceSent", () => {
      order.push("inline");
    });

    await publishEvent({ type: "InvoiceSent", workspaceId: ws() });
    // The activity row and the ordinary subscriber are done; the email has not run yet.
    expect(order).toEqual(["persist", "inline"]);
    expect(queued).toHaveLength(1);

    await queued[0]!();
    expect(order).toEqual(["persist", "inline", "email"]);
  });

  it("runs deferred handlers itself when the scheduler declines", async () => {
    setEventScheduler(() => false);
    const handler = vi.fn();
    onEvent("QuoteSent", handler, { deferred: true });
    await publishEvent({ type: "QuoteSent", workspaceId: ws() });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("does not involve the scheduler when no subscriber is deferred", async () => {
    const schedule = vi.fn(() => true);
    setEventScheduler(schedule);
    const handler = vi.fn();
    onEvent("ModuleEnabled", handler);
    await publishEvent({ type: "ModuleEnabled", workspaceId: ws() });
    expect(schedule).not.toHaveBeenCalled();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("a failing deferred handler is logged and does not reject the queued task", async () => {
    const queued: (() => Promise<void>)[] = [];
    setEventScheduler((task) => {
      queued.push(task);
      return true;
    });
    onEvent(
      "InvoicePaid",
      async () => {
        throw new Error("mail provider down");
      },
      { deferred: true },
    );
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await publishEvent({ type: "InvoicePaid", workspaceId: ws() });
    await expect(queued[0]!()).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("delivers to subscribers registered through a different copy of the module", async () => {
    // The server bundles instrumentation.ts (which registers subscribers at start-up)
    // separately from the routes that publish, so each side loads its own copy of this
    // module. With module-level state the publishing copy had no subscribers and every
    // event was dropped. Re-importing after resetModules gives a second copy to prove the
    // registry is shared.
    const persisted: string[] = [];
    const handler = vi.fn();
    setEventPersister((event) => {
      persisted.push(event.type);
    });
    onEvent("InvoiceSent", handler);

    vi.resetModules();
    const secondCopy = await import("@/server/infrastructure/events");
    expect(secondCopy.publishEvent).not.toBe(publishEvent);

    const event: BusEvent = { type: "InvoiceSent", workspaceId: ws() };
    await secondCopy.publishEvent(event);

    expect(persisted).toEqual(["InvoiceSent"]);
    expect(handler).toHaveBeenCalledWith(event);
  });
});
