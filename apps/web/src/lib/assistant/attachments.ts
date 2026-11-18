import type { ModuleKey } from "@/config/modules";
import type { WorkspaceRole } from "@/lib/domain/database-enums";
import { can } from "@/lib/domain/permissions";
import { truncate } from "@/utils/truncate";

/**
 * A receipt attached to a chat message. Browser-safe.
 *
 * The chat route takes a message's text only, so an attachment travels as one last line of
 * that text naming the uploaded file. hAI reads the file id from it (and can then offer to
 * read the receipt with `extractReceipt`), and the chat shows the line as a small chip
 * instead of the raw id. The file itself is uploaded first, through the normal files flow,
 * so the id always points at a file in the person's own workspace; the tool checks that
 * again before using it.
 */
/**
 * Whether the chat input should offer to attach a receipt: Books must be installed (it
 * owns receipts) and the person must be allowed to upload files and manage the books.
 * This only hides the button; the upload route and the tool check for themselves.
 */
export function canAttachReceipts(
  role: WorkspaceRole,
  installedModules: readonly ModuleKey[],
): boolean {
  return (
    installedModules.includes("books") && can(role, "manage:file") && can(role, "manage:books")
  );
}

export interface ReceiptAttachment {
  fileId: string;
  name: string;
}

/** What is sent when a receipt is attached with nothing typed. */
export const ATTACHMENT_ONLY_MESSAGE = "Please read this receipt.";

const NAME_LIMIT = 80;
/** The chat input's own limit; the attachment line has to fit inside it too. */
const MESSAGE_LIMIT = 4000;
const LINE =
  /\n\nAttached receipt: (.+) \(file id ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)$/i;

/**
 * A file name reduced to what a name needs: letters, digits, spaces and `. _ -`. A file
 * can come from anyone (a supplier's PDF), and its name ends up inside the person's own
 * message, so brackets, colons and anything else that could pass for a second attachment
 * line or an instruction are dropped.
 */
function lineSafe(name: string): string {
  const cleaned = name
    .replace(/[^\p{L}\p{N} ._-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return truncate(cleaned, NAME_LIMIT).trim() || "receipt";
}

/** The message text to send for what was typed plus an attached receipt, if any. */
export function withAttachment(text: string, attachment: ReceiptAttachment | null): string {
  const typed = text.trim();
  if (!attachment) return typed;
  const line = `\n\nAttached receipt: ${lineSafe(attachment.name)} (file id ${attachment.fileId})`;
  // A message typed right up to the input's limit gives up its last few characters, so
  // the whole thing is still within what the chat route accepts.
  const room = MESSAGE_LIMIT - line.length;
  return `${truncate(typed, room) || ATTACHMENT_ONLY_MESSAGE}${line}`;
}

/** A message's text split back into what was typed and the receipt attached to it. */
export function splitAttachment(text: string): {
  text: string;
  attachment: ReceiptAttachment | null;
} {
  const match = LINE.exec(text);
  if (!match) return { text, attachment: null };
  return {
    text: text.slice(0, match.index),
    attachment: { name: match[1]!, fileId: match[2]! },
  };
}
