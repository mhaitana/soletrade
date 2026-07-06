import "server-only";
import { Resend } from "resend";
import { env } from "@/shared/lib/env";

/**
 * Email server client (Phase 5c — Resend). Server-only infra, sibling to `src/server/stripe`.
 *
 * Unlike `getStripe()` (which throws when the key is missing, because Stripe flows are
 * request-critical), email is **best-effort**: if `RESEND_API_KEY` or `EMAIL_FROM` is unset,
 * `sendEmail` returns `{ ok: false, reason: "not-configured" }` and the caller proceeds. This
 * keeps the app bootable + functional in dev without a Resend account, and means the
 * notifications platform can no-op silently when email isn't wired (mirroring how the
 * activity-feed persister is best-effort). A failed send (network/API error) is logged + returns
 * `{ ok: false, reason: "send-failed" }` — never throws to the caller, so a Resend outage can't
 * break an invoice send / webhook reconcile.
 *
 * The client is lazily constructed on first use + cached. Tests inject a fake via
 * `setEmailClientForTest` (cleared in `afterEach`) to avoid hitting the real API.
 */

export interface EmailAttachment {
  /** Attachment filename, e.g. "INV-2026-0001.pdf". */
  filename: string;
  /** File content as a base64 string (Resend's `attachments[].content` format). */
  content: string;
}

export interface EmailPayload {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Optional attachments (Wave 4 — invoice/quote PDF attachments). Omitted = no attachments. */
  attachments?: EmailAttachment[];
}

export interface EmailClient {
  send(payload: EmailPayload): Promise<{ id?: string } | null>;
}

export type SendResult =
  { ok: true; id?: string } | { ok: false; reason: "not-configured" | "send-failed" };

/** Live Resend-backed client. Throws on API error so `sendEmail`'s try/catch reports it. */
class ResendClient implements EmailClient {
  private readonly resend: Resend;
  private readonly from: string;
  constructor(apiKey: string, from: string) {
    this.resend = new Resend(apiKey);
    this.from = from;
  }
  async send(payload: EmailPayload): Promise<{ id?: string } | null> {
    const { data, error } = await this.resend.emails.send({
      from: this.from,
      to: payload.to,
      subject: payload.subject,
      html: payload.html,
      text: payload.text,
      attachments: payload.attachments?.map((a) => ({
        filename: a.filename,
        content: a.content,
      })),
    });
    if (error) {
      throw new Error(`resend: ${error.name} — ${error.message}`);
    }
    return data?.id ? { id: data.id } : null;
  }
}

let cached: EmailClient | null | undefined; // undefined = not yet resolved
let testOverride: EmailClient | null | undefined = undefined; // undefined = no override

/** Resolve the active email client (real Resend, or the test override). Returns null when
 *  email is not configured (no key / no `EMAIL_FROM`) — callers treat as a graceful no-op. */
export function getEmailClient(): EmailClient | null {
  if (testOverride !== undefined) return testOverride;
  if (cached !== undefined) return cached;
  const apiKey = env.RESEND_API_KEY;
  const from = env.EMAIL_FROM;
  if (!apiKey || !from) {
    cached = null;
    return null;
  }
  cached = new ResendClient(apiKey, from);
  return cached;
}

/** Send a transactional email. Never throws — failures are logged + returned. */
export async function sendEmail(payload: EmailPayload): Promise<SendResult> {
  const client = getEmailClient();
  if (!client) return { ok: false, reason: "not-configured" };
  try {
    const res = await client.send(payload);
    return { ok: true, id: res?.id };
  } catch (err) {
    console.error("[email] send failed:", err);
    return { ok: false, reason: "send-failed" };
  }
}

/** Test-only: inject a fake client (or `null` to force the not-configured path). */
export function setEmailClientForTest(client: EmailClient | null): void {
  testOverride = client;
}

/** Test-only: clear the override so production resolution resumes. */
export function clearEmailClientForTest(): void {
  testOverride = undefined;
}
