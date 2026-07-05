import { afterEach, describe, expect, it } from "vitest";
import {
  clearEmailClientForTest,
  sendEmail,
  setEmailClientForTest,
  type EmailClient,
  type EmailPayload,
} from "./index";

afterEach(() => clearEmailClientForTest());

describe("sendEmail", () => {
  it("returns not-configured when no client is wired (graceful no-op, no throw)", async () => {
    // No test override set + no env keys in the test environment → null client.
    const result = await sendEmail({
      to: "customer@example.com",
      subject: "Test",
      html: "<p>hi</p>",
      text: "hi",
    });
    expect(result).toEqual({ ok: false, reason: "not-configured" });
  });

  it("returns ok + id when the configured client succeeds", async () => {
    const fake: EmailClient = {
      async send() {
        return { id: "re_fake_123" };
      },
    };
    setEmailClientForTest(fake);
    const result = await sendEmail({
      to: "customer@example.com",
      subject: "Test",
      html: "<p>hi</p>",
      text: "hi",
    });
    expect(result).toEqual({ ok: true, id: "re_fake_123" });
  });

  it("returns send-failed (no throw) when the client rejects", async () => {
    const fake: EmailClient = {
      async send() {
        throw new Error("network down");
      },
    };
    setEmailClientForTest(fake);
    const result = await sendEmail({
      to: "customer@example.com",
      subject: "Test",
      html: "<p>hi</p>",
      text: "hi",
    });
    expect(result).toEqual({ ok: false, reason: "send-failed" });
  });

  it("returns not-configured when the override is explicitly null", async () => {
    setEmailClientForTest(null);
    const result = await sendEmail({
      to: "customer@example.com",
      subject: "Test",
      html: "<p>hi</p>",
      text: "hi",
    });
    expect(result).toEqual({ ok: false, reason: "not-configured" });
  });

  it("forwards the full payload to the client", async () => {
    let captured: EmailPayload | null = null;
    const fake: EmailClient = {
      async send(p: EmailPayload) {
        captured = p;
        return { id: "re_ok" };
      },
    };
    setEmailClientForTest(fake);
    await sendEmail({
      to: "to@example.com",
      subject: "Subj",
      html: "<b>html</b>",
      text: "plain text",
    });
    expect(captured).toEqual({
      to: "to@example.com",
      subject: "Subj",
      html: "<b>html</b>",
      text: "plain text",
    });
  });
});
