import { Row, formatMoney, human } from "@/components/ui";

export const hidden = new Set([
  "id",
  "workspaceId",
  "customerId",
  "publicToken",
  "stripePaymentIntentId",
  "stripeChargeId",
  "lineItems",
  "sections",
  "paymentMethods",
  "metadata",
  "payload",
  "storagePath",
  "userId",
  "uploadedByUserId",
  "sourceInvoiceId",
  "sourceEarningId",
  "sourceExpenseId",
  "sourceTripId",
  "convertedInvoiceId",
  "vehicleId",
  "defaultVehicleId",
  "ownerId",
  "memberId",
  "actorUserId",
  "entityId",
  "targetId",
  "receiptFileId",
  "billingContractId",
]);

export function RecordFields({ value }: { value: Record<string, unknown> }) {
  return (
    <>
      {Object.entries(value)
        .filter(([key, item]) => !hidden.has(key) && item != null && typeof item !== "object")
        .map(([key, item]) => (
          <Row
            key={key}
            title={human(key.replace(/Cents$/, ""))}
            subtitle={
              key.endsWith("Cents")
                ? formatMoney(item, String(value.currency ?? "AUD"))
                : typeof item === "boolean"
                  ? item
                    ? "Yes"
                    : "No"
                  : String(item)
            }
          />
        ))}
    </>
  );
}
