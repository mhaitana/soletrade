import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearEmailClientForTest,
  sendEmail,
  setEmailClientForTest,
} from "@/server/infrastructure/email";
import {
  type EmailClient,
  type EmailPayload,
} from "@/lib/domain/notifications/email-transport-types";

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

  it("forwards attachments to the client (Wave 4 - PDF attachments)", async () => {
    let captured: EmailPayload | null = null;
    const fake: EmailClient = {
      async send(p: EmailPayload) {
        captured = p;
        return { id: "re_ok" };
      },
    };
    setEmailClientForTest(fake);
    await sendEmail({
      to: "customer@example.com",
      subject: "Invoice",
      html: "<b>html</b>",
      text: "plain text",
      attachments: [{ filename: "INV-2026-0001.pdf", content: "JVBERi0=" }],
    });
    expect(captured).toMatchObject({
      attachments: [{ filename: "INV-2026-0001.pdf", content: "JVBERi0=" }],
    });
  });

  it("uses the product sender name while preserving the configured email address", async () => {
    const resendSend = vi.fn().mockResolvedValue({ data: { id: "re_branded" }, error: null });
    vi.resetModules();
    vi.doMock("resend", () => ({
      Resend: class {
        emails = { send: resendSend };
      },
    }));
    vi.doMock("@/server/infrastructure/config/env", () => ({
      env: {
        RESEND_API_KEY: "test-key",
        EMAIL_FROM: "support@soletrade.example",
      },
    }));

    try {
      const { sendEmail: sendConfiguredEmail } = await import("@/server/infrastructure/email");
      const result = await sendConfiguredEmail({
        to: "customer@example.com",
        subject: "Invoice",
        html: "<p>Your invoice</p>",
        text: "Your invoice",
      });

      expect(result).toEqual({ ok: true, id: "re_branded" });
      expect(resendSend).toHaveBeenCalledWith(
        expect.objectContaining({
          from: "Soletrade <support@soletrade.example>",
          to: "customer@example.com",
          subject: "Invoice",
        }),
      );
    } finally {
      vi.doUnmock("resend");
      vi.doUnmock("@/server/infrastructure/config/env");
      vi.resetModules();
    }
  });
});
