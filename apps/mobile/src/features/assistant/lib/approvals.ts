/**
 * Changes hAI proposed and is waiting on. The server sends them with the conversation
 * (`pendingApprovals`), each with its own preview of what will happen, so the app never
 * works out an amount or a recipient itself. The app only answers yes or no per approval.
 */

export type ApprovalPreview = {
  title: string;
  details: string[];
  consequence?: string;
  caution?: "sends-message" | "cannot-undo";
};

export type PendingApproval = {
  approvalId: string;
  toolCallId: string;
  toolName: string;
  preview: ApprovalPreview | null;
};

export const CAUTION_TEXT: Record<NonNullable<ApprovalPreview["caution"]>, string> = {
  "sends-message": "This sends an email to someone outside your workspace.",
  "cannot-undo": "This can't be undone.",
};

/** What the card is titled when the server could not describe the change. */
export function approvalTitle(approval: PendingApproval): string {
  return approval.preview?.title ?? `Run ${approval.toolName}`;
}

/**
 * The request body once every waiting change has a decision, or null while some are
 * still undecided (the server refuses a partial answer).
 */
export function approvalBatch(
  pending: readonly PendingApproval[],
  decisions: Readonly<Record<string, boolean>>,
): { approvals: { approvalId: string; approved: boolean }[] } | null {
  if (pending.length === 0) return null;
  const approvals: { approvalId: string; approved: boolean }[] = [];
  for (const approval of pending) {
    const approved = decisions[approval.approvalId];
    if (approved === undefined) return null;
    approvals.push({ approvalId: approval.approvalId, approved });
  }
  return { approvals };
}
