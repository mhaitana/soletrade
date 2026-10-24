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
  /** Optional attachments (Wave 4 - invoice/quote PDF attachments). Omitted = no attachments. */
  attachments?: EmailAttachment[];
}

export interface EmailClient {
  send(payload: EmailPayload): Promise<{ id?: string } | null>;
}

export type SendResult =
  { ok: true; id?: string } | { ok: false; reason: "not-configured" | "send-failed" };
