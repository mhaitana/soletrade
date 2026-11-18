import { ASSISTANT_TOOLS } from "@/lib/assistant/tool-catalog";

/**
 * Which hAI tool calls run straight away and which wait for the user. Browser-safe and
 * pure so the rule is easy to test; the server applies it to every tool call.
 *
 * - Opening pages, preparing unsaved drafts and looking data up run freely.
 * - Every change waits for the user to approve that exact change. There is no automatic
 *   approval. If one is ever added (for example for drafts), the tools in
 *   `NEVER_AUTO_APPROVE` must still ask: they email someone outside the workspace,
 *   cannot be undone, or spend credit.
 * - A tool the catalogue does not know is refused rather than run.
 * - An app build that cannot show approval cards has changes refused with a reason the
 *   model can pass on, instead of running them unseen.
 */

export const NEVER_AUTO_APPROVE: readonly string[] = [
  "sendInvoice",
  "markInvoicePaid",
  "voidInvoice",
  "deleteTransaction",
  "convertQuoteToInvoice",
  "extractReceipt",
];

export const UNKNOWN_TOOL_REASON = "hAI tried an action it does not have, so it was blocked.";
export const UPDATE_APP_REASON =
  "This version of the app cannot ask you to approve changes. Update the app, or make this change on the web.";

export type AssistantApproval =
  { type: "not-applicable" } | { type: "user-approval" } | { type: "denied"; reason: string };

export function assistantApprovalFor(
  toolName: string,
  opts: { approvalsSupported: boolean },
): AssistantApproval {
  if (!Object.hasOwn(ASSISTANT_TOOLS, toolName)) {
    return { type: "denied", reason: UNKNOWN_TOOL_REASON };
  }
  if (ASSISTANT_TOOLS[toolName]!.kind !== "write") return { type: "not-applicable" };
  if (!opts.approvalsSupported) return { type: "denied", reason: UPDATE_APP_REASON };
  return { type: "user-approval" };
}
