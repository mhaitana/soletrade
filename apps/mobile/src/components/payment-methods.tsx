import { Action, Choice, Copy, Field, Group } from "@/components/ui";
export type Payment = {
  type: string;
  label?: string;
  accountName?: string;
  bsb?: string;
  accountNumber?: string;
  bankName?: string;
  reference?: string;
  email?: string;
  identifier?: string;
};
export function validatePayments(payments: Payment[]) {
  for (const payment of payments) {
    if (
      payment.type === "bank_transfer" &&
      (!payment.accountName?.trim() || !payment.bsb?.trim() || !payment.accountNumber?.trim())
    )
      throw new Error("Complete the bank account name, BSB and account number.");
    if (payment.type === "paypal" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payment.email ?? ""))
      throw new Error("Enter a valid PayPal email.");
    if (payment.type === "payid" && !payment.identifier?.trim())
      throw new Error("Enter the PayID identifier.");
  }
}
export function PaymentFields({
  payments,
  onChange,
  workspaceDefault = false,
}: {
  payments: Payment[];
  onChange: (value: Payment[]) => void;
  workspaceDefault?: boolean;
}) {
  const update = (index: number, key: string, value: string) =>
    onChange(payments.map((payment, i) => (i === index ? { ...payment, [key]: value } : payment)));
  const labels: Record<string, string> = {
    label: "Display label",
    accountName: "Account name *",
    bsb: "BSB *",
    accountNumber: "Account number *",
    bankName: "Bank name",
    reference: "Payment reference",
    email: "PayPal email *",
    identifier: "PayID identifier *",
  };
  return (
    <Group title="Payment instructions">
      <Copy muted>
        {workspaceDefault
          ? "These instructions are used by invoices unless an invoice overrides them."
          : "Leave empty to use your business payment instructions."}
      </Copy>
      {payments.map((payment, index) => (
        <Group key={index} title={`Method ${index + 1}`}>
          <Choice
            label="Payment method"
            value={payment.type}
            options={[
              { label: "Bank transfer", value: "bank_transfer" },
              { label: "PayPal", value: "paypal" },
              { label: "PayID", value: "payid" },
            ]}
            onChange={(type) =>
              onChange(payments.map((item, i) => (i === index ? { type } : item)))
            }
          />
          {[
            "label",
            ...(payment.type === "bank_transfer"
              ? ["accountName", "bsb", "accountNumber", "bankName", "reference"]
              : payment.type === "paypal"
                ? ["email"]
                : ["identifier"]),
          ].map((key) => (
            <Field
              key={key}
              label={labels[key]}
              value={String(payment[key as keyof Payment] ?? "")}
              onChangeText={(value) => update(index, key, value)}
              autoCapitalize={key === "email" ? "none" : "sentences"}
              keyboardType={
                key === "email"
                  ? "email-address"
                  : key === "bsb" || key === "accountNumber"
                    ? "number-pad"
                    : "default"
              }
            />
          ))}
          <Action
            title={`Remove payment method ${index + 1}`}
            secondary
            onPress={() => onChange(payments.filter((_, i) => i !== index))}
          />
        </Group>
      ))}
      <Action
        title="Add payment method"
        secondary
        onPress={() => onChange([...payments, { type: "bank_transfer" }])}
      />
    </Group>
  );
}
