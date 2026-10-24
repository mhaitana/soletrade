"use client";

import { Button } from "@/components/ui/button";
import { ConfirmActionDialog } from "@/features/admin/components/confirm-action-dialog";
import { issueCreditAction } from "@/features/admin/api/actions";
import { CREDIT_TYPES } from "@/features/admin/api/actions-helpers";

const CURRENCY_OPTIONS = [
  { value: "AUD", label: "AUD" },
  { value: "NZD", label: "NZD" },
  { value: "USD", label: "USD" },
];

export function IssueCreditDialog({
  workspaceId,
  workspaceName,
  creditThresholdLabel,
}: {
  workspaceId: string;
  workspaceName: string;
  /** Human-readable per-role approval threshold, shown as helper text (UX only; enforced server-side). */
  creditThresholdLabel?: string;
}) {
  return (
    <ConfirmActionDialog
      trigger={
        <Button variant="outline" className="w-full justify-start">
          Apply credit ledger entry…
        </Button>
      }
      title={`Apply credit to ${workspaceName}`}
      description="Appends an immutable entry to the workspace's append-only credit ledger. A negative amount debits. Your role's approval threshold is enforced server-side."
      hidden={{ workspaceId }}
      fields={[
        {
          name: "amountCents",
          label: "Amount (in cents)",
          type: "number",
          required: true,
          step: 1,
          helperText:
            creditThresholdLabel ??
            "Use a positive value to credit, negative to debit (e.g. 2500 = $25.00).",
        },
        {
          name: "currency",
          label: "Currency",
          type: "select",
          options: CURRENCY_OPTIONS,
          defaultValue: "AUD",
          required: true,
        },
        {
          name: "type",
          label: "Entry type",
          type: "select",
          required: true,
          options: CREDIT_TYPES.map((t) => ({ value: t, label: t.replace(/_/g, " ") })),
        },
        {
          name: "reason",
          label: "Reason",
          type: "textarea",
          required: true,
          rows: 3,
          placeholder: "Why is this credit being applied?",
        },
        {
          name: "internalNote",
          label: "Internal note (optional)",
          type: "textarea",
          rows: 2,
        },
      ]}
      action={(input) =>
        issueCreditAction({
          workspaceId: input.workspaceId,
          amountCents: Number(input.amountCents),
          currency: input.currency,
          type: input.type,
          reason: input.reason,
          internalNote: input.internalNote || undefined,
        })
      }
      submitLabel="Apply entry"
      successMessage="Credit ledger entry applied."
    />
  );
}
