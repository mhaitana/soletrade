import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearEventBus,
  onEvent,
  publishEvent,
  setEventPersister,
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
});
